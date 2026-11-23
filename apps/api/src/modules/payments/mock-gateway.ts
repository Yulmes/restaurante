import type { DemoScenario, PaymentFailureCode } from '@marea-baja/shared';
import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '../../generated/prisma/client.ts';
import type { Clock } from '../../lib/clock.ts';
import type { AuthorizeInput, GatewayResult, PaymentGateway, RetrieveResult } from './gateway.ts';

/**
 * Procesador **simulado** (§7.4). No mueve dinero, no conoce tarjetas y no llama a ningún servicio
 * externo: guarda sus "transacciones" en `MockGatewayTransaction`, la tabla del procesador, que el
 * módulo de pagos nunca lee directamente (§6.1).
 *
 * Escenarios de `authorize`:
 * - `APPROVED`: autoriza.
 * - `DECLINED`, `INSUFFICIENT_FUNDS`, `PROCESSOR_ERROR`: rechaza con su código.
 * - `TIMEOUT`: **autoriza internamente** pero responde sin resultado. La reconciliación encuentra
 *   la autorización con `retrieve` y no se cobra dos veces.
 * - `PENDING`: queda pendiente y se aprueba sola a los `pendingResolveMs` (unos 20 s).
 *
 * `capture`, `void` y `refund` dejan una fila "marca" con su clave de idempotencia: repetir la
 * misma clave devuelve el mismo resultado sin volver a aplicar la operación.
 */
export const PENDING_RESOLVE_MS = 20_000;

const DECLINE_CODES: Partial<Record<DemoScenario, PaymentFailureCode>> = {
  DECLINED: 'card_declined',
  INSUFFICIENT_FUNDS: 'insufficient_funds',
  PROCESSOR_ERROR: 'processor_error',
};

type Tx = Prisma.TransactionClient;
type Row = Prisma.MockGatewayTransactionGetPayload<object>;

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** Las filas de operaciones (captura, anulación, reembolso) se reconocen por su prefijo. */
const OPERATION_PREFIX = 'mockop_';

export class MockGateway implements PaymentGateway {
  readonly #db: PrismaClient;
  readonly #clock: Clock;
  readonly #pendingResolveMs: number;

  constructor(deps: { db: PrismaClient; clock: Clock; pendingResolveMs?: number }) {
    this.#db = deps.db;
    this.#clock = deps.clock;
    this.#pendingResolveMs = deps.pendingResolveMs ?? PENDING_RESOLVE_MS;
  }

  async authorize(input: AuthorizeInput): Promise<GatewayResult> {
    const existing = await this.#byKey(input.idempotencyKey);
    if (existing) return this.#resolve(existing);
    const now = this.#clock.now();
    const declined = DECLINE_CODES[input.scenario];
    const state = declined ? 'DECLINED' : input.scenario === 'PENDING' ? 'PENDING' : 'AUTHORIZED';
    try {
      const row = await this.#db.mockGatewayTransaction.create({
        data: {
          ref: `mock_${randomUUID()}`,
          idempotencyKey: input.idempotencyKey,
          amountMinor: input.amountMinor,
          currency: input.currency,
          state,
          scenario: input.scenario,
          resolveAt: state === 'PENDING' ? new Date(now.getTime() + this.#pendingResolveMs) : null,
          createdAt: now,
        },
      });
      // Tiempo agotado: la autorización existe, pero quien llamó no se entera (§7.4).
      if (input.scenario === 'TIMEOUT') return { outcome: 'UNKNOWN' };
      return await this.#resolve(row);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await this.#byKey(input.idempotencyKey);
      return raced ? this.#resolve(raced) : { outcome: 'UNKNOWN' };
    }
  }

  capture(input: { ref: string; amountMinor: number; idempotencyKey: string }): Promise<GatewayResult> {
    return this.#operate(input.idempotencyKey, input.ref, async (tx, parent) => {
      if (parent.state !== 'AUTHORIZED' || input.amountMinor > parent.amountMinor) return null;
      await tx.mockGatewayTransaction.update({
        where: { id: parent.id },
        data: { state: 'CAPTURED', capturedMinor: input.amountMinor },
      });
      return { state: 'CAPTURED', amountMinor: input.amountMinor };
    });
  }

  void(input: { ref: string; idempotencyKey: string }): Promise<GatewayResult> {
    return this.#operate(input.idempotencyKey, input.ref, async (tx, parent) => {
      if (parent.state !== 'AUTHORIZED') return null;
      await tx.mockGatewayTransaction.update({ where: { id: parent.id }, data: { state: 'VOIDED' } });
      return { state: 'VOIDED', amountMinor: 0 };
    });
  }

  refund(input: { ref: string; amountMinor: number; idempotencyKey: string }): Promise<GatewayResult> {
    return this.#operate(input.idempotencyKey, input.ref, async (tx, parent) => {
      const refunded = parent.refundedMinor + input.amountMinor;
      if (
        (parent.state !== 'CAPTURED' && parent.state !== 'PARTIALLY_REFUNDED') ||
        input.amountMinor <= 0 ||
        refunded > parent.capturedMinor
      ) {
        return null;
      }
      await tx.mockGatewayTransaction.update({
        where: { id: parent.id },
        data: {
          refundedMinor: refunded,
          state: refunded === parent.capturedMinor ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
        },
      });
      return { state: 'REFUNDED', amountMinor: input.amountMinor };
    });
  }

  async retrieve(idempotencyKey: string): Promise<RetrieveResult> {
    const row = await this.#byKey(idempotencyKey);
    if (!row) return { outcome: 'NOT_FOUND' };
    return row.ref.startsWith(OPERATION_PREFIX) ? { outcome: 'SUCCEEDED', ref: row.ref } : this.#resolve(row);
  }

  #byKey(idempotencyKey: string): Promise<Row | null> {
    return this.#db.mockGatewayTransaction.findUnique({ where: { idempotencyKey } });
  }

  /** Resultado de una autorización; un pendiente vencido se aprueba en ese momento. */
  async #resolve(row: Row): Promise<GatewayResult> {
    if (row.state === 'DECLINED') {
      return { outcome: 'DECLINED', code: DECLINE_CODES[row.scenario] ?? 'card_declined', ref: row.ref };
    }
    if (row.state === 'PENDING') {
      if (!row.resolveAt || row.resolveAt > this.#clock.now()) return { outcome: 'PENDING', ref: row.ref };
      await this.#db.mockGatewayTransaction.updateMany({
        where: { id: row.id, state: 'PENDING' },
        data: { state: 'AUTHORIZED', resolveAt: null },
      });
    }
    return { outcome: 'SUCCEEDED', ref: row.ref };
  }

  /**
   * Captura, anulación o reembolso: con la transacción del procesador bloqueada, aplica el cambio
   * y deja la fila marca con la clave. Si la clave ya existe, devuelve el mismo resultado.
   */
  async #operate(
    idempotencyKey: string,
    ref: string,
    apply: (
      tx: Tx,
      parent: Row,
    ) => Promise<{ state: 'CAPTURED' | 'VOIDED' | 'REFUNDED'; amountMinor: number } | null>,
  ): Promise<GatewayResult> {
    try {
      return await this.#db.$transaction(async (tx) => {
        const done = await tx.mockGatewayTransaction.findUnique({ where: { idempotencyKey } });
        if (done) return { outcome: 'SUCCEEDED', ref: done.ref } as const;
        await tx.$queryRaw`SELECT "id" FROM "MockGatewayTransaction" WHERE "ref" = ${ref} FOR UPDATE`;
        const parent = await tx.mockGatewayTransaction.findUnique({ where: { ref } });
        if (!parent) return { outcome: 'DECLINED', code: 'processor_error', ref: null } as const;
        const applied = await apply(tx, parent);
        if (!applied) return { outcome: 'DECLINED', code: 'processor_error', ref: parent.ref } as const;
        const marker = await tx.mockGatewayTransaction.create({
          data: {
            ref: `${OPERATION_PREFIX}${randomUUID()}`,
            idempotencyKey,
            amountMinor: applied.amountMinor,
            currency: parent.currency,
            state: applied.state,
            scenario: 'APPROVED',
            capturedMinor: applied.state === 'VOIDED' ? 0 : applied.amountMinor,
            refundedMinor: applied.state === 'REFUNDED' ? applied.amountMinor : 0,
            createdAt: this.#clock.now(),
          },
        });
        return { outcome: 'SUCCEEDED', ref: marker.ref } as const;
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const done = await this.#byKey(idempotencyKey);
      return done ? { outcome: 'SUCCEEDED', ref: done.ref } : { outcome: 'UNKNOWN' };
    }
  }
}
