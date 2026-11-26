import type { RequestHandler } from 'express';
import { MINUTE, type Clock } from '../../lib/clock.ts';

/**
 * Actividad reciente (ADR 0010, D-M10-1, R-M10-1).
 *
 * En producción los temporizadores de la API (reconciliación, barrido, outbox y purga) consultan la
 * base. Si corrieran siempre, Neon nunca se suspendería (UptimeRobot mantiene despierta la API,
 * D9). Por eso solo corren mientras hubo una petición real en los últimos 5 min. No cuentan:
 * - `/api/health` y `/api/health/ready` (monitoreo y despliegue);
 * - `/api/public/catalog-version` (la consulta el rebuild cada 30 min y no toca la base);
 * - `/api/internal/*` (el disparador externo de tareas).
 */
export const ACTIVITY_WINDOW_MS = 5 * MINUTE;

const IGNORED_EXACT = new Set(['/api/health', '/api/health/ready', '/api/public/catalog-version']);
const IGNORED_PREFIX = '/api/internal/';

export function countsAsActivity(path: string): boolean {
  if (IGNORED_EXACT.has(path) || path.startsWith(IGNORED_PREFIX)) return false;
  return path === '/api' || path.startsWith('/api/');
}

export class ActivityMonitor {
  readonly #clock: Clock;
  readonly #windowMs: number;
  #lastAt = Number.NEGATIVE_INFINITY;

  constructor(clock: Clock, windowMs = ACTIVITY_WINDOW_MS) {
    this.#clock = clock;
    this.#windowMs = windowMs;
  }

  touch(): void {
    this.#lastAt = this.#clock.now().getTime();
  }

  isActive(): boolean {
    return this.#clock.now().getTime() - this.#lastAt < this.#windowMs;
  }

  /** Middleware: marca actividad con cada petición que cuenta (antes de cualquier rechazo). */
  middleware(): RequestHandler {
    return (req, _res, next) => {
      if (countsAsActivity(req.path)) this.touch();
      next();
    };
  }
}
