import {
  cartItemRequestSchema,
  cartMergeRequestSchema,
  cartQuoteRequestSchema,
  localeSchema,
  type CartMergeResponse,
} from '@marea-baja/shared';
import { Router, type Request } from 'express';
import type { AppConfig } from '../../config/app-config.ts';
import { AppError, parseBody } from '../../http/errors.ts';
import { hmac } from '../../lib/crypto.ts';
import { authOf, requireAuth } from '../../middleware/rbac.ts';
import { ORDER_LIMITS, enforceLimit } from '../orders/policies.ts';
import type { RateLimiter } from '../rate-limit/rate-limiter.ts';
import type { CartService } from './service.ts';

/**
 * Rutas del carrito (M5, §7.5). Las que modifican datos pasan por `csrfProtection` (app.ts),
 * también la cotización del invitado (con su token ligado a la cookie previa, §8.3).
 * Ninguna recibe precios: solo referencias y cantidades.
 */
export function queryLocale(req: Request) {
  const parsed = localeSchema.safeParse(req.query['locale'] ?? 'es-CR');
  if (!parsed.success) {
    throw new AppError(400, 'VALIDATION_FAILED', 'Unsupported locale', { fields: { locale: 'invalid' } });
  }
  return parsed.data;
}

export function ipLimitKey(config: AppConfig, prefix: string, ip: string): string {
  return `${prefix}:ip:${hmac(config.appSecret, `ip:${ip}`)}`;
}

export function cartRouter(service: CartService, limiter: RateLimiter, config: AppConfig): Router {
  const router = Router();
  const perIp = (req: Request) =>
    enforceLimit(limiter, ipLimitKey(config, 'cart', req.clientIp), ORDER_LIMITS.cartPerIp);

  /** Invitado: valoriza las líneas del navegador sin guardarlas. */
  router.post('/cart/quote', async (req, res) => {
    await perIp(req);
    const { locale, lines } = parseBody(cartQuoteRequestSchema, req.body);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ cart: await service.quote(locale, lines) });
  });

  router.get('/cart', requireAuth, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ cart: await service.get(authOf(req).userId, queryLocale(req)) });
  });

  router.post('/cart/items', requireAuth, async (req, res) => {
    await perIp(req);
    const input = parseBody(cartItemRequestSchema, req.body);
    const cart = await service.change(authOf(req).userId, input.locale, input);
    res.json({ cart });
  });

  router.post('/cart/merge', requireAuth, async (req, res) => {
    const { userId } = authOf(req);
    await enforceLimit(limiter, `cart:merge:user:${userId}`, ORDER_LIMITS.mergePerAccount);
    const input = parseBody(cartMergeRequestSchema, req.body);
    const result: CartMergeResponse = await service.merge(userId, input.locale, input.mergeKey, input.lines);
    res.json(result);
  });

  return router;
}
