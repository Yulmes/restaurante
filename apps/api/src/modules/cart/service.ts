import {
  CART_MAX_LINES,
  PRODUCT_MAX_QUANTITY,
  lineKey,
  type CartLineInput,
  type CartMergeResponse,
  type CartView,
  type Locale,
  type UnavailableReason,
} from '@marea-baja/shared';
import { createHash } from 'node:crypto';
import type { PrismaClient } from '../../generated/prisma/client.ts';
import { AppError } from '../../http/errors.ts';
import type { Clock } from '../../lib/clock.ts';
import { ORDER_TIMING } from '../orders/policies.ts';
import {
  cartView,
  loadCartSettings,
  loadProducts,
  resolveLine,
  toSelectable,
  type Db,
  type ResolvedLine,
} from './catalog-lines.ts';
import { groupLines, selectionProblem, splitQuantity, type GroupedLine } from './lines.ts';

/**
 * Carrito (§7.5, D3, regla C5).
 * - **Invitado:** vive en el navegador; la API solo lo valoriza (`quote`), sin guardar nada.
 * - **Cuenta:** tabla `Cart` + `CartItem` (líneas internas de hasta 20, CHECK de M2). La API
 *   gestiona la cantidad **total** de cada identidad (plato + opciones ordenadas) y la reparte en
 *   bloques de hasta 20 en la misma transacción. La interfaz nunca ve las líneas internas.
 * - **Concurrencia:** toda escritura bloquea la fila del carrito (`SELECT … FOR UPDATE`).
 */
interface StoredGroup extends GroupedLine {
  firstCreatedAt: Date;
}

export interface CartLineChange {
  productId: string;
  optionIds: readonly string[];
  quantity: number;
  mode: 'add' | 'set';
}

export class CartService {
  readonly #db: PrismaClient;
  readonly #clock: Clock;

  constructor(db: PrismaClient, clock: Clock) {
    this.#db = db;
    this.#clock = clock;
  }

  /** Valoriza un carrito de invitado con los precios y la disponibilidad vigentes. */
  async quote(locale: Locale, lines: readonly CartLineInput[]): Promise<CartView> {
    const grouped = groupLines(lines.map((l) => ({ ...l, optionIds: l.optionIds ?? [] })));
    const resolved = await this.#resolve(this.#db, grouped, locale);
    return cartView(resolved, await loadCartSettings(this.#db));
  }

  async get(userId: string, locale: Locale): Promise<CartView> {
    const cart = await this.#db.cart.findUnique({ where: { userId }, select: { id: true } });
    const groups = cart ? await readGroups(this.#db, cart.id) : [];
    return this.view(this.#db, groups, locale);
  }

  /** Suma (`add`) o fija (`set`) la cantidad total de una identidad. `set` con 0 la quita. */
  async change(userId: string, locale: Locale, change: CartLineChange): Promise<CartView> {
    return this.#db.$transaction(async (tx) => {
      const cartId = await lockCart(tx, userId);
      const before = await readGroups(tx, cartId);
      const optionIds = [...new Set(change.optionIds)].sort();
      const key = lineKey(change.productId, optionIds);
      const current = before.find((g) => g.key === key)?.quantity ?? 0;
      const total = change.mode === 'add' ? current + change.quantity : change.quantity;
      if (total > PRODUCT_MAX_QUANTITY) {
        throw new AppError(422, 'VALIDATION_FAILED', 'Quantity above the technical cap', {
          fields: { quantity: 'tooMany' },
        });
      }
      if (total > 0) {
        const products = await loadProducts(tx, [change.productId]);
        const reason = selectionProblem(toSelectable(products.get(change.productId)), optionIds);
        if (reason) {
          throw new AppError(409, 'ITEMS_UNAVAILABLE', 'Item cannot be ordered', {
            details: { lines: [{ productId: change.productId, optionIds, reason }] },
          });
        }
      }
      const after = upsertGroup(before, { key, productId: change.productId, optionIds, quantity: total });
      if (after.length > CART_MAX_LINES) {
        throw new AppError(422, 'VALIDATION_FAILED', 'Too many cart lines', { fields: { lines: 'tooMany' } });
      }
      await this.#persist(tx, cartId, before, after);
      return this.view(tx, after, locale);
    });
  }

  /**
   * Fusiona el carrito del invitado con el de la cuenta (§7.5):
   * - **idempotente por `mergeKey`:** cada clave fusionada queda registrada (no solo la última:
   *   `Cart.lastMergeKey` sola permitiría volver a sumar A después de A → B → A). La misma clave
   *   devuelve el carrito actual sin tocar nada;
   * - suma por identidad de línea (no toma el máximo ni sobrescribe);
   * - las líneas que no se pueden pedir no se guardan ni se descartan en silencio: vuelven en
   *   `unavailable[]` con su motivo.
   */
  async merge(
    userId: string,
    locale: Locale,
    mergeKey: string,
    lines: readonly CartLineInput[],
  ): Promise<CartMergeResponse> {
    return this.#db.$transaction(async (tx) => {
      const cartId = await lockCart(tx, userId);
      const before = await readGroups(tx, cartId);
      const scope = `cart.merge:${userId}`;
      const seen = await tx.idempotencyKey.findUnique({
        where: { scope_key: { scope, key: mergeKey } },
        select: { id: true },
      });
      if (seen) {
        return { cart: await this.view(tx, before, locale), unavailable: [], alreadyMerged: true };
      }

      const now = this.#clock.now();
      const guest = groupLines(lines.map((l) => ({ ...l, optionIds: l.optionIds ?? [] })));
      await tx.idempotencyKey.create({
        data: {
          scope,
          key: mergeKey,
          userId,
          requestHash: hashJson(guest.map((g) => [g.key, g.quantity])),
          responseStatus: 200,
          expiresAt: new Date(now.getTime() + ORDER_TIMING.mergeKeyTtlMs),
        },
      });

      const products = await loadProducts(
        tx,
        guest.map((g) => g.productId),
      );
      const unavailable: CartMergeResponse['unavailable'] = [];
      let after: GroupedLine[] = before.map((g) => ({ ...g }));
      for (const line of guest) {
        const record = products.get(line.productId);
        const reason = selectionProblem(toSelectable(record), line.optionIds);
        if (reason) {
          unavailable.push(rejected(line, line.quantity, reason, record?.name));
          continue;
        }
        const existing = after.find((g) => g.key === line.key);
        if (!existing && after.length >= CART_MAX_LINES) {
          unavailable.push(rejected(line, line.quantity, 'QUANTITY_LIMIT', record?.name));
          continue;
        }
        const sum = (existing?.quantity ?? 0) + line.quantity;
        const kept = Math.min(sum, PRODUCT_MAX_QUANTITY);
        if (kept < sum) unavailable.push(rejected(line, sum - kept, 'QUANTITY_LIMIT', record?.name));
        after = upsertGroup(after, { ...line, quantity: kept });
      }

      await this.#persist(tx, cartId, before, after);
      await tx.cart.update({ where: { id: cartId }, data: { lastMergeKey: mergeKey, mergedAt: now } });
      return { cart: await this.view(tx, after, locale), unavailable, alreadyMerged: false };
    });
  }

  async view(db: Db, groups: readonly GroupedLine[], locale: Locale): Promise<CartView> {
    const resolved = await this.#resolve(db, groups, locale);
    return cartView(resolved, await loadCartSettings(db));
  }

  async #resolve(db: Db, groups: readonly GroupedLine[], locale: Locale): Promise<ResolvedLine[]> {
    const products = await loadProducts(
      db,
      groups.map((g) => g.productId),
    );
    return groups.map((g) => resolveLine(g, products.get(g.productId), locale));
  }

  /**
   * Reescribe solo las identidades que cambiaron, en bloques de hasta 20 (C5). Cada identidad
   * conserva su posición (fecha de su primera línea); las nuevas van al final.
   */
  async #persist(
    db: Db,
    cartId: string,
    before: readonly StoredGroup[],
    after: readonly GroupedLine[],
  ): Promise<void> {
    const now = this.#clock.now().getTime();
    // Las identidades nuevas van siempre después de las existentes, aunque el reloj no avance.
    const latest = Math.max(-1, ...before.map((g) => g.firstCreatedAt.getTime()));
    const start = Math.max(now, latest + 1);
    const keep = new Map(after.map((g) => [g.key, g]));
    for (const old of before) {
      const next = keep.get(old.key);
      if (next?.quantity !== old.quantity) await deleteGroup(db, cartId, old);
    }
    let appended = 0;
    for (const group of after) {
      const old = before.find((g) => g.key === group.key);
      if (old?.quantity === group.quantity) continue;
      if (group.quantity === 0) continue;
      const createdAt = old ? old.firstCreatedAt : new Date(start + appended++);
      for (const quantity of splitQuantity(group.quantity)) {
        await db.cartItem.create({
          data: {
            cartId,
            productId: group.productId,
            quantity,
            createdAt,
            options: { create: group.optionIds.map((optionId) => ({ optionId })) },
          },
        });
      }
    }
    await db.cart.update({ where: { id: cartId }, data: { updatedAt: new Date(now) } });
  }
}

function rejected(
  line: GroupedLine,
  quantity: number,
  reason: UnavailableReason,
  name: string | undefined,
): CartMergeResponse['unavailable'][number] {
  return { productId: line.productId, optionIds: line.optionIds, quantity, reason, name: name ?? null };
}

function upsertGroup(groups: readonly GroupedLine[], next: GroupedLine): GroupedLine[] {
  const index = groups.findIndex((g) => g.key === next.key);
  if (next.quantity === 0) return groups.filter((g) => g.key !== next.key);
  if (index === -1) return [...groups, next];
  return groups.map((g, i) => (i === index ? { ...g, quantity: next.quantity } : g));
}

export function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('base64url');
}

/**
 * Crea el carrito si falta y bloquea su fila hasta el fin de la transacción. Dos peticiones a la
 * vez sobre el mismo carrito se ejecutan una después de la otra.
 */
export async function lockCart(db: Db, userId: string): Promise<string> {
  await db.$executeRaw`
    INSERT INTO "Cart" ("userId", "updatedAt") VALUES (${userId}::uuid, now())
    ON CONFLICT ("userId") DO NOTHING`;
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Cart" WHERE "userId" = ${userId}::uuid FOR UPDATE`;
  const id = rows[0]?.id;
  if (!id) throw new Error('No se pudo bloquear el carrito');
  return id;
}

/** Líneas internas agrupadas por identidad, en el orden en que se agregaron. */
export async function readGroups(db: Db, cartId: string): Promise<StoredGroup[]> {
  const items = await db.cartItem.findMany({
    where: { cartId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { productId: true, quantity: true, createdAt: true, options: { select: { optionId: true } } },
  });
  const groups = new Map<string, StoredGroup>();
  for (const item of items) {
    const optionIds = item.options.map((o) => o.optionId).sort();
    const key = lineKey(item.productId, optionIds);
    const current = groups.get(key);
    if (current) current.quantity += item.quantity;
    else
      groups.set(key, {
        key,
        productId: item.productId,
        optionIds,
        quantity: item.quantity,
        firstCreatedAt: item.createdAt,
      });
  }
  return [...groups.values()];
}

async function deleteGroup(db: Db, cartId: string, group: GroupedLine): Promise<void> {
  const items = await db.cartItem.findMany({
    where: { cartId, productId: group.productId },
    select: { id: true, options: { select: { optionId: true } } },
  });
  const ids = items
    .filter(
      (item) =>
        lineKey(
          group.productId,
          item.options.map((o) => o.optionId),
        ) === group.key,
    )
    .map((item) => item.id);
  if (ids.length > 0) await db.cartItem.deleteMany({ where: { id: { in: ids } } });
}

/** Vacía el carrito de la cuenta (al crear el pedido, en la misma transacción). */
export async function clearCart(db: Db, cartId: string): Promise<void> {
  await db.cartItem.deleteMany({ where: { cartId } });
}
