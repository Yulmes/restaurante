import type { PAYMENT_STATUSES } from '@marea-baja/shared';

/**
 * Máquina de estados del pago (§7.2). Es la única fuente de las transiciones válidas: el servicio
 * comprueba cada cambio aquí antes de escribirlo, y la matriz completa (válidas e inválidas) está
 * probada en `machine.test.ts`.
 *
 * ```
 * REQUIRES_PAYMENT → PROCESSING (authorize)
 * PROCESSING → AUTHORIZED (aprobado) | REQUIRES_PAYMENT (rechazado: se puede reintentar)
 * PROCESSING → PROCESSING (pendiente o tiempo agotado: reconciliación)
 * AUTHORIZED → CAPTURED (capture) | VOIDED (void)
 * CAPTURED → PARTIALLY_REFUNDED | REFUNDED (refund)
 * PARTIALLY_REFUNDED → PARTIALLY_REFUNDED | REFUNDED (otro refund)
 * REQUIRES_PAYMENT → PENDING_COLLECTION (contra entrega, D-M6-1)
 * PENDING_COLLECTION → COLLECTED (staff al entregar, M7) | VOIDED (cancelación)
 * ```
 */
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

const TRANSITIONS: Readonly<Record<PaymentStatus, readonly PaymentStatus[]>> = {
  REQUIRES_PAYMENT: ['PROCESSING', 'PENDING_COLLECTION'],
  PROCESSING: ['AUTHORIZED', 'REQUIRES_PAYMENT', 'PROCESSING'],
  AUTHORIZED: ['CAPTURED', 'VOIDED'],
  CAPTURED: ['PARTIALLY_REFUNDED', 'REFUNDED'],
  PARTIALLY_REFUNDED: ['PARTIALLY_REFUNDED', 'REFUNDED'],
  REFUNDED: [],
  VOIDED: [],
  PENDING_COLLECTION: ['COLLECTED', 'VOIDED'],
  COLLECTED: [],
};

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Estado final tras un reembolso: total si se devolvió todo lo capturado. */
export function refundedStatus(
  capturedMinor: number,
  refundedMinor: number,
): 'REFUNDED' | 'PARTIALLY_REFUNDED' {
  return refundedMinor >= capturedMinor ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
}

export class InvalidPaymentTransition extends Error {
  constructor(from: PaymentStatus, to: PaymentStatus) {
    super(`Transición de pago inválida: ${from} → ${to}`);
    this.name = 'InvalidPaymentTransition';
  }
}

export function assertTransition(from: PaymentStatus, to: PaymentStatus): void {
  if (!canTransition(from, to)) throw new InvalidPaymentTransition(from, to);
}
