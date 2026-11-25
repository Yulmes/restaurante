import {
  adminAuditQuerySchema,
  adminCatchSaveRequestSchema,
  adminCategoryCreateRequestSchema,
  adminCategoryUpdateRequestSchema,
  adminCurrencyChangeRequestSchema,
  adminCustomerUpdateRequestSchema,
  adminOptionGroupUpdateRequestSchema,
  adminOptionUpdateRequestSchema,
  adminOrdersQuerySchema,
  adminProductCreateRequestSchema,
  adminProductUpdateRequestSchema,
  adminSettingsUpdateRequestSchema,
  adminTaxRateUpdateRequestSchema,
  adminZoneUpdateRequestSchema,
  dashboardRangeSchema,
} from '@marea-baja/shared';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { PrismaClient } from '../../generated/prisma/client.ts';
import { AppError, parseBody } from '../../http/errors.ts';
import { authOf, requireRole } from '../../middleware/rbac.ts';
import { recordAudit, type AuditActor, type AuditEntityType } from '../audit/audit.ts';
import { enforceLimit } from '../orders/policies.ts';
import { PAYMENT_LIMITS } from '../payments/policies.ts';
import type { RateLimiter } from '../rate-limit/rate-limiter.ts';
import type { CustomersAdminService } from './customers.ts';
import type { InsightsAdminService } from './insights.ts';
import type { MenuAdminService } from './menu.ts';
import type { SettingsAdminService } from './settings.ts';

/**
 * Admin (M8). Todo es solo de ADMIN (D-M8-3): la protección real está aquí, la web solo oculta.
 * Pasan por `csrfProtection` (app.ts) y toman la identidad de la sesión.
 *
 * Los cambios comparten el límite de §8.4 "reembolsos y cambios de configuración (admin)":
 * 30 / 10 min por usuario, la misma clave que los pagos (M6) y el Pase (M7). Al excederlo,
 * 429 y una entrada `<entidad>.rate_limited` en el AuditLog.
 */
export interface AdminServices {
  db: PrismaClient;
  menu: MenuAdminService;
  settings: SettingsAdminService;
  customers: CustomersAdminService;
  insights: InsightsAdminService;
}

const uuid = z.uuid();

function idOf(req: Request, what: string): string {
  const id = uuid.safeParse(req.params['id']);
  if (!id.success) throw new AppError(404, 'NOT_FOUND', `${what} not found`);
  return id.data;
}

function queryOf<S extends z.ZodType>(schema: S, req: Request): z.output<S> {
  const raw = Object.fromEntries(
    Object.entries(req.query).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== '',
    ),
  );
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[issue.path.join('.') || 'query'] = 'invalid';
    throw new AppError(400, 'VALIDATION_FAILED', 'Invalid query', { fields });
  }
  return parsed.data;
}

const noStore = (res: Response) => res.setHeader('Cache-Control', 'no-store');

export function adminRouter(services: AdminServices, limiter: RateLimiter): Router {
  const router = Router();
  // Se monta después de los routers de pagos (M6) y operación (M7): el Pase y las operaciones de
  // pago ya respondieron con sus propias reglas de rol; lo que llega aquí es solo de ADMIN.
  router.use('/admin', requireRole('ADMIN'));

  const actorOf = (req: Request): AuditActor => ({ userId: authOf(req).userId, role: 'ADMIN' });

  /** §8.4: 30 / 10 min por usuario, con AuditLog al exceder. */
  async function limit(req: Request, entityType: AuditEntityType, entityId: string): Promise<AuditActor> {
    const actor = actorOf(req);
    try {
      await enforceLimit(limiter, `payments:admin:${actor.userId}`, PAYMENT_LIMITS.adminPerUser);
    } catch (error) {
      await services.db
        .$transaction((tx) =>
          recordAudit(tx, {
            actor,
            action: `${entityType}.rate_limited`,
            entityType,
            entityId,
            requestId: req.requestId,
          }),
        )
        .catch(() => undefined);
      throw error;
    }
    return actor;
  }

  // ─── Dashboard ─────────────────────────────────────────────────────────────
  router.get('/admin/dashboard', async (req, res) => {
    const { range } = queryOf(z.object({ range: dashboardRangeSchema.default('today') }), req);
    noStore(res);
    res.json(await services.insights.dashboard(range));
  });

  // ─── Carta ─────────────────────────────────────────────────────────────────
  router.get('/admin/menu', async (_req, res) => {
    noStore(res);
    res.json(await services.menu.menu());
  });

  router.post('/admin/products', async (req, res) => {
    const input = parseBody(adminProductCreateRequestSchema, req.body);
    const actor = await limit(req, 'product', 'new');
    res.status(201).json({ product: await services.menu.createProduct(actor, input, req.requestId) });
  });

  router.put('/admin/products/:id', async (req, res) => {
    const id = idOf(req, 'Product');
    const input = parseBody(adminProductUpdateRequestSchema, req.body);
    const actor = await limit(req, 'product', id);
    res.json({ product: await services.menu.updateProduct(actor, id, input, req.requestId) });
  });

  router.post('/admin/categories', async (req, res) => {
    const input = parseBody(adminCategoryCreateRequestSchema, req.body);
    const actor = await limit(req, 'category', 'new');
    res.status(201).json({ category: await services.menu.createCategory(actor, input, req.requestId) });
  });

  router.put('/admin/categories/:id', async (req, res) => {
    const id = idOf(req, 'Category');
    const input = parseBody(adminCategoryUpdateRequestSchema, req.body);
    const actor = await limit(req, 'category', id);
    res.json({ category: await services.menu.updateCategory(actor, id, input, req.requestId) });
  });

  router.put('/admin/option-groups/:id', async (req, res) => {
    const id = idOf(req, 'Option group');
    const input = parseBody(adminOptionGroupUpdateRequestSchema, req.body);
    const actor = await limit(req, 'optionGroup', id);
    res.json({ product: await services.menu.updateOptionGroup(actor, id, input, req.requestId) });
  });

  router.put('/admin/options/:id', async (req, res) => {
    const id = idOf(req, 'Option');
    const input = parseBody(adminOptionUpdateRequestSchema, req.body);
    const actor = await limit(req, 'option', id);
    res.json({ product: await services.menu.updateOption(actor, id, input, req.requestId) });
  });

  router.get('/admin/catch', async (_req, res) => {
    noStore(res);
    res.json(await services.menu.catchBoards());
  });

  router.put('/admin/catch', async (req, res) => {
    const input = parseBody(adminCatchSaveRequestSchema, req.body);
    const actor = await limit(req, 'catch', input.date);
    res.json(await services.menu.saveCatch(actor, input, req.requestId));
  });

  // ─── Clientes ──────────────────────────────────────────────────────────────
  router.get('/admin/customers', async (req, res) => {
    const query = queryOf(
      z.object({ q: z.string().trim().max(80).optional(), cursor: uuid.optional() }),
      req,
    );
    noStore(res);
    res.json(await services.customers.list(query));
  });

  router.get('/admin/customers/:id', async (req, res) => {
    noStore(res);
    res.json({ customer: await services.customers.detail(idOf(req, 'Customer')) });
  });

  router.patch('/admin/customers/:id', async (req, res) => {
    const id = idOf(req, 'Customer');
    const input = parseBody(adminCustomerUpdateRequestSchema, req.body);
    const actor = await limit(req, 'user', id);
    res.json({ customer: await services.customers.update(actor, id, input, req.requestId) });
  });

  // ─── Configuración ─────────────────────────────────────────────────────────
  router.get('/admin/settings', async (_req, res) => {
    noStore(res);
    res.json(await services.settings.get());
  });

  router.put('/admin/settings', async (req, res) => {
    const input = parseBody(adminSettingsUpdateRequestSchema, req.body);
    const actor = await limit(req, 'settings', '1');
    res.json({ settings: await services.settings.update(actor, input, req.requestId) });
  });

  router.post('/admin/settings/currency', async (req, res) => {
    const input = parseBody(adminCurrencyChangeRequestSchema, req.body);
    const actor = await limit(req, 'settings', '1');
    res.json(await services.settings.changeCurrency(actor, input, req.requestId));
  });

  router.put('/admin/tax-rates/:id', async (req, res) => {
    const id = idOf(req, 'Tax rate');
    const input = parseBody(adminTaxRateUpdateRequestSchema, req.body);
    const actor = await limit(req, 'taxRate', id);
    res.json({ taxRate: await services.settings.updateTaxRate(actor, id, input, req.requestId) });
  });

  router.put('/admin/delivery-zones/:id', async (req, res) => {
    const id = idOf(req, 'Delivery zone');
    const input = parseBody(adminZoneUpdateRequestSchema, req.body);
    const actor = await limit(req, 'deliveryZone', id);
    res.json({ zone: await services.settings.updateZone(actor, id, input, req.requestId) });
  });

  // ─── Auditoría (solo lectura) ──────────────────────────────────────────────
  router.get('/admin/audit', async (req, res) => {
    noStore(res);
    res.json(await services.insights.audit(queryOf(adminAuditQuerySchema, req)));
  });

  // ─── Pedidos y reembolsos ──────────────────────────────────────────────────
  router.get('/admin/orders', async (req, res) => {
    noStore(res);
    res.json(await services.insights.orders(queryOf(adminOrdersQuerySchema, req)));
  });

  router.get('/admin/orders/:id', async (req, res) => {
    noStore(res);
    res.json(await services.insights.order(idOf(req, 'Order')));
  });

  return router;
}
