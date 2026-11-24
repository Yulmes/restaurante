import { z } from 'zod';
import { phoneSchema } from '../auth/schemas.ts';
import { localizedTextSchema } from '../catalog/schemas.ts';
import { localeSchema } from '../i18n/locales.ts';
import { customerPaymentSchema, paymentMethodSchema } from '../payments/schemas.ts';

/**
 * Contratos del pedido (M5): carrito, cotización, direcciones, checkout y pedidos (§6, §7.3, §7.5).
 * Los montos viajan siempre como enteros en la unidad menor y los calcula la API: el navegador
 * nunca envía precios, impuestos ni totales (solo referencias y cantidades).
 */

/** Máximo de unidades por **línea interna** (CHECK de `CartItem` y `OrderItem`, regla C5). */
export const LINE_MAX_QUANTITY = 20;
/**
 * Tope técnico antiabuso de la cantidad total de un mismo plato con las mismas opciones. No es una
 * regla comercial ni el tope de 20 (C5): solo evita carritos de miles de filas (ADR 0006).
 */
export const PRODUCT_MAX_QUANTITY = 999;
/** Tope técnico de identidades distintas en un carrito (ADR 0006). */
export const CART_MAX_LINES = 50;

export const FULFILLMENT_TYPES = ['PICKUP', 'DELIVERY'] as const;
export const fulfillmentTypeSchema = z.enum(FULFILLMENT_TYPES);
export type FulfillmentType = z.infer<typeof fulfillmentTypeSchema>;

const currencySchema = z.enum(['CRC', 'USD']);
const optionIdsSchema = z.array(z.uuid()).max(20);

/**
 * Identidad de línea (§7.5): plato + opciones **ordenadas** y sin repetir. Dos líneas con el mismo
 * plato y las mismas opciones son la misma línea, aunque las opciones se hayan elegido en otro orden.
 */
export function lineKey(productId: string, optionIds: readonly string[]): string {
  return `${productId}:${[...new Set(optionIds)].sort().join(',')}`;
}

/** Línea del carrito tal como la guarda el navegador o la envía la web: solo referencias. */
export const cartLineInputSchema = z.object({
  productId: z.uuid(),
  optionIds: optionIdsSchema.default([]),
  quantity: z.number().int().min(1).max(PRODUCT_MAX_QUANTITY),
});
export type CartLineInput = z.input<typeof cartLineInputSchema>;

/** Carrito de invitado en `localStorage` (§7.5). Sin precios: siempre se piden a la API. */
export const guestCartSchema = z.object({
  version: z.literal(1),
  /** UUID generado una vez por carrito de invitado: hace idempotente la fusión. */
  mergeKey: z.uuid(),
  lines: z.array(cartLineInputSchema).max(CART_MAX_LINES),
});
export type GuestCart = z.infer<typeof guestCartSchema>;

export const cartQuoteRequestSchema = z.object({
  locale: localeSchema,
  lines: z.array(cartLineInputSchema).max(CART_MAX_LINES),
});

/** Cambia la cantidad **total** de una identidad de línea (C5). `set` con 0 la quita. */
export const cartItemRequestSchema = z
  .object({
    locale: localeSchema,
    productId: z.uuid(),
    optionIds: optionIdsSchema.default([]),
    quantity: z.number().int().min(0).max(PRODUCT_MAX_QUANTITY),
    mode: z.enum(['add', 'set']),
  })
  .refine((value) => value.mode === 'set' || value.quantity >= 1, {
    path: ['quantity'],
    error: 'invalid',
  });
export type CartItemRequest = z.input<typeof cartItemRequestSchema>;

export const cartMergeRequestSchema = z.object({
  locale: localeSchema,
  mergeKey: z.uuid(),
  lines: z.array(cartLineInputSchema).max(CART_MAX_LINES),
});
export type CartMergeRequest = z.input<typeof cartMergeRequestSchema>;

/** Por qué una línea no se puede pedir. Nunca se descarta en silencio (§7.5). */
export const UNAVAILABLE_REASONS = [
  'PRODUCT_NOT_FOUND',
  'PRODUCT_SOLD_OUT',
  'OPTION_UNAVAILABLE',
  'OPTIONS_INVALID',
  'QUANTITY_LIMIT',
] as const;
export const unavailableReasonSchema = z.enum(UNAVAILABLE_REASONS);
export type UnavailableReason = z.infer<typeof unavailableReasonSchema>;

export const cartLineViewSchema = z.object({
  key: z.string(),
  productId: z.uuid(),
  optionIds: z.array(z.uuid()),
  /** Cantidad **total** de la identidad (C5): la interfaz nunca ve las líneas internas. */
  quantity: z.number().int().positive(),
  slug: z.string().nullable(),
  categorySlug: z.string().nullable(),
  /** Nombre original del plato (D2). */
  name: z.string(),
  translatedName: z.string().nullable(),
  options: z.array(
    z.object({
      id: z.uuid(),
      group: localizedTextSchema,
      name: localizedTextSchema,
      priceDeltaMinor: z.number().int().nonnegative(),
    }),
  ),
  /** Precio base + opciones, por unidad. */
  unitPriceMinor: z.number().int().nonnegative(),
  lineTotalMinor: z.number().int().nonnegative(),
  available: z.boolean(),
  reason: unavailableReasonSchema.nullable(),
});
export type CartLineView = z.infer<typeof cartLineViewSchema>;

export const cartViewSchema = z.object({
  currency: currencySchema,
  lines: z.array(cartLineViewSchema),
  /** Unidades de las líneas disponibles. */
  itemCount: z.number().int().nonnegative(),
  /** Subtotal de productos disponibles (con IVA incluido en la configuración aprobada). */
  subtotalMinor: z.number().int().nonnegative(),
  /** Pedido mínimo (`RestaurantSettings.minOrderMinor`): sobre el subtotal, sin el envío. */
  minOrderMinor: z.number().int().nonnegative(),
  meetsMinimum: z.boolean(),
});
export type CartView = z.infer<typeof cartViewSchema>;

export const cartResponseSchema = z.object({ cart: cartViewSchema });

export const cartMergeResponseSchema = z.object({
  cart: cartViewSchema,
  /** Líneas del invitado que no entraron, con el motivo (§7.5). */
  unavailable: z.array(
    z.object({
      productId: z.uuid(),
      optionIds: z.array(z.uuid()),
      quantity: z.number().int().positive(),
      reason: unavailableReasonSchema,
      name: z.string().nullable(),
    }),
  ),
  /** La misma `mergeKey` ya se había fusionado: no se sumó nada (idempotencia). */
  alreadyMerged: z.boolean(),
});
export type CartMergeResponse = z.infer<typeof cartMergeResponseSchema>;

// ─── Zonas y direcciones ────────────────────────────────────────────────────

export const deliveryZoneSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  districts: z.array(z.string()),
  feeMinor: z.number().int().nonnegative(),
  etaMinutes: z.number().int().positive(),
});
export type DeliveryZone = z.infer<typeof deliveryZoneSchema>;
export const deliveryZonesResponseSchema = z.object({
  currency: currencySchema,
  zones: z.array(deliveryZoneSchema),
});

const text = (max: number) =>
  z.string({ error: 'required' }).trim().min(1, { error: 'required' }).max(max, { error: 'tooLong' });

export const addressInputSchema = z.object({
  label: text(40),
  line1: text(120),
  line2: z
    .string()
    .trim()
    .max(120, { error: 'tooLong' })
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional(),
  /** Debe ser un distrito cubierto por una zona de delivery activa (la API lo comprueba). */
  district: text(60),
  canton: text(60),
  province: text(60),
  /** Referencia para el repartidor ("Portón negro, casa esquinera"). */
  reference: text(200),
  isDefault: z.boolean().default(false),
});
export type AddressInput = z.input<typeof addressInputSchema>;

export const addressSchema = z.object({
  id: z.uuid(),
  label: z.string(),
  line1: z.string(),
  line2: z.string().nullable(),
  district: z.string(),
  canton: z.string(),
  province: z.string(),
  reference: z.string(),
  isDefault: z.boolean(),
  /** Zona que cubre el distrito hoy, o `null` si ya no hay delivery allí. */
  deliveryZone: deliveryZoneSchema.omit({ districts: true }).nullable(),
});
export type Address = z.infer<typeof addressSchema>;
export const addressesResponseSchema = z.object({ addresses: z.array(addressSchema) });
export const addressResponseSchema = z.object({ address: addressSchema });

// ─── Checkout y pedidos ─────────────────────────────────────────────────────

export const taxLineSchema = z.object({
  name: z.string(),
  rateBps: z.number().int().min(0).max(10000),
  inclusive: z.boolean(),
  taxableBaseMinor: z.number().int().nonnegative(),
  taxMinor: z.number().int().nonnegative(),
});
export type TaxLine = z.infer<typeof taxLineSchema>;

export const orderTotalsSchema = z.object({
  subtotalMinor: z.number().int().nonnegative(),
  discountMinor: z.number().int().nonnegative(),
  deliveryFeeMinor: z.number().int().nonnegative(),
  taxLines: z.array(taxLineSchema),
  taxTotalMinor: z.number().int().nonnegative(),
  /** Diferencia del redondeo al incremento de la moneda; puede ser negativa (§6.2, paso 6). */
  roundingAdjustmentMinor: z.number().int(),
  totalMinor: z.number().int().nonnegative(),
});
export type OrderTotals = z.infer<typeof orderTotalsSchema>;

export const CHECKOUT_PROBLEMS = [
  'CART_EMPTY',
  'ITEMS_UNAVAILABLE',
  'MIN_ORDER_NOT_MET',
  'OUTSIDE_OPENING_HOURS',
  'FULFILLMENT_UNAVAILABLE',
  'ADDRESS_REQUIRED',
  'DELIVERY_ZONE_UNAVAILABLE',
] as const;
export const checkoutProblemSchema = z.enum(CHECKOUT_PROBLEMS);
export type CheckoutProblem = z.infer<typeof checkoutProblemSchema>;

export const checkoutQuoteRequestSchema = z.object({
  locale: localeSchema,
  fulfillmentType: fulfillmentTypeSchema,
  addressId: z.uuid().nullable().optional(),
});
export type CheckoutQuoteRequest = z.input<typeof checkoutQuoteRequestSchema>;

export const checkoutQuoteSchema = z.object({
  cart: cartViewSchema,
  fulfillmentType: fulfillmentTypeSchema,
  deliveryZone: deliveryZoneSchema.omit({ districts: true }).nullable(),
  totals: orderTotalsSchema,
  /**
   * Huella de lo que el cliente ve (líneas, precios, envío, impuestos y total). Al confirmar se
   * envía de vuelta: si el servidor calcula otra, responde `409 PRICE_CHANGED` (D-M5-2).
   */
  quoteVersion: z.string(),
  openNow: z.boolean(),
  /** Abierto, o fuera de horario con el modo de demostración activado en la API (D-M5-3). */
  orderingAllowed: z.boolean(),
  pickupEnabled: z.boolean(),
  deliveryEnabled: z.boolean(),
  /** M6: métodos de pago que la API acepta (la tarjeta demo depende de `DEMO_PAYMENTS_ENABLED`). */
  paymentMethods: z.array(paymentMethodSchema).default([]),
  problems: z.array(checkoutProblemSchema),
});
export type CheckoutQuote = z.infer<typeof checkoutQuoteSchema>;

export const createOrderRequestSchema = z
  .object({
    locale: localeSchema,
    fulfillmentType: fulfillmentTypeSchema,
    addressId: z.uuid().nullable().optional(),
    contactPhone: phoneSchema,
    customerNote: z
      .string()
      .trim()
      .max(300, { error: 'tooLong' })
      .transform((value) => (value === '' ? null : value))
      .nullable()
      .optional(),
    quoteVersion: z.string().min(1).max(64),
  })
  .superRefine((value, ctx) => {
    if (value.fulfillmentType === 'DELIVERY' && !value.addressId) {
      ctx.addIssue({ code: 'custom', path: ['addressId'], message: 'required' });
    }
    // Para el delivery hace falta un teléfono de contacto; en el retiro es opcional.
    if (value.fulfillmentType === 'DELIVERY' && !value.contactPhone) {
      ctx.addIssue({ code: 'custom', path: ['contactPhone'], message: 'required' });
    }
  });
export type CreateOrderRequest = z.input<typeof createOrderRequestSchema>;

export const ORDER_STATUSES = [
  'PENDING_PAYMENT',
  'PENDING_CONFIRMATION',
  'CONFIRMED',
  'PREPARING',
  'READY_FOR_PICKUP',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CANCELLED',
] as const;
export const PAYMENT_STATUSES = [
  'REQUIRES_PAYMENT',
  'PROCESSING',
  'AUTHORIZED',
  'CAPTURED',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
  'VOIDED',
  'PENDING_COLLECTION',
  'COLLECTED',
] as const;

/** M7: una marca de la línea de marea: a qué estado pasó y cuándo (sin el actor). */
export const orderTimelineEntrySchema = z.object({
  status: z.enum(ORDER_STATUSES),
  at: z.iso.datetime(),
});
export type OrderTimelineEntry = z.infer<typeof orderTimelineEntrySchema>;

export const orderSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  status: z.enum(ORDER_STATUSES),
  fulfillmentType: fulfillmentTypeSchema,
  orderLocale: localeSchema,
  currency: currencySchema,
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime().nullable(),
  /** Agrupadas por identidad: un único producto con su cantidad total (C5). */
  items: z.array(
    z.object({
      key: z.string(),
      productId: z.uuid().nullable(),
      name: z.string(),
      translatedName: z.string().nullable(),
      quantity: z.number().int().positive(),
      unitPriceMinor: z.number().int().nonnegative(),
      lineTotalMinor: z.number().int().nonnegative(),
      options: z.array(
        z.object({ group: z.string(), label: z.string(), priceDeltaMinor: z.number().int().nonnegative() }),
      ),
    }),
  ),
  totals: orderTotalsSchema,
  deliveryZone: z.object({ name: z.string(), etaMinutes: z.number().int().positive() }).nullable(),
  deliveryAddress: z
    .object({
      label: z.string(),
      line1: z.string(),
      line2: z.string().nullable(),
      district: z.string(),
      canton: z.string(),
      province: z.string(),
      reference: z.string(),
    })
    .nullable(),
  contactPhone: z.string().nullable(),
  customerNote: z.string().nullable(),
  /** M6: estado, método, métodos disponibles y último intento de la tarjeta demo. */
  payment: customerPaymentSchema,
  /**
   * M7: marcas de la línea de marea (§3.6, seguimiento). Las respuestas guardadas antes de M7
   * (idempotencia de 24 h) no traen estos campos.
   */
  timeline: z.array(orderTimelineEntrySchema).default([]),
  /** M7: el cliente puede cancelarlo ahora (solo antes de que el local lo confirme, §7.1). */
  cancellable: z.boolean().default(false),
});
export type Order = z.infer<typeof orderSchema>;

export const orderResponseSchema = z.object({
  order: orderSchema,
  /** El mismo carrito ya se había confirmado hace menos de 60 s: se devuelve ese pedido (§7.3). */
  duplicate: z.boolean(),
});
export type OrderResponse = z.infer<typeof orderResponseSchema>;
