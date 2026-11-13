/**
 * Ayudas para las pruebas contra PostgreSQL. Cada caso corre en una transacción que siempre se
 * revierte, así las pruebas no dejan datos ni dependen del orden.
 */
import pg from 'pg';
import { expect, inject } from 'vitest';

export type Query = (sql: string, params?: readonly unknown[]) => Promise<pg.QueryResult>;

export const ownerUrl = (): string => inject('ownerUrl');
export const appUrl = (): string => inject('appUrl');

/** Ejecuta `fn` dentro de BEGIN … ROLLBACK con el rol de la URL. */
export async function inRolledBackTx<T>(url: string, fn: (q: Query) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('BEGIN');
    return await fn((sql, params) => client.query(sql, params as unknown[] | undefined));
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
  }
}

interface PgError {
  code: string;
  constraint?: string;
  message: string;
}

function isPgError(error: unknown): error is PgError {
  return typeof error === 'object' && error !== null && 'code' in error && 'message' in error;
}

/** Afirma que `fn` falla con el código de PostgreSQL esperado (y la restricción, si se indica). */
export async function expectPgError(
  url: string,
  fn: (q: Query) => Promise<unknown>,
  expected: { code: string; constraint?: string; message?: RegExp },
): Promise<void> {
  let caught: unknown;
  try {
    await inRolledBackTx(url, fn);
  } catch (error) {
    caught = error;
  }
  if (!isPgError(caught)) throw new Error('Se esperaba un error de PostgreSQL y la operación se completó.');
  expect(caught.code).toBe(expected.code);
  if (expected.constraint) expect(caught.constraint).toBe(expected.constraint);
  if (expected.message) expect(caught.message).toMatch(expected.message);
}

/** Códigos SQLSTATE usados en las pruebas. */
export const PG = {
  uniqueViolation: '23505',
  checkViolation: '23514',
  foreignKeyViolation: '23503',
  insufficientPrivilege: '42501',
  invalidTextRepresentation: '22P02',
} as const;

// ─── Datos mínimos para las pruebas ─────────────────────────────────────────

export async function insertUser(q: Query, email = 'prueba@marea.test'): Promise<string> {
  const { rows } = await q(
    `INSERT INTO "User" ("email", "passwordHash", "name", "updatedAt") VALUES ($1, 'hash', 'Prueba', now()) RETURNING "id"`,
    [email],
  );
  return (rows[0] as { id: string }).id;
}

export async function anyProductId(q: Query): Promise<string> {
  const { rows } = await q(`SELECT "id" FROM "Product" ORDER BY "slug" LIMIT 1`);
  return (rows[0] as { id: string }).id;
}

export async function anyZoneId(q: Query): Promise<string> {
  const { rows } = await q(`SELECT "id" FROM "DeliveryZone" ORDER BY "key" LIMIT 1`);
  return (rows[0] as { id: string }).id;
}

interface OrderOverrides {
  code?: string;
  fulfillmentType?: string;
  deliveryZoneId?: string | null;
  subtotalMinor?: number;
  roundingAdjustmentMinor?: number;
}

/** Pedido de retiro válido; los parámetros permiten romper una regla a la vez. */
export async function insertOrder(q: Query, userId: string, overrides: OrderOverrides = {}): Promise<string> {
  const { rows } = await q(
    `INSERT INTO "Order" ("code", "userId", "fulfillmentType", "deliveryZoneId", "orderLocale", "currency",
       "currencyMinorUnits", "subtotalMinor", "taxTotalMinor", "roundingAdjustmentMinor", "totalMinor",
       "pricesIncludeTax", "updatedAt")
     VALUES ($1, $2, $3, $4, 'es-CR', 'CRC', 2, $5, 102389, $6, 890000, true, now())
     RETURNING "id"`,
    [
      overrides.code ?? 'MB-0001',
      userId,
      overrides.fulfillmentType ?? 'PICKUP',
      overrides.deliveryZoneId ?? null,
      overrides.subtotalMinor ?? 890000,
      overrides.roundingAdjustmentMinor ?? 0,
    ],
  );
  return (rows[0] as { id: string }).id;
}

export async function insertCart(q: Query, userId: string): Promise<string> {
  const { rows } = await q(`INSERT INTO "Cart" ("userId", "updatedAt") VALUES ($1, now()) RETURNING "id"`, [
    userId,
  ]);
  return (rows[0] as { id: string }).id;
}

export async function insertPayment(
  q: Query,
  orderId: string,
  amounts: { authorized: number; captured: number; refunded: number },
): Promise<string> {
  const { rows } = await q(
    `INSERT INTO "Payment" ("orderId", "method", "status", "currency", "amountAuthorizedMinor",
       "amountCapturedMinor", "amountRefundedMinor", "updatedAt")
     VALUES ($1, 'DEMO_CARD', 'CAPTURED', 'CRC', $2, $3, $4, now()) RETURNING "id"`,
    [orderId, amounts.authorized, amounts.captured, amounts.refunded],
  );
  return (rows[0] as { id: string }).id;
}

export async function insertAudit(q: Query, entityId = 'p-1'): Promise<string> {
  const { rows } = await q(
    `INSERT INTO "AuditLog" ("action", "entityType", "entityId", "after")
     VALUES ('product.price_changed', 'Product', $1, '{"basePriceMinor": 900000}') RETURNING "id"`,
    [entityId],
  );
  return (rows[0] as { id: string }).id;
}
