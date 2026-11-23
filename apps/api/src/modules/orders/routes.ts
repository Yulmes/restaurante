import { checkoutQuoteRequestSchema, createOrderRequestSchema } from '@marea-baja/shared';
import { Router } from 'express';
import { z } from 'zod';
import type { AppConfig } from '../../config/app-config.ts';
import { AppError, parseBody } from '../../http/errors.ts';
import { authOf, requireAuth, requireVerifiedEmail } from '../../middleware/rbac.ts';
import { ipLimitKey } from '../cart/routes.ts';
import type { RateLimiter } from '../rate-limit/rate-limiter.ts';
import { ORDER_LIMITS, enforceLimit } from './policies.ts';
import type { OrderService } from './service.ts';

/**
 * Checkout y pedidos (M5). Pasan por `csrfProtection` (app.ts). Crear un pedido exige una cuenta
 * con el correo verificado (D3: 401 sin sesión, 403 `EMAIL_NOT_VERIFIED` sin verificar). La
 * identidad sale siempre de la sesión, nunca del cuerpo.
 */
const idempotencyKeySchema = z.uuid();

export function orderRouter(service: OrderService, limiter: RateLimiter, config: AppConfig): Router {
  const router = Router();

  router.post('/checkout/quote', requireAuth, async (req, res) => {
    await enforceLimit(limiter, ipLimitKey(config, 'cart', req.clientIp), ORDER_LIMITS.cartPerIp);
    const input = parseBody(checkoutQuoteRequestSchema, req.body);
    res.setHeader('Cache-Control', 'no-store');
    res.json(await service.quote(authOf(req).userId, input));
  });

  router.post('/orders', requireVerifiedEmail, async (req, res) => {
    const { userId } = authOf(req);
    const header = req.get('idempotency-key');
    const key = idempotencyKeySchema.safeParse(header);
    if (!key.success) {
      throw new AppError(400, 'VALIDATION_FAILED', 'Idempotency-Key header must be a UUID', {
        fields: { idempotencyKey: header ? 'invalid' : 'required' },
      });
    }
    await enforceLimit(limiter, `orders:user:${userId}`, ORDER_LIMITS.ordersPerAccount);
    await enforceLimit(limiter, ipLimitKey(config, 'orders', req.clientIp), ORDER_LIMITS.ordersPerIp);
    const input = parseBody(createOrderRequestSchema, req.body);
    const { status, body } = await service.create(userId, key.data, input);
    res.status(status).json(body);
  });

  router.get('/orders/:id', requireAuth, async (req, res) => {
    const id = z.uuid().safeParse(req.params['id']);
    if (!id.success) throw new AppError(404, 'NOT_FOUND', 'Order not found');
    res.setHeader('Cache-Control', 'no-store');
    res.json({ order: await service.get(authOf(req).userId, id.data) });
  });

  return router;
}
