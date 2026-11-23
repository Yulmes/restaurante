import { z } from 'zod';

/**
 * Contratos de pagos (M6, §7.2–7.4). Todo es demostración: no hay tarjetas reales, no se piden
 * datos de tarjeta y no se mueve dinero. El escenario demo es solo una **entrada** que la API valida
 * contra esta lista cerrada; monto, moneda, estado e idempotencia los decide el backend.
 */
export const PAYMENT_METHODS = ['DEMO_CARD', 'CASH_ON_DELIVERY'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const paymentMethodSchema = z.enum(PAYMENT_METHODS);

/** Selector de escenarios de la tarjeta demo (§7.4). */
export const DEMO_SCENARIOS = [
  'APPROVED',
  'DECLINED',
  'INSUFFICIENT_FUNDS',
  'PROCESSOR_ERROR',
  'TIMEOUT',
  'PENDING',
] as const;
export type DemoScenario = (typeof DEMO_SCENARIOS)[number];
export const demoScenarioSchema = z.enum(DEMO_SCENARIOS);

/** Motivo de un intento rechazado, tal como lo informa el procesador simulado. */
export const PAYMENT_FAILURE_CODES = ['card_declined', 'insufficient_funds', 'processor_error'] as const;
export type PaymentFailureCode = (typeof PAYMENT_FAILURE_CODES)[number];

export const PAYMENT_ATTEMPT_RESULTS = ['SUCCEEDED', 'FAILED', 'PENDING', 'UNKNOWN'] as const;

export const authorizePaymentRequestSchema = z.object({ scenario: demoScenarioSchema }).strict();
export type AuthorizePaymentRequest = z.input<typeof authorizePaymentRequestSchema>;

/** Reembolso (solo admin): monto en unidades menores y motivo obligatorio (§7.2, §8.6). */
export const refundRequestSchema = z
  .object({
    amountMinor: z.number().int({ error: 'invalid' }).positive({ error: 'invalid' }),
    reason: z.string().trim().min(3, { error: 'required' }).max(300, { error: 'tooLong' }),
  })
  .strict();
export type RefundRequest = z.input<typeof refundRequestSchema>;

/** Pago tal como lo ve la cuenta dueña del pedido. */
export const customerPaymentSchema = z.object({
  status: z.enum([
    'REQUIRES_PAYMENT',
    'PROCESSING',
    'AUTHORIZED',
    'CAPTURED',
    'PARTIALLY_REFUNDED',
    'REFUNDED',
    'VOIDED',
    'PENDING_COLLECTION',
    'COLLECTED',
  ]),
  /** Respuestas guardadas antes de M6 (idempotencia de 24 h) no traen estos campos. */
  method: paymentMethodSchema.default('DEMO_CARD'),
  /** Métodos con los que se puede pagar ahora; vacío si el pedido ya no admite pagar. */
  availableMethods: z.array(paymentMethodSchema).default([]),
  /** Último intento con la tarjeta demo: lo que la pantalla explica al cliente. */
  lastAttempt: z
    .object({
      result: z.enum(PAYMENT_ATTEMPT_RESULTS),
      scenario: demoScenarioSchema.nullable(),
      failureCode: z.enum(PAYMENT_FAILURE_CODES).nullable(),
      at: z.iso.datetime(),
    })
    .nullable()
    .default(null),
});
export type CustomerPayment = z.infer<typeof customerPaymentSchema>;

/** Vista de staff y admin (sin datos de tarjeta: nunca existen). */
export const adminPaymentSchema = z.object({
  id: z.uuid(),
  orderId: z.uuid(),
  orderCode: z.string(),
  orderStatus: z.string(),
  method: paymentMethodSchema,
  status: customerPaymentSchema.shape.status,
  currency: z.enum(['CRC', 'USD']),
  amountAuthorizedMinor: z.number().int().nonnegative(),
  amountCapturedMinor: z.number().int().nonnegative(),
  amountRefundedMinor: z.number().int().nonnegative(),
  refunds: z.array(
    z.object({
      id: z.uuid(),
      amountMinor: z.number().int().positive(),
      reason: z.string(),
      createdAt: z.iso.datetime(),
    }),
  ),
});
export type AdminPayment = z.infer<typeof adminPaymentSchema>;
export const adminPaymentResponseSchema = z.object({ payment: adminPaymentSchema });
