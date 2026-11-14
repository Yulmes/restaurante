import { localeSchema } from '@marea-baja/shared';
import { Router } from 'express';
import { AppError } from '../../http/errors.ts';
import type { CatalogService } from './service.ts';

/**
 * API pública del catálogo (M4, §4.2). Solo lectura, sin sesión ni datos personales.
 * `no-store`: precios, disponibilidad y pesca del día se consultan siempre en vivo (D10).
 */
export function catalogRouter(service: CatalogService): Router {
  const router = Router();

  router.get('/public/catalog', async (req, res) => {
    const raw = req.query['locale'] ?? 'es-CR';
    const parsed = localeSchema.safeParse(raw);
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_FAILED', 'Unsupported locale', { fields: { locale: 'invalid' } });
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json(await service.catalog(parsed.data));
  });

  /** Para el rebuild programado (D10, M10): desde memoria, sin despertar la base (R20). */
  router.get('/public/catalog-version', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ version: await service.version() });
  });

  router.get('/public/catch-of-the-day', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await service.catchBoard());
  });

  router.get('/public/opening-hours', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await service.openingHours());
  });

  return router;
}
