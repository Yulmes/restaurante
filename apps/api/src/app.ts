import express, { type Express, type Request, type Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import type { Logger } from 'pino';
import type { AppConfig } from './config/app-config.ts';
import type { PrismaClient } from './generated/prisma/client.ts';
import { AppError, errorHandler, notFoundHandler } from './http/errors.ts';
import { requestContext } from './http/request-context.ts';
import type { Clock } from './lib/clock.ts';
import { csrfProtection } from './middleware/csrf.ts';
import { originGuard } from './middleware/origin.ts';
import { loadSession } from './middleware/session.ts';
import { addressRouter } from './modules/addresses/routes.ts';
import { CustomersAdminService } from './modules/admin/customers.ts';
import { InsightsAdminService } from './modules/admin/insights.ts';
import { MenuAdminService } from './modules/admin/menu.ts';
import { adminRouter } from './modules/admin/routes.ts';
import { SettingsAdminService } from './modules/admin/settings.ts';
import { AddressService } from './modules/addresses/service.ts';
import { authRouter } from './modules/auth/routes.ts';
import { cartRouter } from './modules/cart/routes.ts';
import { CartService } from './modules/cart/service.ts';
import { notificationRouter } from './modules/notifications/inbox.ts';
import { operationRouter } from './modules/orders/operation-routes.ts';
import { OperationsService } from './modules/orders/operations.ts';
import { orderRouter } from './modules/orders/routes.ts';
import { OrderService } from './modules/orders/service.ts';
import { catalogRouter } from './modules/catalog/routes.ts';
import { CatalogService } from './modules/catalog/service.ts';
import { AuthService } from './modules/auth/service.ts';
import { AUTH_LIMITS } from './modules/auth/policies.ts';
import type { BotCheck } from './modules/bot-check/bot-check.ts';
import { OutboxWorker, processOutbox } from './modules/notifications/outbox.ts';
import type { PaymentGateway } from './modules/payments/gateway.ts';
import { MockGateway } from './modules/payments/mock-gateway.ts';
import { paymentRouter } from './modules/payments/routes.ts';
import { PaymentService } from './modules/payments/service.ts';
import type { EmailProvider } from './modules/notifications/providers.ts';
import { RateLimiter } from './modules/rate-limit/rate-limiter.ts';
import { ActivityMonitor } from './modules/tasks/activity.ts';
import { BackgroundTasks } from './modules/tasks/background.ts';
import { internalRouter, readyRouter } from './modules/tasks/routes.ts';

/**
 * API de Marea Baja (§4.3). Orden de las capas:
 * requestId y log → Helmet → `/api/health` → secreto de origen e IP (M10) → actividad (M10) →
 * `/api/health/ready` → freno de ráfagas → tareas internas (M10) → JSON → sesión → CSRF → rutas →
 * 404 → errores.
 */
export interface AppDeps {
  config: AppConfig;
  db: PrismaClient;
  logger: Logger;
  clock: Clock;
  email: EmailProvider;
  botCheck: BotCheck;
  /** Rutas extra montadas bajo /api, después de sesión y CSRF (las pruebas de RBAC las usan). */
  extraRoutes?: Router;
  /** Solo pruebas: simula clientes con IP distintas. En ejecución real es la IP del socket. */
  clientIp?: (req: Request) => string;
  /** Procesador de pagos (§7.4). Por defecto, el simulado; las pruebas pueden inyectar fallas. */
  paymentGateway?: PaymentGateway;
}

export interface App {
  app: Express;
  catalog: CatalogService;
  outbox: OutboxWorker;
  limiter: RateLimiter;
  payments: PaymentService;
  /** M7: Pase, cambios de estado, historial y barridos de pedidos. */
  operations: OperationsService;
  /** M10 (ADR 0010, D-M10-1): tareas periódicas y actividad reciente que las habilita. */
  tasks: BackgroundTasks;
  activity: ActivityMonitor;
}

export function createApp(deps: AppDeps): App {
  const limiter = new RateLimiter(deps.db, deps.clock);
  const outbox = new OutboxWorker(
    () => processOutbox({ db: deps.db, provider: deps.email, clock: deps.clock, logger: deps.logger }),
    deps.logger,
  );
  const auth = new AuthService({
    db: deps.db,
    clock: deps.clock,
    config: deps.config,
    limiter,
    botCheck: deps.botCheck,
    afterCommit: () => void outbox.kick(),
  });

  const catalog = new CatalogService(deps.db, deps.clock);
  const cart = new CartService(deps.db, deps.clock);
  const addresses = new AddressService(deps.db);
  const orders = new OrderService({ db: deps.db, clock: deps.clock, config: deps.config });
  const payments = new PaymentService({
    db: deps.db,
    clock: deps.clock,
    config: deps.config,
    gateway: deps.paymentGateway ?? new MockGateway({ db: deps.db, clock: deps.clock }),
    afterCommit: () => void outbox.kick(),
  });
  const operations = new OperationsService({
    db: deps.db,
    clock: deps.clock,
    config: deps.config,
    payments,
    afterCommit: () => void outbox.kick(),
  });

  // M8: admin. Los cambios de la carta y de la moneda invalidan la versión del catálogo (D10, R20).
  const invalidateCatalog = () => {
    catalog.invalidateVersion();
  };
  const admin = {
    db: deps.db,
    menu: new MenuAdminService({ db: deps.db, clock: deps.clock, afterChange: invalidateCatalog }),
    settings: new SettingsAdminService({ db: deps.db, afterChange: invalidateCatalog }),
    customers: new CustomersAdminService({ db: deps.db, clock: deps.clock }),
    insights: new InsightsAdminService({
      db: deps.db,
      clock: deps.clock,
      payments,
      demoPaymentsEnabled: deps.config.demoPaymentsEnabled,
    }),
  };

  const app = express();
  app.disable('x-powered-by');
  // La IP real detrás del Worker se toma del secreto de origen en M10 (R5, R-SEC-09).
  app.set('trust proxy', false);

  app.use(requestContext(deps.logger));
  if (deps.clientIp) {
    const resolve = deps.clientIp;
    app.use((req, _res, next) => {
      req.clientIp = resolve(req);
      next();
    });
  }
  app.use(helmet());

  /** D9: liviano, sin tocar la base ni exponer información de la infraestructura. */
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // M10 (ADR 0010): todo lo que sigue exige el secreto de origen en producción (D-M10-2).
  app.use('/api', originGuard(deps.config.originSecrets));
  const activity = new ActivityMonitor(deps.clock);
  app.use(activity.middleware());
  app.use('/api', readyRouter(deps.db));
  const tasks = new BackgroundTasks({
    payments,
    operations,
    outbox,
    limiter,
    clock: deps.clock,
    logger: deps.logger,
  });

  app.use(
    '/api',
    rateLimit({
      windowMs: AUTH_LIMITS.burst.windowMs,
      limit: AUTH_LIMITS.burst.max,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      keyGenerator: (req) => req.clientIp,
      handler: (_req, _res, next, options) => {
        next(
          new AppError(429, 'RATE_LIMITED', 'Too many requests', {
            retryAfterSeconds: Math.ceil(options.windowMs / 1000),
          }),
        );
      },
    }),
  );
  app.use('/api', internalRouter({ tasks, limiter, secrets: deps.config.tasksSecrets }));
  app.use('/api', express.json({ limit: '16kb' }));
  app.use('/api', loadSession({ db: deps.db, clock: deps.clock, config: deps.config }));
  app.use('/api', csrfProtection(deps.config));
  app.use('/api', authRouter(auth, deps.config));
  app.use('/api', catalogRouter(catalog));
  app.use('/api', cartRouter(cart, limiter, deps.config));
  app.use('/api', addressRouter(addresses, limiter));
  app.use('/api', orderRouter(orders, limiter, deps.config));
  app.use('/api', paymentRouter(payments, limiter, deps.config));
  app.use('/api', operationRouter(operations, limiter));
  app.use('/api', notificationRouter(deps.db, deps.config.demoEmailVerification));
  app.use('/api', adminRouter(admin, limiter));
  if (deps.extraRoutes) app.use('/api', deps.extraRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return { app, outbox, limiter, catalog, payments, operations, tasks, activity };
}
