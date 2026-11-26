import { Router } from 'express';
import type { PrismaClient } from '../../generated/prisma/client.ts';
import { AppError } from '../../http/errors.ts';
import { HOUR } from '../../lib/clock.ts';
import { digest, matchesAny } from '../../middleware/origin.ts';
import type { RateLimiter } from '../rate-limit/rate-limiter.ts';
import { TasksBusyError, type BackgroundTasks } from './background.ts';

/**
 * Endpoint interno de tareas (ADR 0010, D-M10-1): `POST /api/internal/tasks`.
 *
 * - Lo llama el Cron Trigger del Worker cada 30 min, o el workflow manual de respaldo.
 * - En producción ya pasó por el secreto de origen (`originGuard`); además exige `X-Tasks-Auth`
 *   contra `TASKS_SECRETS` (uno o dos, para rotar). Sin secretos configurados, no existe (404).
 * - Va antes del JSON, la sesión y el CSRF: no tiene cuerpo, cookies ni `Origin`.
 * - Límite propio: 12 por hora (el cron usa 2). Una vuelta a la vez: si ya corre, 409.
 * - Responde solo conteos. 200 si todas las tareas terminaron bien; 500 si alguna falló.
 */
export const INTERNAL_TASKS_LIMIT = { max: 12, windowMs: HOUR } as const;

export function internalRouter(deps: {
  tasks: BackgroundTasks;
  limiter: RateLimiter;
  secrets: readonly string[];
}): Router {
  const router = Router();
  const digests = deps.secrets.map(digest);

  router.post('/internal/tasks', async (req, res) => {
    if (digests.length === 0) throw new AppError(404, 'NOT_FOUND', 'Not found');
    if (!matchesAny(req.get('x-tasks-auth'), digests)) {
      throw new AppError(403, 'TASKS_FORBIDDEN', 'Forbidden');
    }
    const state = await deps.limiter.hit('internal:tasks', INTERNAL_TASKS_LIMIT.windowMs);
    if (state.count > INTERNAL_TASKS_LIMIT.max) {
      throw new AppError(429, 'RATE_LIMITED', 'Too many requests', {
        retryAfterSeconds: Math.ceil(state.resetInMs / 1000),
      });
    }
    try {
      const report = await deps.tasks.runAll();
      req.log.info({ ok: report.ok, durationMs: report.durationMs }, 'internal tasks');
      res.status(report.ok ? 200 : 500).json(report);
    } catch (error) {
      if (error instanceof TasksBusyError) throw new AppError(409, 'TASKS_BUSY', 'Tasks already running');
      throw error;
    }
  });

  return router;
}

/**
 * `GET /api/health/ready` (ADR 0010, D-M10-6; §9.5): la API responde y la base contesta a una
 * consulta mínima. En producción exige el secreto de origen (lo usan el despliegue y la suite
 * post-deploy, no UptimeRobot, que despertaría la base). Sin detalles: 200 o 503.
 */
export const READY_TIMEOUT_MS = 5_000;

export function readyRouter(db: PrismaClient): Router {
  const router = Router();
  router.get('/health/ready', async (req, res) => {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        db.$queryRaw`SELECT 1`,
        new Promise((_resolve, reject) => {
          timer = setTimeout(() => {
            reject(new Error('readiness timeout'));
          }, READY_TIMEOUT_MS);
        }),
      ]);
      res.json({ status: 'ready' });
    } catch (error) {
      req.log.error({ err: error }, 'readiness check failed');
      res.status(503).json({ status: 'unavailable' });
    } finally {
      clearTimeout(timer);
    }
  });
  return router;
}
