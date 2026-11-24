import { authorizePaymentRequestSchema, refundRequestSchema } from '@marea-baja/shared';
import { Router, type Request } from 'express';
import { z } from 'zod';
import type { AppConfig } from '../../config/app-config.ts';
import { AppError, parseBody } from '../../http/errors.ts';
import { authOf, requireRole, requireVerifiedEmail } from '../../middleware/rbac.ts';
import { ipLimitKey } from '../cart/routes.ts';
import { enforceLimit } from '../orders/policies.ts';
import type { RateLimiter } from '../rate-limit/rate-limiter.ts';
import { PAYMENT_LIMITS } from './policies.ts';
import type { PaymentActor, PaymentService } from './service.ts';

/**
 * Pagos (M6). Todas las rutas pasan por `csrfProtection` (app.ts) y toman la identidad de la
 * sesión, nunca del cuerpo. Ninguna recibe un monto ni un estado del pago.
 *
 * Cliente (correo verificado, D3):
 * - `POST /orders/:id/payments/authorize` — tarjeta demo con escenario (`Idempotency-Key`).
 * - `POST /orders/:id/payments/cash-on-delivery` — pagar al recibir o retirar (D-M6-1).
 *
 * Staff y admin (D-M6-2, API sin interfaz en M6):
 * - `GET /admin/orders/:id/payment` (staff/admin).
 * - `POST /admin/orders/:id/payment/capture` y `/void` (staff/admin).
 * - `POST /admin/orders/:id/payment/refunds` (solo admin, `Idempotency-Key`).
 */
const uuid = z.uuid();
const voidRequestSchema = z
  .object({ reason: z.string().trim().max(300, { error: 'tooLong' }).optional() })
  .strict();

function orderIdOf(req: Request): string {
  const id = uuid.safeParse(req.params['id']);
  if (!id.success) throw new AppError(404, 'NOT_FOUND', 'Order not found');
  return id.data;
}

function idempotencyKeyOf(req: Request): string {
  const header = req.get('idempotency-key');
  const key = uuid.safeParse(header);
  if (!key.success) {
    throw new AppError(400, 'VALIDATION_FAILED', 'Idempotency-Key header must be a UUID', {
      fields: { idempotencyKey: header ? 'invalid' : 'required' },
    });
  }
  return key.data;
}

/** Rol con el que actúa: el más alto que tenga entre los permitidos. */
function actorOf(req: Request): PaymentActor {
  const auth = authOf(req);
  return { userId: auth.userId, role: auth.roles.includes('ADMIN') ? 'ADMIN' : 'STAFF' };
}

export function paymentRouter(service: PaymentService, limiter: RateLimiter, config: AppConfig): Router {
  const router = Router();

  router.post('/orders/:id/payments/authorize', requireVerifiedEmail, async (req, res) => {
    const { userId } = authOf(req);
    const orderId = orderIdOf(req);
    const key = idempotencyKeyOf(req);
    const input = parseBody(authorizePaymentRequestSchema, req.body);
    await enforceLimit(limiter, ipLimitKey(config, 'payments', req.clientIp), PAYMENT_LIMITS.authorizePerIp);
    await enforceLimit(limiter, `payments:order:${orderId}`, PAYMENT_LIMITS.authorizePerOrder);
    const { status, body } = await service.authorize(userId, orderId, key, input.scenario);
    res.setHeader('Cache-Control', 'no-store');
    res.status(status).json(body);
  });

  router.post('/orders/:id/payments/cash-on-delivery', requireVerifiedEmail, async (req, res) => {
    const { userId } = authOf(req);
    const orderId = orderIdOf(req);
    await enforceLimit(limiter, `payments:cash:${orderId}`, PAYMENT_LIMITS.cashPerOrder);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ order: await service.payOnDelivery(userId, orderId) });
  });

  /** Staff y admin: 30 / 10 min por usuario; al exceder, 429 y entrada en el AuditLog (§8.4). */
  async function adminLimit(
    req: Request,
    actor: PaymentActor,
    orderId: string,
    action: string,
  ): Promise<void> {
    try {
      await enforceLimit(limiter, `payments:admin:${actor.userId}`, PAYMENT_LIMITS.adminPerUser);
    } catch (error) {
      await service.auditRateLimited(actor, orderId, action, req.requestId).catch(() => undefined);
      throw error;
    }
  }

  router.get('/admin/orders/:id/payment', requireRole('STAFF', 'ADMIN'), async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ payment: await service.adminView(orderIdOf(req)) });
  });

  router.post('/admin/orders/:id/payment/capture', requireRole('STAFF', 'ADMIN'), async (req, res) => {
    const orderId = orderIdOf(req);
    const actor = actorOf(req);
    await adminLimit(req, actor, orderId, 'capture');
    const { status, body } = await service.capture(actor, orderId, req.requestId);
    res.status(status).json(body);
  });

  router.post('/admin/orders/:id/payment/void', requireRole('STAFF', 'ADMIN'), async (req, res) => {
    const orderId = orderIdOf(req);
    const actor = actorOf(req);
    const input = parseBody(voidRequestSchema, req.body ?? {});
    await adminLimit(req, actor, orderId, 'void');
    const { status, body } = await service.voidPayment(actor, orderId, input.reason ?? null, req.requestId);
    res.status(status).json(body);
  });

  router.post('/admin/orders/:id/payment/refunds', requireRole('ADMIN'), async (req, res) => {
    const orderId = orderIdOf(req);
    const actor: PaymentActor = { userId: authOf(req).userId, role: 'ADMIN' };
    const key = idempotencyKeyOf(req);
    const input = parseBody(refundRequestSchema, req.body);
    await adminLimit(req, actor, orderId, 'refund');
    const { status, body } = await service.refund(actor, orderId, key, input, req.requestId);
    res.status(status).json(body);
  });

  return router;
}
