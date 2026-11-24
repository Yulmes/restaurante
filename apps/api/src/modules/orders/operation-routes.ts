import { cancelOrderRequestSchema, orderStatusChangeRequestSchema } from '@marea-baja/shared';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { AppError, parseBody } from '../../http/errors.ts';
import { authOf, requireAuth, requireRole } from '../../middleware/rbac.ts';
import { PAYMENT_LIMITS } from '../payments/policies.ts';
import type { RateLimiter } from '../rate-limit/rate-limiter.ts';
import { operatingRole } from './machine.ts';
import type { OperationsService } from './operations.ts';
import { ORDER_LIMITS, enforceLimit } from './policies.ts';
import type { OrderActor } from './transitions.ts';

/**
 * Operación (M7). Todas pasan por `csrfProtection` (app.ts) y toman la identidad de la sesión.
 * Ninguna recibe un monto ni un estado del pago.
 *
 * Cliente (D3):
 * - `GET /orders?cursor=` — historial propio.
 * - `POST /orders/:id/cancel` — cancelar antes de la confirmación del local (§7.1).
 *
 * Staff y admin (§3.6, §7.1):
 * - `GET /admin/pass` — el Pase: pedidos que esperan trabajo.
 * - `PATCH /admin/orders/:id/status` — `{ status, version, reason? }`.
 */
const uuid = z.uuid();

function orderIdOf(req: Request): string {
  const id = uuid.safeParse(req.params['id']);
  if (!id.success) throw new AppError(404, 'NOT_FOUND', 'Order not found');
  return id.data;
}

/** Rol con el que actúa en el Pase: el más alto que tenga. */
function staffActor(req: Request): OrderActor {
  const auth = authOf(req);
  return { userId: auth.userId, role: operatingRole(auth.roles) === 'ADMIN' ? 'ADMIN' : 'STAFF' };
}

export function operationRouter(service: OperationsService, limiter: RateLimiter): Router {
  const router = Router();

  router.get('/orders', requireAuth, async (req, res) => {
    const raw = req.query['cursor'];
    const cursor = typeof raw === 'string' && raw !== '' ? uuid.safeParse(raw) : null;
    if (cursor && !cursor.success) {
      throw new AppError(400, 'VALIDATION_FAILED', 'Invalid cursor', { fields: { cursor: 'invalid' } });
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json(await service.listForCustomer(authOf(req).userId, cursor?.data ?? null));
  });

  router.post('/orders/:id/cancel', requireAuth, async (req, res) => {
    const { userId } = authOf(req);
    const orderId = orderIdOf(req);
    const input = parseBody(cancelOrderRequestSchema, req.body);
    await enforceLimit(limiter, `orders:cancel:${userId}`, ORDER_LIMITS.cancelPerAccount);
    const { status, order } = await service.cancelByCustomer(
      userId,
      orderId,
      input.reason ?? null,
      req.requestId,
    );
    res.setHeader('Cache-Control', 'no-store');
    res.status(status).json({ order });
  });

  router.get('/admin/pass', requireRole('STAFF', 'ADMIN'), async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await service.pass(staffActor(req).role));
  });

  router.patch('/admin/orders/:id/status', requireRole('STAFF', 'ADMIN'), async (req, res) => {
    const orderId = orderIdOf(req);
    const actor = staffActor(req);
    const input = parseBody(orderStatusChangeRequestSchema, req.body);
    // §8.4: las operaciones de staff/admin comparten el límite de 30 / 10 min por usuario de M6;
    // al excederlo, 429 y entrada en el AuditLog.
    try {
      await enforceLimit(limiter, `payments:admin:${actor.userId}`, PAYMENT_LIMITS.adminPerUser);
    } catch (error) {
      await service.auditRateLimited(actor, orderId, input.status, req.requestId).catch(() => undefined);
      throw error;
    }
    const { status, order } = await service.changeStatus(actor, orderId, input, req.requestId);
    res.setHeader('Cache-Control', 'no-store');
    res.status(status).json({ order });
  });

  return router;
}
