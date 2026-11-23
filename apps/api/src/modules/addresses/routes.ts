import { addressInputSchema } from '@marea-baja/shared';
import { Router } from 'express';
import { z } from 'zod';
import { AppError, parseBody } from '../../http/errors.ts';
import { authOf, requireAuth } from '../../middleware/rbac.ts';
import { ORDER_LIMITS, enforceLimit } from '../orders/policies.ts';
import type { RateLimiter } from '../rate-limit/rate-limiter.ts';
import type { AddressService } from './service.ts';

/** Direcciones de la cuenta (M5) y zonas de delivery públicas (sin datos personales). */
export function addressRouter(service: AddressService, limiter: RateLimiter): Router {
  const router = Router();

  router.get('/public/delivery-zones', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await service.zones());
  });

  router.get('/account/addresses', requireAuth, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ addresses: await service.list(authOf(req).userId) });
  });

  router.post('/account/addresses', requireAuth, async (req, res) => {
    const { userId } = authOf(req);
    await enforceLimit(limiter, `addresses:user:${userId}`, ORDER_LIMITS.addressesPerAccount);
    const address = await service.create(userId, parseBody(addressInputSchema, req.body));
    res.status(201).json({ address });
  });

  router.delete('/account/addresses/:id', requireAuth, async (req, res) => {
    const { userId } = authOf(req);
    await enforceLimit(limiter, `addresses:user:${userId}`, ORDER_LIMITS.addressesPerAccount);
    const id = z.uuid().safeParse(req.params['id']);
    // Un id mal formado tampoco confirma nada: 404 como uno ajeno.
    if (!id.success) throw new AppError(404, 'NOT_FOUND', 'Address not found');
    await service.remove(userId, id.data);
    res.status(204).end();
  });

  return router;
}
