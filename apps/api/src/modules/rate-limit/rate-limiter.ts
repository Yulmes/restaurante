import type { PrismaClient } from '../../generated/prisma/client.ts';
import type { Clock } from '../../lib/clock.ts';

/**
 * Límites persistentes en PostgreSQL (§8.4): ventana fija con aproximación deslizante
 * (ventana actual + la fracción que queda de la anterior). El incremento es atómico, en una
 * sola consulta parametrizada.
 *
 * Las claves nunca llevan datos personales en claro: correos e IP llegan ya con hash.
 */
export interface LimitState {
  /** Conteo estimado en la ventana deslizante, incluido este intento si fue `hit`. */
  count: number;
  /** Milisegundos hasta que empiece la próxima ventana. */
  resetInMs: number;
}

export class RateLimiter {
  readonly #db: PrismaClient;
  readonly #clock: Clock;

  constructor(db: PrismaClient, clock: Clock) {
    this.#db = db;
    this.#clock = clock;
  }

  /** Suma 1 y devuelve el conteo estimado. */
  async hit(key: string, windowMs: number): Promise<LimitState> {
    const now = this.#clock.now();
    const start = windowStart(now, windowMs);
    const rows = await this.#db.$queryRaw<{ count: number }[]>`
      INSERT INTO "RateLimitCounter"(key, "windowStart", count) VALUES (${key}, ${start}, 1)
      ON CONFLICT (key, "windowStart") DO UPDATE SET count = "RateLimitCounter".count + 1
      RETURNING count`;
    const current = rows[0]?.count ?? 1;
    return this.#estimate(key, now, start, windowMs, current);
  }

  /** Conteo estimado sin sumar. */
  async peek(key: string, windowMs: number): Promise<LimitState> {
    const now = this.#clock.now();
    const start = windowStart(now, windowMs);
    const row = await this.#db.rateLimitCounter.findUnique({
      where: { key_windowStart: { key, windowStart: start } },
      select: { count: true },
    });
    return this.#estimate(key, now, start, windowMs, row?.count ?? 0);
  }

  /** Reinicia una clave (un login exitoso reinicia los contadores de cuenta+IP, §8.4). */
  async reset(key: string): Promise<void> {
    await this.#db.rateLimitCounter.deleteMany({ where: { key } });
  }

  /** Limpieza de ventanas de más de 24 h (§8.4). */
  async purgeOlderThan(ms: number): Promise<number> {
    const cutoff = new Date(this.#clock.now().getTime() - ms);
    const result = await this.#db.rateLimitCounter.deleteMany({ where: { windowStart: { lt: cutoff } } });
    return result.count;
  }

  async #estimate(
    key: string,
    now: Date,
    start: Date,
    windowMs: number,
    current: number,
  ): Promise<LimitState> {
    const previous = await this.#db.rateLimitCounter.findUnique({
      where: { key_windowStart: { key, windowStart: new Date(start.getTime() - windowMs) } },
      select: { count: true },
    });
    const elapsed = (now.getTime() - start.getTime()) / windowMs;
    const weighted = (previous?.count ?? 0) * (1 - elapsed);
    return { count: current + Math.floor(weighted), resetInMs: start.getTime() + windowMs - now.getTime() };
  }
}

export function windowStart(now: Date, windowMs: number): Date {
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
}
