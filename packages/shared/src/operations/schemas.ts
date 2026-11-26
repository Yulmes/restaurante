import { z } from 'zod';
import { localeSchema } from '../i18n/locales.ts';
import { ORDER_STATUSES, fulfillmentTypeSchema } from '../orders/schemas.ts';
import { customerPaymentSchema, paymentMethodSchema } from '../payments/schemas.ts';

/**
 * Contratos de la operación (M7, §7.1, §3.6, §8.5): cambios de estado del pedido, el Pase de
 * cocina, el historial y el seguimiento del cliente (D3) y la bandeja de demostración.
 *
 * Igual que en los pagos, ningún endpoint recibe un monto: el cambio de estado solo trae el estado
 * de destino, la versión que vio la persona (concurrencia optimista) y un motivo opcional.
 */
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const orderStatusSchema = z.enum(ORDER_STATUSES);

const reasonSchema = z
  .string()
  .trim()
  .max(300, { error: 'tooLong' })
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .optional();

/** `PATCH /admin/orders/:id/status` (staff y admin). */
export const orderStatusChangeRequestSchema = z
  .object({
    status: orderStatusSchema,
    /** Versión del pedido que vio la persona: si cambió, 409 `ORDER_VERSION_CONFLICT` (§7.1). */
    version: z.number().int().nonnegative(),
    reason: reasonSchema,
  })
  .strict();
export type OrderStatusChangeRequest = z.input<typeof orderStatusChangeRequestSchema>;

/** `POST /orders/:id/cancel` (el cliente, solo antes de la confirmación del local). */
export const cancelOrderRequestSchema = z.object({ reason: reasonSchema }).strict();
export type CancelOrderRequest = z.input<typeof cancelOrderRequestSchema>;

/** Pedido en el historial del cliente (D3). */
export const orderSummarySchema = z.object({
  id: z.uuid(),
  code: z.string(),
  status: orderStatusSchema,
  fulfillmentType: fulfillmentTypeSchema,
  currency: z.enum(['CRC', 'USD']),
  totalMinor: z.number().int().nonnegative(),
  itemCount: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  payment: customerPaymentSchema.pick({ status: true, method: true }),
});
export type OrderSummary = z.infer<typeof orderSummarySchema>;

export const ordersListResponseSchema = z.object({
  orders: z.array(orderSummarySchema),
  /** Para pedir la página siguiente (`?cursor=`); `null` si no hay más. */
  nextCursor: z.uuid().nullable(),
});
export type OrdersListResponse = z.infer<typeof ordersListResponseSchema>;

// ─── Pase (staff y admin, §2.4 y §3.6) ──────────────────────────────────────

/** Estados que viven en el Pase: lo que todavía requiere trabajo del local. */
export const PASS_STATUSES = [
  'PENDING_CONFIRMATION',
  'CONFIRMED',
  'PREPARING',
  'READY_FOR_PICKUP',
  'OUT_FOR_DELIVERY',
] as const satisfies readonly OrderStatus[];

/** Operación del procesador en curso o rechazada, para que el Pase la muestre (§7.2). */
export const passPaymentOperationSchema = z.object({
  type: z.enum(['CAPTURE', 'VOID', 'REFUND']),
  state: z.enum(['IN_PROGRESS', 'FAILED']),
  at: z.iso.datetime(),
});

export const passOrderSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  status: orderStatusSchema,
  version: z.number().int().nonnegative(),
  fulfillmentType: fulfillmentTypeSchema,
  orderLocale: localeSchema,
  createdAt: z.iso.datetime(),
  /** Desde cuándo está en el estado actual (la antigüedad que lee la cocina). */
  statusSince: z.iso.datetime(),
  customerName: z.string(),
  contactPhone: z.string().nullable(),
  customerNote: z.string().nullable(),
  deliveryAddress: z
    .object({
      line1: z.string(),
      line2: z.string().nullable(),
      district: z.string(),
      canton: z.string(),
      reference: z.string(),
    })
    .nullable(),
  items: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      quantity: z.number().int().positive(),
      options: z.array(z.object({ group: z.string(), label: z.string() })),
    }),
  ),
  currency: z.enum(['CRC', 'USD']),
  totalMinor: z.number().int().nonnegative(),
  payment: z.object({
    method: paymentMethodSchema,
    status: customerPaymentSchema.shape.status,
    operation: passPaymentOperationSchema.nullable(),
  }),
  /** Siguiente estado operativo, si la persona puede avanzarlo (§7.1). */
  next: orderStatusSchema.nullable(),
  /** La persona puede cancelarlo (staff antes de confirmar; admin también después). */
  canCancel: z.boolean(),
});
export type PassOrder = z.infer<typeof passOrderSchema>;

export const passResponseSchema = z.object({
  orders: z.array(passOrderSchema),
  serverTime: z.iso.datetime(),
});
export type PassResponse = z.infer<typeof passResponseSchema>;

export const passOrderResponseSchema = z.object({ order: passOrderSchema });

// ─── Bandeja de demostración (§8.5) ─────────────────────────────────────────

export const EMAIL_DELIVERY_STATUSES = ['QUEUED', 'SENT', 'DEMO_ONLY', 'FAILED'] as const;

export const demoInboxMessageSchema = z.object({
  id: z.uuid(),
  template: z.string(),
  status: z.enum(EMAIL_DELIVERY_STATUSES),
  /** Destinatario: siempre el correo de la propia cuenta. */
  to: z.string(),
  locale: localeSchema,
  subject: z.string(),
  /** Texto del correo. Los enlaces de un solo uso (verificación, recuperación) nunca se incluyen. */
  body: z.array(z.string()),
  /** Enlace al pedido, si el correo es de un pedido. */
  orderId: z.uuid().nullable(),
  /**
   * M10 (D-M10-P1): el último correo de verificación de una cuenta sin verificar quedó `DEMO_ONLY`
   * y la demo permite verificarla desde la bandeja (`POST /api/auth/demo-verify`).
   */
  demoVerifiable: z.boolean(),
  createdAt: z.iso.datetime(),
  sentAt: z.iso.datetime().nullable(),
});
export type DemoInboxMessage = z.infer<typeof demoInboxMessageSchema>;

export const demoInboxResponseSchema = z.object({ messages: z.array(demoInboxMessageSchema) });
export type DemoInboxResponse = z.infer<typeof demoInboxResponseSchema>;
