import type {
  AdminCurrencyChangeRequest,
  AdminSettings,
  AdminSettingsResponse,
  AdminSettingsUpdateRequest,
  AdminTaxRate,
  AdminTaxRateUpdateRequest,
  AdminZone,
  AdminZoneUpdateRequest,
  OrderStatus,
} from '@marea-baja/shared';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.ts';
import { AppError } from '../../http/errors.ts';
import { recordAudit, type AuditActor } from '../audit/audit.ts';
import { DEFAULT_ROUNDING_INCREMENT, convertPrice, parseRateHundredths } from './currency.ts';

/**
 * Configuración del local (M8, §6.1, §6.2, §8.4, §8.6, D5, D8):
 * - `RestaurantSettings` con versión optimista (409 `RESOURCE_VERSION_CONFLICT`): IVA incluido o
 *   no, redondeo, pedido mínimo, modalidades, horario y el umbral de Turnstile (D8);
 * - tasas de impuesto y zonas de delivery;
 * - asistente de cambio de moneda (§6.2, punto 3; D-M8-4).
 *
 * La zona horaria, `isDemo` y la moneda fuera del asistente no se editan aquí. Todo cambio queda en
 * el AuditLog en la misma transacción.
 */
export const ACTIVE_ORDER_STATUSES = [
  'PENDING_PAYMENT',
  'PENDING_CONFIRMATION',
  'CONFIRMED',
  'PREPARING',
  'READY_FOR_PICKUP',
  'OUT_FOR_DELIVERY',
] as const satisfies readonly OrderStatus[];

const settingsInclude = {
  openingHours: { orderBy: [{ dayOfWeek: 'asc' }, { opensMinutes: 'asc' }] },
} as const satisfies Prisma.RestaurantSettingsInclude;
type SettingsRow = Prisma.RestaurantSettingsGetPayload<{ include: typeof settingsInclude }>;

const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

function toSettings(row: SettingsRow): AdminSettings {
  return {
    currency: row.currency,
    pricesIncludeTax: row.pricesIncludeTax,
    roundingIncrementMinor: row.roundingIncrementMinor,
    minOrderMinor: row.minOrderMinor,
    pickupEnabled: row.pickupEnabled,
    deliveryEnabled: row.deliveryEnabled,
    timezone: row.timezone,
    isDemo: row.isDemo,
    turnstileGlobalThreshold: row.turnstileGlobalThreshold,
    turnstileWindowMinutes: row.turnstileWindowMinutes,
    version: row.version,
    openingHours: row.openingHours.map((h) => ({
      dayOfWeek: h.dayOfWeek,
      opensMinutes: h.opensMinutes,
      closesMinutes: h.closesMinutes,
    })),
  };
}

/** Campos auditables (lista blanca `settings`); el horario, como texto legible. */
function settingsAudit(row: SettingsRow): Record<string, unknown> {
  return {
    currency: row.currency,
    pricesIncludeTax: row.pricesIncludeTax,
    roundingIncrementMinor: row.roundingIncrementMinor,
    minOrderMinor: row.minOrderMinor,
    pickupEnabled: row.pickupEnabled,
    deliveryEnabled: row.deliveryEnabled,
    turnstileGlobalThreshold: row.turnstileGlobalThreshold,
    turnstileWindowMinutes: row.turnstileWindowMinutes,
    openingHours: row.openingHours.map(
      (h) => `${String(h.dayOfWeek)} ${hhmm(h.opensMinutes)}-${hhmm(h.closesMinutes)}`,
    ),
    version: row.version,
  };
}

function toTaxRate(row: Prisma.TaxRateGetPayload<object>): AdminTaxRate {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    rateBps: row.rateBps,
    appliesTo: row.appliesTo,
    fulfillmentTypes: row.fulfillmentTypes,
    isActive: row.isActive,
  };
}

function toZone(row: Prisma.DeliveryZoneGetPayload<object>): AdminZone {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    districts: row.districts,
    feeMinor: row.feeMinor,
    etaMinutes: row.etaMinutes,
    isActive: row.isActive,
  };
}

/** Rangos del mismo día: abre antes de cerrar y no se superponen. */
function validateOpeningHours(hours: AdminSettingsUpdateRequest['openingHours']): void {
  const fields: Record<string, string> = {};
  const byDay = new Map<number, { opens: number; closes: number; index: number }[]>();
  hours.forEach((h, index) => {
    if (h.opensMinutes >= h.closesMinutes) fields[`openingHours.${String(index)}`] = 'range';
    const list = byDay.get(h.dayOfWeek) ?? [];
    list.push({ opens: h.opensMinutes, closes: h.closesMinutes, index });
    byDay.set(h.dayOfWeek, list);
  });
  for (const list of byDay.values()) {
    list.sort((a, b) => a.opens - b.opens);
    for (let i = 1; i < list.length; i += 1) {
      const previous = list[i - 1];
      const current = list[i];
      if (previous && current && current.opens < previous.closes) {
        fields[`openingHours.${String(current.index)}`] = 'overlap';
      }
    }
  }
  if (Object.keys(fields).length > 0) {
    throw new AppError(400, 'VALIDATION_FAILED', 'Invalid opening hours', { fields });
  }
}

const conflict = () => new AppError(409, 'RESOURCE_VERSION_CONFLICT', 'Settings changed; reload them');

export interface SettingsAdminDeps {
  db: PrismaClient;
  /** Se llama después de cada cambio confirmado que afecte la carta (moneda, precios). */
  afterChange: () => void;
}

export class SettingsAdminService {
  readonly #db: PrismaClient;
  readonly #afterChange: () => void;

  constructor(deps: SettingsAdminDeps) {
    this.#db = deps.db;
    this.#afterChange = deps.afterChange;
  }

  async get(): Promise<AdminSettingsResponse> {
    const [settings, taxRates, zones, activeOrders] = await Promise.all([
      this.#db.restaurantSettings.findUniqueOrThrow({ where: { id: 1 }, include: settingsInclude }),
      this.#db.taxRate.findMany({ orderBy: { key: 'asc' } }),
      this.#db.deliveryZone.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      this.#db.order.count({ where: { status: { in: [...ACTIVE_ORDER_STATUSES] } } }),
    ]);
    return {
      settings: toSettings(settings),
      taxRates: taxRates.map(toTaxRate),
      zones: zones.map(toZone),
      activeOrders,
    };
  }

  async update(
    actor: AuditActor,
    input: AdminSettingsUpdateRequest,
    requestId: string,
  ): Promise<AdminSettings> {
    validateOpeningHours(input.openingHours);
    const settings = await this.#db.$transaction(async (tx) => {
      const before = await tx.restaurantSettings.findUniqueOrThrow({
        where: { id: 1 },
        include: settingsInclude,
      });
      const updated = await tx.restaurantSettings.updateMany({
        where: { id: 1, version: input.version },
        data: {
          pricesIncludeTax: input.pricesIncludeTax,
          roundingIncrementMinor: input.roundingIncrementMinor,
          minOrderMinor: input.minOrderMinor,
          pickupEnabled: input.pickupEnabled,
          deliveryEnabled: input.deliveryEnabled,
          turnstileGlobalThreshold: input.turnstileGlobalThreshold,
          turnstileWindowMinutes: input.turnstileWindowMinutes,
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) throw conflict();
      await tx.openingHours.deleteMany({ where: { settingsId: 1 } });
      await tx.openingHours.createMany({ data: input.openingHours.map((h) => ({ settingsId: 1, ...h })) });
      const after = await tx.restaurantSettings.findUniqueOrThrow({
        where: { id: 1 },
        include: settingsInclude,
      });
      const beforeAudit = settingsAudit(before);
      const afterAudit = settingsAudit(after);
      const turnstileChanged =
        before.turnstileGlobalThreshold !== after.turnstileGlobalThreshold ||
        before.turnstileWindowMinutes !== after.turnstileWindowMinutes;
      const otherChanged = Object.keys(afterAudit).some(
        (field) =>
          !['turnstileGlobalThreshold', 'turnstileWindowMinutes', 'version'].includes(field) &&
          JSON.stringify(beforeAudit[field]) !== JSON.stringify(afterAudit[field]),
      );
      // §8.4 y D8: el cambio del umbral de Turnstile tiene su propia acción para encontrarlo fácil.
      const actions = [
        ...(turnstileChanged ? ['settings.turnstile_threshold_changed'] : []),
        ...(otherChanged || !turnstileChanged ? ['settings.updated'] : []),
      ];
      for (const action of actions) {
        await recordAudit(tx, {
          actor,
          action,
          entityType: 'settings',
          entityId: '1',
          before: beforeAudit,
          after: afterAudit,
          requestId,
        });
      }
      return after;
    });
    this.#afterChange();
    return toSettings(settings);
  }

  async updateTaxRate(
    actor: AuditActor,
    taxRateId: string,
    input: AdminTaxRateUpdateRequest,
    requestId: string,
  ): Promise<AdminTaxRate> {
    const rate = await this.#db.$transaction(async (tx) => {
      const before = await tx.taxRate.findUnique({ where: { id: taxRateId } });
      if (!before) throw new AppError(404, 'NOT_FOUND', 'Tax rate not found');
      const after = await tx.taxRate.update({
        where: { id: taxRateId },
        data: {
          name: input.name,
          rateBps: input.rateBps,
          appliesTo: input.appliesTo,
          fulfillmentTypes: [...new Set(input.fulfillmentTypes)],
          isActive: input.isActive,
        },
      });
      const action =
        before.isActive !== after.isActive
          ? after.isActive
            ? 'tax_rate.activated'
            : 'tax_rate.deactivated'
          : before.rateBps !== after.rateBps
            ? 'tax_rate.rate_changed'
            : 'tax_rate.updated';
      await recordAudit(tx, {
        actor,
        action,
        entityType: 'taxRate',
        entityId: taxRateId,
        before: toTaxRate(before),
        after: toTaxRate(after),
        requestId,
      });
      return after;
    });
    this.#afterChange();
    return toTaxRate(rate);
  }

  async updateZone(
    actor: AuditActor,
    zoneId: string,
    input: AdminZoneUpdateRequest,
    requestId: string,
  ): Promise<AdminZone> {
    const zone = await this.#db.$transaction(async (tx) => {
      const before = await tx.deliveryZone.findUnique({ where: { id: zoneId } });
      if (!before) throw new AppError(404, 'NOT_FOUND', 'Delivery zone not found');
      if (input.feeMinor !== before.feeMinor) {
        const { roundingIncrementMinor } = await tx.restaurantSettings.findUniqueOrThrow({
          where: { id: 1 },
          select: { roundingIncrementMinor: true },
        });
        if (input.feeMinor % roundingIncrementMinor !== 0) {
          throw new AppError(400, 'PRICE_INCREMENT', 'Fee must be a multiple of the rounding increment', {
            fields: { feeMinor: 'increment' },
            details: { roundingIncrementMinor },
          });
        }
      }
      const after = await tx.deliveryZone.update({
        where: { id: zoneId },
        data: {
          name: input.name,
          districts: [...new Set(input.districts)],
          feeMinor: input.feeMinor,
          etaMinutes: input.etaMinutes,
          isActive: input.isActive,
        },
      });
      const action =
        before.isActive !== after.isActive
          ? after.isActive
            ? 'delivery_zone.activated'
            : 'delivery_zone.deactivated'
          : before.feeMinor !== after.feeMinor
            ? 'delivery_zone.fee_changed'
            : 'delivery_zone.updated';
      await recordAudit(tx, {
        actor,
        action,
        entityType: 'deliveryZone',
        entityId: zoneId,
        before: toZone(before),
        after: toZone(after),
        requestId,
      });
      return after;
    });
    return toZone(zone);
  }

  /**
   * §6.2, punto 3: no es un interruptor. En una sola transacción:
   * 1. exige la versión vigente y que no haya pedidos activos (409 `CURRENCY_CHANGE_BLOCKED`);
   * 2. convierte precios de platos, recargos de opciones, tarifas de zonas y pedido mínimo con el
   *    tipo de cambio y los ajusta al incremento por defecto de la moneda nueva;
   * 3. registra el cambio en el AuditLog con el tipo y la cantidad de registros convertidos.
   * Los pedidos existentes conservan su propia moneda (§6.2, punto 2).
   */
  async changeCurrency(actor: AuditActor, input: AdminCurrencyChangeRequest, requestId: string) {
    const rate = parseRateHundredths(input.crcPerUsd);
    const result = await this.#db.$transaction(async (tx) => {
      const before = await tx.restaurantSettings.findUniqueOrThrow({
        where: { id: 1 },
        include: settingsInclude,
      });
      if (before.version !== input.version) throw conflict();
      if (before.currency === input.currency) {
        throw new AppError(400, 'VALIDATION_FAILED', 'Same currency', { fields: { currency: 'same' } });
      }
      const from = before.currency;
      const to = input.currency;
      const updated = await tx.restaurantSettings.updateMany({
        where: { id: 1, version: input.version },
        data: {
          currency: to,
          roundingIncrementMinor: DEFAULT_ROUNDING_INCREMENT[to],
          minOrderMinor: convertPrice(before.minOrderMinor, from, to, rate),
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) throw conflict();
      // Después de tomar la fila de configuración: un pedido creado antes de este punto se ve aquí.
      const active = await tx.order.count({ where: { status: { in: [...ACTIVE_ORDER_STATUSES] } } });
      if (active > 0) {
        throw new AppError(409, 'CURRENCY_CHANGE_BLOCKED', 'There are active orders', {
          details: { activeOrders: active },
        });
      }

      const products = await tx.product.findMany({ select: { id: true, basePriceMinor: true } });
      for (const p of products) {
        await tx.product.update({
          where: { id: p.id },
          data: { basePriceMinor: convertPrice(p.basePriceMinor, from, to, rate) },
        });
      }
      const options = await tx.productOption.findMany({ select: { id: true, priceDeltaMinor: true } });
      for (const o of options) {
        if (o.priceDeltaMinor === 0) continue;
        await tx.productOption.update({
          where: { id: o.id },
          data: { priceDeltaMinor: convertPrice(o.priceDeltaMinor, from, to, rate) },
        });
      }
      const zones = await tx.deliveryZone.findMany({ select: { id: true, feeMinor: true } });
      for (const z of zones) {
        await tx.deliveryZone.update({
          where: { id: z.id },
          data: { feeMinor: convertPrice(z.feeMinor, from, to, rate) },
        });
      }
      const converted = {
        products: products.length,
        options: options.filter((o) => o.priceDeltaMinor !== 0).length,
        zones: zones.length,
      };
      const after = await tx.restaurantSettings.findUniqueOrThrow({
        where: { id: 1 },
        include: settingsInclude,
      });
      await recordAudit(tx, {
        actor,
        action: 'settings.currency_changed',
        entityType: 'settings',
        entityId: '1',
        before: settingsAudit(before),
        after: {
          ...settingsAudit(after),
          crcPerUsd: input.crcPerUsd,
          productsConverted: converted.products,
          optionsConverted: converted.options,
          zonesConverted: converted.zones,
        },
        reason: input.reason,
        requestId,
      });
      return { settings: toSettings(after), converted };
    });
    this.#afterChange();
    return result;
  }
}
