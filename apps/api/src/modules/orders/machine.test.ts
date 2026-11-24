import { FULFILLMENT_TYPES, ORDER_STATUSES } from '@marea-baja/shared';
import { describe, expect, it } from 'vitest';
import {
  canTransitionOrder,
  isOrderTransition,
  nextOrderStatus,
  operatingRole,
  type OrderActorRole,
} from './machine.ts';

/**
 * Matriz completa del §7.1 (M7): 8 estados × 8 estados × 4 actores × 2 modalidades = 512 casos.
 * `PERMITTED` lista exactamente lo permitido; todo lo demás tiene que quedar rechazado.
 */
const ROLES: readonly OrderActorRole[] = ['CUSTOMER', 'STAFF', 'ADMIN', 'SYSTEM'];

const PERMITTED = new Set([
  // Pago (M6): autorizado o contra entrega → por confirmar. Vencido sin pagar → cancelado.
  'PENDING_PAYMENT→PENDING_CONFIRMATION:SYSTEM:PICKUP',
  'PENDING_PAYMENT→PENDING_CONFIRMATION:SYSTEM:DELIVERY',
  'PENDING_PAYMENT→CANCELLED:SYSTEM:PICKUP',
  'PENDING_PAYMENT→CANCELLED:SYSTEM:DELIVERY',
  // El local confirma (=> capture).
  ...['STAFF', 'ADMIN'].flatMap((r) => [
    `PENDING_CONFIRMATION→CONFIRMED:${r}:PICKUP`,
    `PENDING_CONFIRMATION→CONFIRMED:${r}:DELIVERY`,
  ]),
  // Cancelar antes de confirmar (=> void): cliente, staff, admin y el barrido de 20 min.
  ...ROLES.flatMap((r) => [
    `PENDING_CONFIRMATION→CANCELLED:${r}:PICKUP`,
    `PENDING_CONFIRMATION→CANCELLED:${r}:DELIVERY`,
  ]),
  ...['STAFF', 'ADMIN'].flatMap((r) => [
    `CONFIRMED→PREPARING:${r}:PICKUP`,
    `CONFIRMED→PREPARING:${r}:DELIVERY`,
    `PREPARING→READY_FOR_PICKUP:${r}:PICKUP`,
    `PREPARING→OUT_FOR_DELIVERY:${r}:DELIVERY`,
    `READY_FOR_PICKUP→DELIVERED:${r}:PICKUP`,
    `OUT_FOR_DELIVERY→DELIVERED:${r}:DELIVERY`,
  ]),
  // Solo admin cancela después de confirmar (=> refund total).
  'CONFIRMED→CANCELLED:ADMIN:PICKUP',
  'CONFIRMED→CANCELLED:ADMIN:DELIVERY',
]);

const MATRIX = ORDER_STATUSES.flatMap((from) =>
  ORDER_STATUSES.flatMap((to) =>
    ROLES.flatMap((role) =>
      FULFILLMENT_TYPES.map(
        (fulfillment) =>
          [from, to, role, fulfillment, PERMITTED.has(`${from}→${to}:${role}:${fulfillment}`)] as const,
      ),
    ),
  ),
);

describe('máquina de estados del pedido (§7.1): matriz completa', () => {
  it('cubre las 512 combinaciones y 30 están permitidas', () => {
    expect(MATRIX).toHaveLength(512);
    expect(MATRIX.filter((row) => row[4])).toHaveLength(PERMITTED.size);
    expect(PERMITTED.size).toBe(30);
  });

  it.each(MATRIX)('%s → %s por %s (%s): %s', (from, to, role, fulfillment, expected) => {
    expect(canTransitionOrder(from, to, role, fulfillment)).toBe(expected);
  });

  it('los estados finales no salen a ningún lado y ningún estado vuelve a sí mismo', () => {
    for (const to of ORDER_STATUSES) {
      for (const fulfillment of FULFILLMENT_TYPES) {
        expect(isOrderTransition('DELIVERED', to, fulfillment)).toBe(false);
        expect(isOrderTransition('CANCELLED', to, fulfillment)).toBe(false);
      }
    }
    for (const status of ORDER_STATUSES) expect(isOrderTransition(status, status, 'PICKUP')).toBe(false);
  });

  it('retiro y delivery no comparten el paso "listo / en camino"', () => {
    expect(isOrderTransition('PREPARING', 'OUT_FOR_DELIVERY', 'PICKUP')).toBe(false);
    expect(isOrderTransition('PREPARING', 'READY_FOR_PICKUP', 'DELIVERY')).toBe(false);
    expect(isOrderTransition('OUT_FOR_DELIVERY', 'DELIVERED', 'PICKUP')).toBe(false);
  });
});

describe('siguiente paso del Pase', () => {
  it('avanza por el camino de cada modalidad y nunca propone cancelar', () => {
    expect(nextOrderStatus('PENDING_CONFIRMATION', 'PICKUP', 'STAFF')).toBe('CONFIRMED');
    expect(nextOrderStatus('CONFIRMED', 'PICKUP', 'STAFF')).toBe('PREPARING');
    expect(nextOrderStatus('PREPARING', 'PICKUP', 'STAFF')).toBe('READY_FOR_PICKUP');
    expect(nextOrderStatus('PREPARING', 'DELIVERY', 'STAFF')).toBe('OUT_FOR_DELIVERY');
    expect(nextOrderStatus('READY_FOR_PICKUP', 'PICKUP', 'ADMIN')).toBe('DELIVERED');
    expect(nextOrderStatus('OUT_FOR_DELIVERY', 'DELIVERY', 'ADMIN')).toBe('DELIVERED');
    expect(nextOrderStatus('DELIVERED', 'PICKUP', 'ADMIN')).toBeNull();
    expect(nextOrderStatus('CANCELLED', 'DELIVERY', 'ADMIN')).toBeNull();
    // El pago lo mueve el sistema, no el Pase; el cliente no avanza nada.
    expect(nextOrderStatus('PENDING_PAYMENT', 'PICKUP', 'STAFF')).toBeNull();
    expect(nextOrderStatus('PENDING_CONFIRMATION', 'PICKUP', 'CUSTOMER')).toBeNull();
  });

  it('el rol que opera es el más alto de la cuenta', () => {
    expect(operatingRole(['CUSTOMER'])).toBe('CUSTOMER');
    expect(operatingRole(['CUSTOMER', 'STAFF'])).toBe('STAFF');
    expect(operatingRole(['STAFF', 'ADMIN', 'CUSTOMER'])).toBe('ADMIN');
  });
});
