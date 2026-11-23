import {
  CURRENCIES,
  lineKey,
  type CheckoutProblem,
  type CheckoutQuote,
  type FulfillmentType,
  type Locale,
  type Order,
  type OrderResponse,
} from '@marea-baja/shared';
import { randomInt } from 'node:crypto';
import type { AppConfig } from '../../config/app-config.ts';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.ts';
import { AppError } from '../../http/errors.ts';
import type { Clock } from '../../lib/clock.ts';
import { activeZones, zoneForDistrict } from '../addresses/service.ts';
import { cartView, loadProducts, resolveLine, type Db, type ResolvedLine } from '../cart/catalog-lines.ts';
import { isOpenAt, splitQuantity } from '../cart/lines.ts';
import { clearCart, hashJson, lockCart, readGroups } from '../cart/service.ts';
import { HttpIdempotency } from '../idempotency/http-idempotency.ts';
import { customerPayment, paymentViewInclude, type PaymentContext } from '../payments/view.ts';
import { priceOrder, type PricingResult } from '../pricing/engine.ts';
import { ORDER_TIMING } from './policies.ts';

/**
 * Checkout y pedidos (M5, §7.3).
 *
 * - **Todo se recalcula en el servidor:** precios, opciones, disponibilidad, zona, envío,
 *   impuestos y total salen de la base dentro de la transacción. El cuerpo solo trae la
 *   modalidad, la dirección (por id, de la propia cuenta), los datos de contacto y la huella de la
 *   cotización que el cliente aceptó.
 * - **Cambio de precio (D-M5-2):** si la huella recalculada no coincide con la aceptada, `409
 *   PRICE_CHANGED` con la cotización nueva. Nunca se registra un pedido con otro importe.
 * - **Pago (D-M5-1):** el pedido queda en `PENDING_PAYMENT` con su `Payment` en
 *   `REQUIRES_PAYMENT`. El pago (tarjeta demo o contra entrega) es un paso aparte (M6, §7.3).
 * - **Idempotencia (§7.3, punto 1):** `Idempotency-Key` + `requestHash`. Misma clave y cuerpo →
 *   la respuesta original; otro cuerpo → 422; en curso → 409.
 * - **Duplicados (§7.3, punto 5):** mismo usuario y carrito idéntico en menos de 60 s → el pedido
 *   existente, aunque llegue con otra clave.
 */
const ORDER_SCOPE = 'orders.create';
export { orderInclude, type OrderRow };
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export interface CheckoutInput {
  locale: Locale;
  fulfillmentType: FulfillmentType;
  addressId?: string | null | undefined;
}

export interface CreateOrderInput extends CheckoutInput {
  contactPhone?: string | null | undefined;
  customerNote?: string | null | undefined;
  quoteVersion: string;
}

interface AddressSnapshot {
  label: string;
  line1: string;
  line2: string | null;
  district: string;
  canton: string;
  province: string;
  reference: string;
}

interface Checkout {
  quote: CheckoutQuote;
  resolved: ResolvedLine[];
  pricing: PricingResult;
  settings: { currency: 'CRC' | 'USD'; pricesIncludeTax: boolean };
  zone: { id: string; name: string; etaMinutes: number } | null;
  address: AddressSnapshot | null;
}

interface FingerprintInput {
  currency: string;
  fulfillmentType: string;
  zoneId: string | null;
  lines: readonly { key: string; quantity: number; unitPriceMinor: number; lineTotalMinor: number }[];
  deliveryFeeMinor: number;
  discountMinor: number;
  taxLines: readonly {
    name: string;
    rateBps: number;
    inclusive: boolean;
    taxableBaseMinor: number;
    taxMinor: number;
  }[];
  totalMinor: number;
}

/**
 * Huella de una cotización: modalidad, zona, líneas (identidad, cantidad, precio), envío,
 * descuento, impuestos y total. Se calcula igual desde un carrito y desde un pedido guardado.
 */
export function quoteFingerprint(input: FingerprintInput): string {
  const canonical = {
    c: input.currency,
    f: input.fulfillmentType,
    z: input.zoneId,
    l: [...input.lines]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((l) => [l.key, l.quantity, l.unitPriceMinor, l.lineTotalMinor]),
    d: input.deliveryFeeMinor,
    s: input.discountMinor,
    x: [...input.taxLines]
      .map((t) => [t.name, t.rateBps, t.inclusive, t.taxableBaseMinor, t.taxMinor] as const)
      .sort((a, b) => `${a[0]}|${String(a[1])}`.localeCompare(`${b[0]}|${String(b[1])}`)),
    t: input.totalMinor,
  };
  return hashJson(canonical).slice(0, 32);
}

const orderInclude = {
  items: {
    orderBy: { id: 'asc' },
    include: { options: { orderBy: { id: 'asc' } } },
  },
  taxLines: { orderBy: { id: 'asc' } },
  deliveryZone: { select: { name: true, etaMinutes: true } },
  payment: paymentViewInclude,
} as const satisfies Prisma.OrderInclude;
type OrderRow = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

function groupOrderItems(row: OrderRow): Order['items'] {
  const groups = new Map<string, Order['items'][number]>();
  for (const item of row.items) {
    const optionIds = item.options.map((o) => o.optionId ?? `label:${o.labelEsCr}`);
    const key = item.productId
      ? lineKey(item.productId, optionIds)
      : `name:${item.productName}:${optionIds.sort().join(',')}`;
    const unitPriceMinor = item.unitPriceMinor + item.optionsTotalMinor;
    const current = groups.get(key);
    if (current) {
      current.quantity += item.quantity;
      current.lineTotalMinor += item.lineTotalMinor;
      continue;
    }
    groups.set(key, {
      key,
      productId: item.productId,
      name: item.productName,
      translatedName: item.productNameLocalized,
      quantity: item.quantity,
      unitPriceMinor,
      lineTotalMinor: item.lineTotalMinor,
      options: item.options.map((o) => ({
        group: o.groupLabel,
        label: o.label,
        priceDeltaMinor: o.priceDeltaMinor,
      })),
    });
  }
  return [...groups.values()];
}

export function toOrder(row: OrderRow, payment: PaymentContext): Order {
  return {
    id: row.id,
    code: row.code,
    status: row.status,
    fulfillmentType: row.fulfillmentType,
    orderLocale: row.orderLocale === 'en' ? 'en' : 'es-CR',
    currency: row.currency,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    items: groupOrderItems(row),
    totals: {
      subtotalMinor: row.subtotalMinor,
      discountMinor: row.discountMinor,
      deliveryFeeMinor: row.deliveryFeeMinor,
      taxLines: row.taxLines.map((t) => ({
        name: t.name,
        rateBps: t.rateBps,
        inclusive: t.inclusive,
        taxableBaseMinor: t.taxableBaseMinor,
        taxMinor: t.taxMinor,
      })),
      taxTotalMinor: row.taxTotalMinor,
      roundingAdjustmentMinor: row.roundingAdjustmentMinor,
      totalMinor: row.totalMinor,
    },
    deliveryZone: row.deliveryZone,
    deliveryAddress: (row.deliveryAddress as AddressSnapshot | null) ?? null,
    contactPhone: row.contactPhone,
    customerNote: row.customerNote,
    payment: customerPayment(row, payment),
  };
}

/** Huella de un pedido guardado, comparable con la de una cotización (detección de duplicados). */
function orderFingerprint(row: OrderRow): string {
  return quoteFingerprint({
    currency: row.currency,
    fulfillmentType: row.fulfillmentType,
    zoneId: row.deliveryZoneId,
    lines: groupOrderItems(row),
    deliveryFeeMinor: row.deliveryFeeMinor,
    discountMinor: row.discountMinor,
    taxLines: row.taxLines,
    totalMinor: row.totalMinor,
  });
}

function problemError(problem: CheckoutProblem, checkout: Checkout): AppError {
  switch (problem) {
    case 'CART_EMPTY':
      return new AppError(409, 'CART_EMPTY', 'Cart is empty');
    case 'FULFILLMENT_UNAVAILABLE':
      return new AppError(409, 'FULFILLMENT_UNAVAILABLE', 'Fulfillment type not enabled');
    case 'OUTSIDE_OPENING_HOURS':
      return new AppError(409, 'OUTSIDE_OPENING_HOURS', 'Restaurant is closed');
    case 'ITEMS_UNAVAILABLE':
      return new AppError(409, 'ITEMS_UNAVAILABLE', 'Some items cannot be ordered', {
        details: { lines: checkout.quote.cart.lines.filter((l) => !l.available) },
      });
    case 'ADDRESS_REQUIRED':
      return new AppError(422, 'ADDRESS_REQUIRED', 'Delivery needs an address');
    case 'DELIVERY_ZONE_UNAVAILABLE':
      return new AppError(422, 'DELIVERY_ZONE_UNAVAILABLE', 'Address outside the delivery zones');
    case 'MIN_ORDER_NOT_MET':
      return new AppError(422, 'MIN_ORDER_NOT_MET', 'Minimum order not met', {
        details: {
          minOrderMinor: checkout.quote.cart.minOrderMinor,
          subtotalMinor: checkout.quote.cart.subtotalMinor,
        },
      });
  }
}

/** Orden en que se informan los problemas: el primero es el que bloquea. */
const PROBLEM_ORDER: readonly CheckoutProblem[] = [
  'CART_EMPTY',
  'FULFILLMENT_UNAVAILABLE',
  'OUTSIDE_OPENING_HOURS',
  'ITEMS_UNAVAILABLE',
  'ADDRESS_REQUIRED',
  'DELIVERY_ZONE_UNAVAILABLE',
  'MIN_ORDER_NOT_MET',
];

export class OrderService {
  readonly #db: PrismaClient;
  readonly #clock: Clock;
  readonly #config: AppConfig;
  readonly #idempotency: HttpIdempotency;

  constructor(deps: { db: PrismaClient; clock: Clock; config: AppConfig }) {
    this.#db = deps.db;
    this.#clock = deps.clock;
    this.#config = deps.config;
    this.#idempotency = new HttpIdempotency(deps.db, deps.clock, {
      lockMs: ORDER_TIMING.idempotencyLockMs,
      ttlMs: ORDER_TIMING.idempotencyTtlMs,
    });
  }

  #paymentContext(): PaymentContext {
    return { now: this.#clock.now(), demoCardEnabled: this.#config.demoPaymentsEnabled };
  }

  /** Cotización del checkout: lo mismo que se validará al confirmar, sin escribir nada. */
  async quote(userId: string, input: CheckoutInput): Promise<CheckoutQuote> {
    return (await this.#checkout(this.#db, userId, input)).quote;
  }

  async #checkout(db: Db, userId: string, input: CheckoutInput): Promise<Checkout> {
    const now = this.#clock.now();
    const [settings, cart, taxRates] = await Promise.all([
      db.restaurantSettings.findUnique({ where: { id: 1 }, include: { openingHours: true } }),
      db.cart.findUnique({ where: { userId }, select: { id: true } }),
      db.taxRate.findMany(),
    ]);
    if (!settings) throw new Error('Falta RestaurantSettings (semilla de M2)');
    const groups = cart ? await readGroups(db, cart.id) : [];
    const products = await loadProducts(
      db,
      groups.map((g) => g.productId),
    );
    const resolved = groups.map((g) => resolveLine(g, products.get(g.productId), input.locale));
    const view = cartView(resolved, { currency: settings.currency, minOrderMinor: settings.minOrderMinor });

    const problems = new Set<CheckoutProblem>();
    if (groups.length === 0) problems.add('CART_EMPTY');
    if (resolved.some((r) => !r.view.available)) problems.add('ITEMS_UNAVAILABLE');
    const enabled = input.fulfillmentType === 'PICKUP' ? settings.pickupEnabled : settings.deliveryEnabled;
    if (!enabled) problems.add('FULFILLMENT_UNAVAILABLE');
    const openNow = isOpenAt(now, settings.timezone, settings.openingHours);
    const orderingAllowed = openNow || this.#config.ordersAllowOutsideHours;
    if (!orderingAllowed) problems.add('OUTSIDE_OPENING_HOURS');

    let zone: Checkout['zone'] = null;
    let zoneFee = 0;
    let address: AddressSnapshot | null = null;
    let quoteZone: CheckoutQuote['deliveryZone'] = null;
    if (input.fulfillmentType === 'DELIVERY') {
      if (!input.addressId) {
        problems.add('ADDRESS_REQUIRED');
      } else {
        const row = await db.address.findFirst({
          where: { id: input.addressId, userId },
          select: {
            label: true,
            line1: true,
            line2: true,
            district: true,
            canton: true,
            province: true,
            reference: true,
          },
        });
        // Ajena o inexistente: 404, sin confirmar que exista (§8.7).
        if (!row) throw new AppError(404, 'NOT_FOUND', 'Address not found');
        address = row;
        const found = zoneForDistrict(await activeZones(db), row.district);
        if (found) {
          zone = { id: found.id, name: found.name, etaMinutes: found.etaMinutes };
          zoneFee = found.feeMinor;
          quoteZone = {
            id: found.id,
            name: found.name,
            feeMinor: found.feeMinor,
            etaMinutes: found.etaMinutes,
          };
        } else {
          problems.add('DELIVERY_ZONE_UNAVAILABLE');
        }
      }
    }

    const available = resolved.filter((r) => r.view.available);
    const pricing = priceOrder({
      pricesIncludeTax: settings.pricesIncludeTax,
      roundingIncrementMinor: settings.roundingIncrementMinor,
      fulfillmentType: input.fulfillmentType,
      lines: available.map((r) => ({
        key: r.view.key,
        unitPriceMinor: r.view.unitPriceMinor,
        quantity: r.view.quantity,
        taxRateIds: r.record?.taxRates.map((t) => t.taxRateId) ?? [],
      })),
      taxRates: taxRates.map((t) => ({
        id: t.id,
        name: t.name,
        rateBps: t.rateBps,
        appliesTo: t.appliesTo,
        fulfillmentTypes: t.fulfillmentTypes,
        isActive: t.isActive,
      })),
      deliveryFeeMinor: zoneFee,
      // D-M5-5: M5 no aplica promociones; el motor ya admite descuentos (M8).
      discountMinor: 0,
    });
    if (groups.length > 0 && !view.meetsMinimum) problems.add('MIN_ORDER_NOT_MET');

    const totals = {
      subtotalMinor: pricing.subtotalMinor,
      discountMinor: pricing.discountMinor,
      deliveryFeeMinor: pricing.deliveryFeeMinor,
      taxLines: pricing.taxLines.map((t) => ({
        name: t.name,
        rateBps: t.rateBps,
        inclusive: t.inclusive,
        taxableBaseMinor: t.taxableBaseMinor,
        taxMinor: t.taxMinor,
      })),
      taxTotalMinor: pricing.taxTotalMinor,
      roundingAdjustmentMinor: pricing.roundingAdjustmentMinor,
      totalMinor: pricing.totalMinor,
    };
    const quoteVersion = quoteFingerprint({
      currency: settings.currency,
      fulfillmentType: input.fulfillmentType,
      zoneId: zone?.id ?? null,
      lines: available.map((r) => r.view),
      deliveryFeeMinor: totals.deliveryFeeMinor,
      discountMinor: totals.discountMinor,
      taxLines: totals.taxLines,
      totalMinor: totals.totalMinor,
    });

    return {
      quote: {
        cart: view,
        fulfillmentType: input.fulfillmentType,
        deliveryZone: quoteZone,
        totals,
        quoteVersion,
        openNow,
        orderingAllowed,
        pickupEnabled: settings.pickupEnabled,
        deliveryEnabled: settings.deliveryEnabled,
        paymentMethods: this.#config.demoPaymentsEnabled
          ? ['DEMO_CARD', 'CASH_ON_DELIVERY']
          : ['CASH_ON_DELIVERY'],
        problems: PROBLEM_ORDER.filter((p) => problems.has(p)),
      },
      resolved: available,
      pricing,
      settings: { currency: settings.currency, pricesIncludeTax: settings.pricesIncludeTax },
      zone,
      address,
    };
  }

  /**
   * Crea el pedido. Devuelve el estado HTTP y el cuerpo, que también quedan guardados con la
   * `Idempotency-Key` para responder igual a un reintento.
   */
  async create(
    userId: string,
    idempotencyKey: string,
    input: CreateOrderInput,
  ): Promise<{ status: number; body: OrderResponse }> {
    const requestHash = hashJson({
      locale: input.locale,
      fulfillmentType: input.fulfillmentType,
      addressId: input.addressId ?? null,
      contactPhone: input.contactPhone ?? null,
      customerNote: input.customerNote ?? null,
      quoteVersion: input.quoteVersion,
    });
    const claim = await this.#idempotency.claim<OrderResponse>(
      ORDER_SCOPE,
      userId,
      idempotencyKey,
      requestHash,
    );
    if ('replay' in claim) return claim.replay;

    try {
      return await this.#db.$transaction(async (tx) => {
        const now = this.#clock.now();
        // Bloquea el carrito: dos confirmaciones a la vez se ejecutan una después de la otra.
        const cartId = await lockCart(tx, userId);

        const duplicate = await this.#recentDuplicate(tx, userId, input.quoteVersion, now);
        let result: { status: number; body: OrderResponse };
        if (duplicate) {
          result = {
            status: 200,
            body: { order: toOrder(duplicate, this.#paymentContext()), duplicate: true },
          };
        } else {
          const checkout = await this.#checkout(tx, userId, input);
          const blocking = checkout.quote.problems[0];
          if (blocking) throw problemError(blocking, checkout);
          if (checkout.quote.quoteVersion !== input.quoteVersion) {
            throw new AppError(409, 'PRICE_CHANGED', 'The quote changed; confirm the new amounts', {
              details: { quote: checkout.quote },
            });
          }
          const created = await this.#insertOrder(tx, userId, input, checkout, now);
          await clearCart(tx, cartId);
          result = {
            status: 201,
            body: { order: toOrder(created, this.#paymentContext()), duplicate: false },
          };
        }
        await this.#idempotency.complete(tx, claim.id, result.status, result.body);
        return result;
      });
    } catch (error) {
      // Nada quedó confirmado: se libera la clave para que el mismo intento se pueda repetir.
      await this.#idempotency.release(claim.id);
      throw error;
    }
  }

  async #recentDuplicate(db: Db, userId: string, quoteVersion: string, now: Date): Promise<OrderRow | null> {
    const recent = await db.order.findMany({
      where: {
        userId,
        status: 'PENDING_PAYMENT',
        createdAt: { gte: new Date(now.getTime() - ORDER_TIMING.duplicateWindowMs) },
      },
      orderBy: { createdAt: 'desc' },
      include: orderInclude,
    });
    return recent.find((row) => orderFingerprint(row) === quoteVersion) ?? null;
  }

  async #insertOrder(
    db: Db,
    userId: string,
    input: CreateOrderInput,
    checkout: Checkout,
    now: Date,
  ): Promise<OrderRow> {
    const code = await uniqueCode(db);
    const { pricing, settings } = checkout;
    const orderLocale: 'es_CR' | 'en' = input.locale === 'en' ? 'en' : 'es_CR';
    const items = checkout.resolved.flatMap((line) =>
      // El pedido conserva la regla C5: un total de 25 genera dos OrderItem (20 + 5).
      splitQuantity(line.view.quantity).map((quantity) => ({
        productId: line.view.productId,
        orderLocale,
        productName: line.view.name,
        productNameLocalized: line.view.translatedName,
        quantity,
        unitPriceMinor: line.basePriceMinor,
        optionsTotalMinor: line.optionsTotalMinor,
        lineTotalMinor: (line.basePriceMinor + line.optionsTotalMinor) * quantity,
        options: {
          create: line.options.map((o) => ({
            optionId: o.id,
            groupLabel: o.groupLabel,
            groupLabelEsCr: o.groupLabelEsCr,
            label: o.label,
            labelEsCr: o.labelEsCr,
            priceDeltaMinor: o.priceDeltaMinor,
          })),
        },
      })),
    );
    const created = await db.order.create({
      data: {
        code,
        userId,
        status: 'PENDING_PAYMENT',
        fulfillmentType: input.fulfillmentType,
        orderLocale,
        currency: settings.currency,
        currencyMinorUnits: CURRENCIES[settings.currency].minorUnits,
        subtotalMinor: pricing.subtotalMinor,
        discountMinor: pricing.discountMinor,
        deliveryFeeMinor: pricing.deliveryFeeMinor,
        taxTotalMinor: pricing.taxTotalMinor,
        roundingAdjustmentMinor: pricing.roundingAdjustmentMinor,
        totalMinor: pricing.totalMinor,
        pricesIncludeTax: settings.pricesIncludeTax,
        deliveryZoneId: checkout.zone?.id ?? null,
        ...(checkout.address
          ? { deliveryAddress: checkout.address as unknown as Prisma.InputJsonValue }
          : {}),
        contactPhone: input.contactPhone ?? null,
        customerNote: input.customerNote ?? null,
        expiresAt: new Date(now.getTime() + ORDER_TIMING.pendingPaymentTtlMs),
        createdAt: now,
        items: { create: items },
        taxLines: {
          create: pricing.taxLines.map((t) => ({
            taxRateId: t.taxRateId,
            name: t.name,
            rateBps: t.rateBps,
            inclusive: t.inclusive,
            taxableBaseMinor: t.taxableBaseMinor,
            taxMinor: t.taxMinor,
          })),
        },
        statusHistory: {
          create: {
            fromStatus: null,
            toStatus: 'PENDING_PAYMENT',
            actorUserId: userId,
            actorRole: 'CUSTOMER',
          },
        },
        // D-M5-1: el pago empieza en `REQUIRES_PAYMENT`. El método se fija al pagar (M6): la tarjeta
        // demo deja `DEMO_CARD`; contra entrega lo cambia a `CASH_ON_DELIVERY` (D-M6-1).
        payment: { create: { method: 'DEMO_CARD', status: 'REQUIRES_PAYMENT', currency: settings.currency } },
      },
      select: { id: true },
    });
    return db.order.findUniqueOrThrow({ where: { id: created.id }, include: orderInclude });
  }

  /** Pedido propio. Ajeno o inexistente → 404, sin confirmar que exista (§8.7, R-SEC-06). */
  async get(userId: string, orderId: string): Promise<Order> {
    const row = await this.#db.order.findFirst({ where: { id: orderId, userId }, include: orderInclude });
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Order not found');
    return toOrder(row, this.#paymentContext());
  }
}

async function uniqueCode(db: Db): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    let code = 'MB-';
    for (let i = 0; i < 6; i += 1) code += CODE_ALPHABET.charAt(randomInt(CODE_ALPHABET.length));
    const taken = await db.order.findUnique({ where: { code }, select: { id: true } });
    if (!taken) return code;
  }
  throw new Error('No se pudo generar un código de pedido único');
}
