import { Prisma, type PrismaClient } from '../../generated/prisma/client.ts';
import { AppError } from '../../http/errors.ts';
import type { Clock } from '../../lib/clock.ts';

/**
 * Idempotencia HTTP (§7.3, punto 1), compartida por `POST /orders` (M5), `/authorize` y
 * `/refunds` (M6). Extraída de `OrderService` sin cambiar el comportamiento:
 *
 * - misma clave y mismo cuerpo → la respuesta original;
 * - otro cuerpo, u otra cuenta con la misma clave → 422 `IDEMPOTENCY_KEY_REUSED`;
 * - en curso → 409 `IDEMPOTENCY_IN_PROGRESS`;
 * - una petición anterior que no terminó (caída a mitad de camino) se retoma una sola vez;
 * - si la operación falla sin respuesta guardada, la clave se libera para repetir el intento.
 */
export interface IdempotencyTiming {
  lockMs: number;
  ttlMs: number;
}

export type Claim<T> = { id: string } | { replay: { status: number; body: T } };

type Db = Prisma.TransactionClient;

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

const inProgress = () =>
  new AppError(409, 'IDEMPOTENCY_IN_PROGRESS', 'A request with this Idempotency-Key is in progress');

export class HttpIdempotency {
  readonly #db: PrismaClient;
  readonly #clock: Clock;
  readonly #timing: IdempotencyTiming;

  constructor(db: PrismaClient, clock: Clock, timing: IdempotencyTiming) {
    this.#db = db;
    this.#clock = clock;
    this.#timing = timing;
  }

  async claim<T>(scope: string, userId: string, key: string, requestHash: string): Promise<Claim<T>> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const now = this.#clock.now();
      try {
        return await this.#db.idempotencyKey.create({
          data: {
            scope,
            key,
            userId,
            requestHash,
            lockedUntil: new Date(now.getTime() + this.#timing.lockMs),
            expiresAt: new Date(now.getTime() + this.#timing.ttlMs),
          },
          select: { id: true },
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
      const existing = await this.#db.idempotencyKey.findUnique({ where: { scope_key: { scope, key } } });
      if (!existing) continue;
      if (existing.expiresAt <= now) {
        await this.#db.idempotencyKey.deleteMany({
          where: { id: existing.id, expiresAt: existing.expiresAt },
        });
        continue;
      }
      // Otra cuenta con la misma clave, o la misma clave con otro cuerpo: 422 sin más detalle.
      if (existing.userId !== userId || existing.requestHash !== requestHash) {
        throw new AppError(422, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key reused with a different request');
      }
      if (existing.responseStatus !== null) {
        return { replay: { status: existing.responseStatus, body: existing.responseBody as unknown as T } };
      }
      if (existing.lockedUntil && existing.lockedUntil > now) throw inProgress();
      // La petición anterior no terminó: se toma la clave, una sola vez.
      const taken = await this.#db.idempotencyKey.updateMany({
        where: { id: existing.id, responseStatus: null, lockedUntil: existing.lockedUntil },
        data: { lockedUntil: new Date(now.getTime() + this.#timing.lockMs) },
      });
      if (taken.count === 1) return { id: existing.id };
      throw inProgress();
    }
    throw inProgress();
  }

  /** Guarda la respuesta (con el cliente de la transacción de la operación, si la hay). */
  async complete(db: Db | PrismaClient, id: string, status: number, body: unknown): Promise<void> {
    await db.idempotencyKey.update({
      where: { id },
      data: { responseStatus: status, responseBody: body as Prisma.InputJsonValue, lockedUntil: null },
    });
  }

  /** Nada quedó confirmado: libera la clave para que el mismo intento se pueda repetir. */
  async release(id: string): Promise<void> {
    await this.#db.idempotencyKey.deleteMany({ where: { id, responseStatus: null } }).catch(() => undefined);
  }
}
