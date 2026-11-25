import { z } from 'zod';
import { ROLE_KEYS } from '../auth/schemas.ts';
import { DIETARY_TAGS } from '../catalog/schemas.ts';
import { orderStatusSchema, orderSummarySchema } from '../operations/schemas.ts';
import { ORDER_STATUSES, fulfillmentTypeSchema, orderSchema } from '../orders/schemas.ts';
import { adminPaymentSchema } from '../payments/schemas.ts';

/**
 * M8 · Admin (§12, §3.6, §6.2, §8.4, §8.6): dashboard, carta con traducciones (D2), pesca del día,
 * clientes, configuración, moneda, impuestos (D5), umbral de Turnstile (D8), auditoría y pedidos
 * con reembolsos. Todo es solo de ADMIN (D-M8-3). Los códigos de validación por campo son los
 * mismos de la cuenta (`required`, `invalid`, `tooLong`…): la web los traduce.
 */
const currencySchema = z.enum(['CRC', 'USD']);
const uuid = z.uuid();
const isoDate = z.iso.date();
const required = (max: number) =>
  z.string({ error: 'required' }).trim().min(1, { error: 'required' }).max(max, { error: 'tooLong' });
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: 'tooLong' })
    .nullable()
    .transform((value) => (value === null || value === '' ? null : value));
const minorAmount = z
  .number({ error: 'invalid' })
  .int({ error: 'invalid' })
  .nonnegative({ error: 'invalid' })
  .max(100_000_000, { error: 'invalid' });
const reasonSchema = z
  .string({ error: 'required' })
  .trim()
  .min(3, { error: 'required' })
  .max(300, { error: 'tooLong' });

/** Página por cursor, como el historial del cliente (M7). */
const nextCursor = z.string().nullable();

// ─── Dashboard (datos reales) ────────────────────────────────────────────────

export const DASHBOARD_RANGES = ['today', '7d', '30d'] as const;
export const dashboardRangeSchema = z.enum(DASHBOARD_RANGES);
export type DashboardRange = z.infer<typeof dashboardRangeSchema>;

export const adminDashboardResponseSchema = z.object({
  range: dashboardRangeSchema,
  /** Límites del período en la zona horaria del local. */
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  timezone: z.string(),
  currency: currencySchema,
  serverTime: z.iso.datetime(),
  /** Pedidos creados en el período por estado (todos los estados, también los de 0). */
  ordersByStatus: z.array(z.object({ status: orderStatusSchema, count: z.number().int().nonnegative() })),
  /**
   * Ventas: pedidos aceptados por el local (de `CONFIRMED` a `DELIVERED`) en la moneda activa.
   * `refundedMinor` son los reembolsos parciales de esos pedidos; un pedido cancelado ya no cuenta.
   */
  sales: z.object({
    orders: z.number().int().nonnegative(),
    grossMinor: z.number().int().nonnegative(),
    refundedMinor: z.number().int().nonnegative(),
    netMinor: z.number().int(),
    averageTicketMinor: z.number().int().nonnegative(),
  }),
  /** Trabajo pendiente ahora mismo, sin importar el período (el Pase lo detalla). */
  pending: z.object({
    confirmation: z.number().int().nonnegative(),
    kitchen: z.number().int().nonnegative(),
    ready: z.number().int().nonnegative(),
  }),
  cancelled: z.number().int().nonnegative(),
  topProducts: z.array(
    z.object({
      name: z.string(),
      quantity: z.number().int().positive(),
      revenueMinor: z.number().int().nonnegative(),
    }),
  ),
  /** Pedidos del período en otra moneda (tras un cambio de moneda): no se suman. */
  otherCurrencyOrders: z.number().int().nonnegative(),
});
export type AdminDashboard = z.infer<typeof adminDashboardResponseSchema>;

// ─── Carta (D2: edición de traducciones) ─────────────────────────────────────

const slugSchema = z
  .string({ error: 'required' })
  .trim()
  .min(2, { error: 'required' })
  .max(80, { error: 'tooLong' })
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { error: 'slug' });

export const adminOptionSchema = z.object({
  id: uuid,
  name: z.string(),
  enName: z.string().nullable(),
  priceDeltaMinor: z.number().int().nonnegative(),
  isDefault: z.boolean(),
  isAvailable: z.boolean(),
});
export const adminOptionGroupSchema = z.object({
  id: uuid,
  name: z.string(),
  enName: z.string().nullable(),
  minSelect: z.number().int().nonnegative(),
  maxSelect: z.number().int().nonnegative(),
  isActive: z.boolean(),
  options: z.array(adminOptionSchema),
});
export const adminProductSchema = z.object({
  id: uuid,
  slug: z.string(),
  categoryId: uuid,
  name: z.string(),
  description: z.string(),
  basePriceMinor: z.number().int().nonnegative(),
  tags: z.array(z.enum(DIETARY_TAGS)),
  isActive: z.boolean(),
  isAvailable: z.boolean(),
  sortOrder: z.number().int(),
  /** Token de concurrencia: el `PUT` lo devuelve y 409 si otra persona lo cambió. */
  updatedAt: z.iso.datetime(),
  en: z.object({
    name: z.string().nullable(),
    description: z.string().nullable(),
    altText: z.string().nullable(),
  }),
  /** Foto principal: solo se edita el texto alternativo (D-M8-2); la subida llega en M10. */
  image: z.object({ alt: z.string() }).nullable(),
  optionGroups: z.array(adminOptionGroupSchema),
});
export type AdminProduct = z.infer<typeof adminProductSchema>;

export const adminCategorySchema = z.object({
  id: uuid,
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
  updatedAt: z.iso.datetime(),
  en: z.object({ name: z.string().nullable(), description: z.string().nullable() }),
  products: z.array(adminProductSchema),
});
export type AdminCategory = z.infer<typeof adminCategorySchema>;

export const adminMenuResponseSchema = z.object({
  currency: currencySchema,
  /** Los precios son múltiplos del incremento de redondeo de la moneda activa. */
  roundingIncrementMinor: z.number().int().positive(),
  categories: z.array(adminCategorySchema),
});
export type AdminMenu = z.infer<typeof adminMenuResponseSchema>;

const productFields = {
  categoryId: z.uuid({ error: 'required' }),
  name: required(120),
  description: required(600),
  basePriceMinor: minorAmount,
  tags: z.array(z.enum(DIETARY_TAGS)).max(DIETARY_TAGS.length),
  isActive: z.boolean(),
  isAvailable: z.boolean(),
  sortOrder: z
    .number()
    .int({ error: 'invalid' })
    .min(0, { error: 'invalid' })
    .max(10_000, { error: 'invalid' }),
  en: z
    .object({
      /** Solo si el nombre original conviene traducirlo (§4.5); si no, se muestra el original. */
      name: optionalText(120),
      /** D2: traducción completa de la carta. */
      description: required(600),
      altText: optionalText(300),
    })
    .strict(),
  imageAlt: optionalText(300),
};

export const adminProductCreateRequestSchema = z.object({ slug: slugSchema, ...productFields }).strict();
export type AdminProductCreateRequest = z.input<typeof adminProductCreateRequestSchema>;

export const adminProductUpdateRequestSchema = z
  .object({ updatedAt: z.iso.datetime({ error: 'required' }), ...productFields })
  .strict();
export type AdminProductUpdateRequest = z.input<typeof adminProductUpdateRequestSchema>;

export const adminProductResponseSchema = z.object({ product: adminProductSchema });

const categoryFields = {
  name: required(80),
  description: optionalText(300),
  sortOrder: z
    .number()
    .int({ error: 'invalid' })
    .min(0, { error: 'invalid' })
    .max(10_000, { error: 'invalid' }),
  isActive: z.boolean(),
  en: z.object({ name: required(80), description: optionalText(300) }).strict(),
};
export const adminCategoryCreateRequestSchema = z.object({ slug: slugSchema, ...categoryFields }).strict();
export type AdminCategoryCreateRequest = z.input<typeof adminCategoryCreateRequestSchema>;
export const adminCategoryUpdateRequestSchema = z
  .object({ updatedAt: z.iso.datetime({ error: 'required' }), ...categoryFields })
  .strict();
export type AdminCategoryUpdateRequest = z.input<typeof adminCategoryUpdateRequestSchema>;
export const adminCategoryResponseSchema = z.object({
  category: adminCategorySchema.omit({ products: true }),
});

export const adminOptionGroupUpdateRequestSchema = z
  .object({ name: required(80), enName: optionalText(80), isActive: z.boolean() })
  .strict();
export type AdminOptionGroupUpdateRequest = z.input<typeof adminOptionGroupUpdateRequestSchema>;
export const adminOptionUpdateRequestSchema = z
  .object({
    name: required(80),
    enName: optionalText(80),
    priceDeltaMinor: minorAmount,
    isAvailable: z.boolean(),
  })
  .strict();
export type AdminOptionUpdateRequest = z.input<typeof adminOptionUpdateRequestSchema>;

// ─── Pesca del día (§3.6: editable desde el admin; §8.6: su publicación se audita) ──

export const adminCatchItemSchema = z.object({
  species: required(80),
  port: required(80),
  /** Hora local de entrada, `HH:MM`. */
  arrivedAt: z.string({ error: 'required' }).regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: 'invalid' }),
});
export const adminCatchBoardSchema = z.object({
  date: isoDate,
  publishedAt: z.iso.datetime().nullable(),
  items: z.array(adminCatchItemSchema),
});
export type AdminCatchBoard = z.infer<typeof adminCatchBoardSchema>;
export const adminCatchResponseSchema = z.object({
  today: isoDate,
  timezone: z.string(),
  boards: z.array(adminCatchBoardSchema),
});
export type AdminCatchResponse = z.infer<typeof adminCatchResponseSchema>;
export const adminCatchSaveRequestSchema = z
  .object({
    date: z.iso.date({ error: 'invalid' }),
    items: z.array(adminCatchItemSchema.strict()).min(1, { error: 'required' }).max(12, { error: 'tooLong' }),
    publish: z.boolean(),
  })
  .strict();
export type AdminCatchSaveRequest = z.input<typeof adminCatchSaveRequestSchema>;

// ─── Clientes (roles y bloqueo de cuentas, §8.6) ─────────────────────────────

export const adminCustomerSchema = z.object({
  id: uuid,
  name: z.string(),
  email: z.string(),
  roles: z.array(z.enum(ROLE_KEYS)),
  emailVerified: z.boolean(),
  blocked: z.boolean(),
  createdAt: z.iso.datetime(),
  orderCount: z.number().int().nonnegative(),
});
export type AdminCustomer = z.infer<typeof adminCustomerSchema>;
export const adminCustomersResponseSchema = z.object({ customers: z.array(adminCustomerSchema), nextCursor });
export type AdminCustomersResponse = z.infer<typeof adminCustomersResponseSchema>;

export const adminCustomerDetailSchema = adminCustomerSchema.extend({
  phone: z.string().nullable(),
  locale: z.enum(['es-CR', 'en']),
  blockedAt: z.iso.datetime().nullable(),
  recentOrders: z.array(orderSummarySchema),
});
export type AdminCustomerDetail = z.infer<typeof adminCustomerDetailSchema>;
export const adminCustomerResponseSchema = z.object({ customer: adminCustomerDetailSchema });

export const adminCustomerUpdateRequestSchema = z
  .object({
    blocked: z.boolean().optional(),
    roles: z.array(z.enum(ROLE_KEYS)).min(1, { error: 'required' }).max(ROLE_KEYS.length).optional(),
    /** §8.6: los cambios de roles y los bloqueos llevan motivo. */
    reason: reasonSchema,
  })
  .strict()
  .refine((value) => value.blocked !== undefined || value.roles !== undefined, {
    error: 'required',
    path: ['blocked'],
  });
export type AdminCustomerUpdateRequest = z.input<typeof adminCustomerUpdateRequestSchema>;

// ─── Configuración, impuestos, zonas, moneda y Turnstile ─────────────────────

const minutesOfDay = z
  .number()
  .int({ error: 'invalid' })
  .min(0, { error: 'invalid' })
  .max(1440, { error: 'invalid' });
export const openingHoursEntrySchema = z
  .object({
    /** 0 = domingo … 6 = sábado. */
    dayOfWeek: z.number().int({ error: 'invalid' }).min(0, { error: 'invalid' }).max(6, { error: 'invalid' }),
    opensMinutes: minutesOfDay,
    closesMinutes: minutesOfDay,
  })
  .strict();

export const adminSettingsSchema = z.object({
  currency: currencySchema,
  pricesIncludeTax: z.boolean(),
  roundingIncrementMinor: z.number().int().positive(),
  minOrderMinor: z.number().int().nonnegative(),
  pickupEnabled: z.boolean(),
  deliveryEnabled: z.boolean(),
  timezone: z.string(),
  isDemo: z.boolean(),
  turnstileGlobalThreshold: z.number().int().positive(),
  turnstileWindowMinutes: z.number().int().positive(),
  version: z.number().int().nonnegative(),
  openingHours: z.array(openingHoursEntrySchema),
});
export type AdminSettings = z.infer<typeof adminSettingsSchema>;

export const TAX_BASES = ['ITEMS', 'DELIVERY', 'BOTH'] as const;
export const SERVICE_SCOPES = ['PICKUP', 'DELIVERY', 'DINE_IN'] as const;
export const adminTaxRateSchema = z.object({
  id: uuid,
  key: z.string(),
  name: z.string(),
  rateBps: z.number().int().min(0).max(10_000),
  appliesTo: z.enum(TAX_BASES),
  fulfillmentTypes: z.array(z.enum(SERVICE_SCOPES)),
  isActive: z.boolean(),
});
export type AdminTaxRate = z.infer<typeof adminTaxRateSchema>;

export const adminZoneSchema = z.object({
  id: uuid,
  key: z.string(),
  name: z.string(),
  districts: z.array(z.string()),
  feeMinor: z.number().int().nonnegative(),
  etaMinutes: z.number().int().positive(),
  isActive: z.boolean(),
});
export type AdminZone = z.infer<typeof adminZoneSchema>;

export const adminSettingsResponseSchema = z.object({
  settings: adminSettingsSchema,
  taxRates: z.array(adminTaxRateSchema),
  zones: z.array(adminZoneSchema),
  /** Pedidos activos: el cambio de moneda exige que no haya ninguno (§6.2). */
  activeOrders: z.number().int().nonnegative(),
});
export type AdminSettingsResponse = z.infer<typeof adminSettingsResponseSchema>;

const positiveInt = (max: number) =>
  z
    .number({ error: 'invalid' })
    .int({ error: 'invalid' })
    .min(1, { error: 'invalid' })
    .max(max, { error: 'invalid' });

export const adminSettingsUpdateRequestSchema = z
  .object({
    version: z.number().int().nonnegative(),
    pricesIncludeTax: z.boolean(),
    roundingIncrementMinor: positiveInt(100_000),
    minOrderMinor: minorAmount,
    pickupEnabled: z.boolean(),
    deliveryEnabled: z.boolean(),
    /** D8: umbral global de fallos de login y su ventana (§8.4). */
    turnstileGlobalThreshold: positiveInt(10_000),
    turnstileWindowMinutes: positiveInt(1440),
    openingHours: z.array(openingHoursEntrySchema).max(28, { error: 'tooLong' }),
  })
  .strict();
export type AdminSettingsUpdateRequest = z.input<typeof adminSettingsUpdateRequestSchema>;

export const adminTaxRateUpdateRequestSchema = z
  .object({
    name: required(60),
    rateBps: z
      .number({ error: 'invalid' })
      .int({ error: 'invalid' })
      .min(0, { error: 'invalid' })
      .max(10_000, { error: 'invalid' }),
    appliesTo: z.enum(TAX_BASES, { error: 'invalid' }),
    fulfillmentTypes: z
      .array(z.enum(SERVICE_SCOPES))
      .min(1, { error: 'required' })
      .max(SERVICE_SCOPES.length),
    isActive: z.boolean(),
  })
  .strict();
export type AdminTaxRateUpdateRequest = z.input<typeof adminTaxRateUpdateRequestSchema>;
export const adminTaxRateResponseSchema = z.object({ taxRate: adminTaxRateSchema });

export const adminZoneUpdateRequestSchema = z
  .object({
    name: required(80),
    districts: z.array(required(80)).min(1, { error: 'required' }).max(50, { error: 'tooLong' }),
    feeMinor: minorAmount,
    etaMinutes: positiveInt(240),
    isActive: z.boolean(),
  })
  .strict();
export type AdminZoneUpdateRequest = z.input<typeof adminZoneUpdateRequestSchema>;
export const adminZoneResponseSchema = z.object({ zone: adminZoneSchema });

/**
 * Asistente de cambio de moneda (§6.2, D-M8-4): un tipo de cambio expresado siempre como colones
 * por dólar, con hasta dos decimales ("510.25"). Exige que no haya pedidos activos.
 */
export const adminCurrencyChangeRequestSchema = z
  .object({
    version: z.number().int().nonnegative(),
    currency: currencySchema,
    crcPerUsd: z
      .string({ error: 'required' })
      .trim()
      .regex(/^\d{1,6}(\.\d{1,2})?$/, { error: 'invalid' })
      .refine((value) => Number(value) >= 1, { error: 'invalid' }),
    reason: reasonSchema,
  })
  .strict();
export type AdminCurrencyChangeRequest = z.input<typeof adminCurrencyChangeRequestSchema>;
export const adminCurrencyChangeResponseSchema = z.object({
  settings: adminSettingsSchema,
  converted: z.object({
    products: z.number().int().nonnegative(),
    options: z.number().int().nonnegative(),
    zones: z.number().int().nonnegative(),
  }),
});

// ─── Auditoría (solo lectura, con filtros, §8.6) ─────────────────────────────

export const AUDIT_ENTITY_TYPES = [
  'user',
  'payment',
  'order',
  'product',
  'category',
  'optionGroup',
  'option',
  'catch',
  'settings',
  'taxRate',
  'deliveryZone',
] as const;
export const adminAuditEntrySchema = z.object({
  id: uuid,
  createdAt: z.iso.datetime(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  actor: z.object({ name: z.string(), role: z.enum(ROLE_KEYS).nullable() }).nullable(),
  before: z.record(z.string(), z.unknown()).nullable(),
  after: z.record(z.string(), z.unknown()).nullable(),
  reason: z.string().nullable(),
  requestId: z.string().nullable(),
});
export type AdminAuditEntry = z.infer<typeof adminAuditEntrySchema>;
export const adminAuditResponseSchema = z.object({ entries: z.array(adminAuditEntrySchema), nextCursor });
export type AdminAuditResponse = z.infer<typeof adminAuditResponseSchema>;

export const adminAuditQuerySchema = z.object({
  entityType: z.enum(AUDIT_ENTITY_TYPES).optional(),
  /** Prefijo de la acción, por ejemplo `product.` o `settings.currency_changed`. */
  action: z
    .string()
    .trim()
    .max(60)
    .regex(/^[a-z_.]*$/)
    .optional(),
  entityId: z.string().trim().max(80).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  cursor: uuid.optional(),
});
export type AdminAuditQuery = z.infer<typeof adminAuditQuerySchema>;

// ─── Pedidos y reembolsos (pantalla que M7 dejó para M8, ADR 0008) ───────────

export const adminOrderListItemSchema = z.object({
  id: uuid,
  code: z.string(),
  status: orderStatusSchema,
  fulfillmentType: fulfillmentTypeSchema,
  currency: currencySchema,
  totalMinor: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  customerName: z.string(),
  payment: adminPaymentSchema.pick({ status: true, method: true, amountRefundedMinor: true }),
});
export type AdminOrderListItem = z.infer<typeof adminOrderListItemSchema>;
export const adminOrdersResponseSchema = z.object({ orders: z.array(adminOrderListItemSchema), nextCursor });
export type AdminOrdersResponse = z.infer<typeof adminOrdersResponseSchema>;
export const adminOrdersQuerySchema = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  /** Código del pedido (`MB-…`) o parte del nombre o correo del cliente. */
  q: z.string().trim().max(80).optional(),
  cursor: uuid.optional(),
});

export const adminOrderDetailResponseSchema = z.object({
  order: orderSchema,
  version: z.number().int().nonnegative(),
  customer: z.object({ id: uuid, name: z.string(), email: z.string() }),
  payment: adminPaymentSchema,
  /** El admin puede cancelarlo ahora (antes o después de confirmar, §7.1). */
  canCancel: z.boolean(),
});
export type AdminOrderDetail = z.infer<typeof adminOrderDetailResponseSchema>;
