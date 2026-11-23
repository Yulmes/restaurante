import { PAYMENT_FAILURE_CODES, type CustomerPayment, type PaymentFailureCode } from '@marea-baja/shared';
import type { Prisma } from '../../generated/prisma/client.ts';

/**
 * Cómo ve el pago la cuenta dueña del pedido (M6): estado, método, con qué puede pagar ahora y el
 * último intento de la tarjeta demo. Nunca hay datos de tarjeta: no se piden ni se guardan (§7.4).
 */
export const paymentViewInclude = {
  select: {
    status: true,
    method: true,
    attempts: {
      orderBy: { createdAt: 'desc' },
      take: 1,
      select: { result: true, demoScenario: true, failureCode: true, createdAt: true },
    },
  },
} as const satisfies Prisma.Order$paymentArgs;

export interface PaymentContext {
  now: Date;
  /** `DEMO_PAYMENTS_ENABLED`: sin esto, la tarjeta demo no se ofrece ni se acepta. */
  demoCardEnabled: boolean;
}

interface OrderForPayment {
  status: string;
  expiresAt: Date | null;
  payment: Prisma.PaymentGetPayload<typeof paymentViewInclude> | null;
}

/** El pedido admite pagar: sigue en `PENDING_PAYMENT`, sin vencer y con el pago sin iniciar. */
export function isPayable(order: OrderForPayment, now: Date): boolean {
  return (
    order.status === 'PENDING_PAYMENT' &&
    order.payment?.status === 'REQUIRES_PAYMENT' &&
    (!order.expiresAt || order.expiresAt > now)
  );
}

const isFailureCode = (code: string | null): code is PaymentFailureCode =>
  code !== null && (PAYMENT_FAILURE_CODES as readonly string[]).includes(code);

export function customerPayment(order: OrderForPayment, ctx: PaymentContext): CustomerPayment {
  const payment = order.payment;
  const attempt = payment?.attempts[0];
  return {
    status: payment?.status ?? 'REQUIRES_PAYMENT',
    method: payment?.method ?? 'DEMO_CARD',
    availableMethods: isPayable(order, ctx.now)
      ? [...(ctx.demoCardEnabled ? (['DEMO_CARD'] as const) : []), 'CASH_ON_DELIVERY']
      : [],
    lastAttempt: attempt
      ? {
          result: attempt.result,
          scenario: attempt.demoScenario,
          failureCode: isFailureCode(attempt.failureCode) ? attempt.failureCode : null,
          at: attempt.createdAt.toISOString(),
        }
      : null,
  };
}
