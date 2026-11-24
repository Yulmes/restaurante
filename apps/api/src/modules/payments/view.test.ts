import { customerPaymentSchema } from '@marea-baja/shared';
import { describe, expect, it } from 'vitest';
import { customerPayment, isPayable } from './view.ts';

const NOW = new Date('2026-11-24T19:00:00Z');
const later = new Date(NOW.getTime() + 60_000);
const earlier = new Date(NOW.getTime() - 1);

function order(overrides: { status?: string; expiresAt?: Date | null; payment?: object | null } = {}) {
  return {
    status: overrides.status ?? 'PENDING_PAYMENT',
    expiresAt: overrides.expiresAt === undefined ? later : overrides.expiresAt,
    payment:
      overrides.payment === null
        ? null
        : {
            status: 'REQUIRES_PAYMENT' as const,
            method: 'DEMO_CARD' as const,
            attempts: [],
            ...overrides.payment,
          },
  };
}

describe('vista del pago para el cliente (M6)', () => {
  it('se puede pagar solo en PENDING_PAYMENT, con el pago sin iniciar y antes de vencer', () => {
    expect(isPayable(order(), NOW)).toBe(true);
    expect(isPayable(order({ expiresAt: earlier }), NOW)).toBe(false);
    expect(isPayable(order({ expiresAt: NOW }), NOW)).toBe(false);
    expect(isPayable(order({ status: 'PENDING_CONFIRMATION' }), NOW)).toBe(false);
    expect(isPayable(order({ payment: { status: 'PROCESSING' } }), NOW)).toBe(false);
  });

  it('ofrece la tarjeta demo solo con DEMO_PAYMENTS_ENABLED; contra entrega, siempre que se pueda pagar', () => {
    expect(customerPayment(order(), { now: NOW, demoCardEnabled: true }).availableMethods).toEqual([
      'DEMO_CARD',
      'CASH_ON_DELIVERY',
    ]);
    expect(customerPayment(order(), { now: NOW, demoCardEnabled: false }).availableMethods).toEqual([
      'CASH_ON_DELIVERY',
    ]);
    expect(
      customerPayment(order({ expiresAt: earlier }), { now: NOW, demoCardEnabled: true }).availableMethods,
    ).toEqual([]);
  });

  it('muestra el último intento y descarta códigos desconocidos', () => {
    const at = new Date('2026-11-24T18:59:00Z');
    const view = customerPayment(
      order({
        payment: {
          attempts: [
            {
              result: 'FAILED',
              demoScenario: 'INSUFFICIENT_FUNDS',
              failureCode: 'insufficient_funds',
              createdAt: at,
            },
          ],
        },
      }),
      { now: NOW, demoCardEnabled: true },
    );
    expect(view.lastAttempt).toEqual({
      result: 'FAILED',
      scenario: 'INSUFFICIENT_FUNDS',
      failureCode: 'insufficient_funds',
      at: at.toISOString(),
    });
    const unknown = customerPayment(
      order({
        payment: {
          attempts: [{ result: 'FAILED', demoScenario: null, failureCode: 'otra cosa', createdAt: at }],
        },
      }),
      { now: NOW, demoCardEnabled: true },
    );
    expect(unknown.lastAttempt?.failureCode).toBeNull();
    expect(customerPaymentSchema.parse(view)).toEqual(view);
  });

  it('un pedido sin pago se informa como pendiente, sin métodos (no debería existir: uno por pedido)', () => {
    expect(customerPayment(order({ payment: null }), { now: NOW, demoCardEnabled: true })).toMatchObject({
      status: 'REQUIRES_PAYMENT',
      availableMethods: [],
      lastAttempt: null,
    });
  });
});
