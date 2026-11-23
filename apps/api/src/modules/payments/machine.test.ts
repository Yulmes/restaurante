import { PAYMENT_STATUSES } from '@marea-baja/shared';
import { describe, expect, it } from 'vitest';
import { assertTransition, canTransition, InvalidPaymentTransition, refundedStatus } from './machine.ts';

/** Transiciones válidas del §7.2 (más la contra entrega de D-M6-1). Todo lo demás es inválido. */
const VALID = new Set([
  'REQUIRES_PAYMENT→PROCESSING',
  'REQUIRES_PAYMENT→PENDING_COLLECTION',
  'PROCESSING→AUTHORIZED',
  'PROCESSING→REQUIRES_PAYMENT',
  'PROCESSING→PROCESSING',
  'AUTHORIZED→CAPTURED',
  'AUTHORIZED→VOIDED',
  'CAPTURED→PARTIALLY_REFUNDED',
  'CAPTURED→REFUNDED',
  'PARTIALLY_REFUNDED→PARTIALLY_REFUNDED',
  'PARTIALLY_REFUNDED→REFUNDED',
  'PENDING_COLLECTION→COLLECTED',
  'PENDING_COLLECTION→VOIDED',
]);

const MATRIX = PAYMENT_STATUSES.flatMap((from) =>
  PAYMENT_STATUSES.map((to) => [from, to, VALID.has(`${from}→${to}`)] as const),
);

describe('máquina de estados del pago (§7.2): matriz completa', () => {
  it('cubre las 81 combinaciones', () => {
    expect(MATRIX).toHaveLength(81);
  });

  it.each(MATRIX)('%s → %s: %s', (from, to, valid) => {
    expect(canTransition(from, to)).toBe(valid);
    const run = () => {
      assertTransition(from, to);
    };
    if (valid) expect(run).not.toThrow();
    else expect(run).toThrow(InvalidPaymentTransition);
  });

  it('los estados finales no salen a ningún lado', () => {
    for (const final of ['REFUNDED', 'VOIDED', 'COLLECTED'] as const) {
      expect(PAYMENT_STATUSES.filter((to) => canTransition(final, to))).toEqual([]);
    }
  });

  it('nunca se pasa de autorizado a pendiente de cobro ni se "despaga" un capturado', () => {
    expect(canTransition('AUTHORIZED', 'REQUIRES_PAYMENT')).toBe(false);
    expect(canTransition('CAPTURED', 'AUTHORIZED')).toBe(false);
    expect(canTransition('CAPTURED', 'VOIDED')).toBe(false);
    expect(canTransition('REQUIRES_PAYMENT', 'AUTHORIZED')).toBe(false);
  });
});

describe('estado tras un reembolso', () => {
  it.each([
    [10_000, 1, 'PARTIALLY_REFUNDED'],
    [10_000, 9_999, 'PARTIALLY_REFUNDED'],
    [10_000, 10_000, 'REFUNDED'],
  ] as const)('capturado %i, reembolsado %i → %s', (captured, refunded, expected) => {
    expect(refundedStatus(captured, refunded)).toBe(expected);
  });
});
