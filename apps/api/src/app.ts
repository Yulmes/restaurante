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
import { loadSession } from './middleware/session.ts';
import { authRouter } from './modules/auth/routes.ts';
import { AuthService } from './modules/auth/service.ts';
import { AUTH_LIMITS } from './modules/auth/policies.ts';
import type { BotCheck } from './modules/bot-check/bot-check.ts';
import { OutboxWorker, processOutbox } from './modules/notifications/outbox.ts';
import type { EmailProvider } from './modules/notifications/providers.ts';
import { RateLimiter } from './modules/rate-limit/rate-limiter.ts';

/**
 * API de Marea Baja (§4.3). Orden de las capas:
 * requestId y log → Helmet → freno de ráfagas → JSON → sesión → CSRF → rutas → 404 → errores.
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
}

export interface App {
  app: Express;
  outbox: OutboxWorker;
  limiter: RateLimiter;
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
  app.use('/api', express.json({ limit: '16kb' }));
  app.use('/api', loadSession({ db: deps.db, clock: deps.clock, config: deps.config }));
  app.use('/api', csrfProtection(deps.config));
  app.use('/api', authRouter(auth, deps.config));
  if (deps.extraRoutes) app.use('/api', deps.extraRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return { app, outbox, limiter };
}
