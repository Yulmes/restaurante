import type { FulfillmentType, OrderStatus, RoleKey } from '@marea-baja/shared';

/**
 * Máquina de estados del pedido (§7.1, M7). Es la única fuente de las transiciones válidas y de
 * quién puede hacer cada una; la matriz completa (estado × estado × rol × modalidad) está probada
 * en `machine.test.ts`.
 *
 * ```
 * PENDING_PAYMENT → PENDING_CONFIRMATION   sistema: pago autorizado o contra entrega elegida (M6)
 * PENDING_PAYMENT → CANCELLED              sistema: vence a los 30 min sin pagar
 * PENDING_CONFIRMATION → CONFIRMED         staff/admin (=> CAPTURE de la tarjeta demo)
 * PENDING_CONFIRMATION → CANCELLED         cliente (propio), staff/admin, sistema a los 20 min (=> VOID)
 * CONFIRMED → PREPARING                    staff/admin
 * CONFIRMED → CANCELLED                    solo admin (=> REFUND total)
 * PREPARING → READY_FOR_PICKUP             staff/admin, solo retiro
 * PREPARING → OUT_FOR_DELIVERY             staff/admin, solo delivery
 * READY_FOR_PICKUP → DELIVERED             staff/admin (retiro)
 * OUT_FOR_DELIVERY → DELIVERED             staff/admin (delivery)
 * ```
 *
 * `SYSTEM` es la propia API (pagos, reconciliación y barridos), nunca una persona.
 */
export type OrderActorRole = RoleKey | 'SYSTEM';

interface Rule {
  from: OrderStatus;
  to: OrderStatus;
  roles: readonly OrderActorRole[];
  /** Solo para esa modalidad. */
  fulfillment?: FulfillmentType;
}

const STAFF: readonly OrderActorRole[] = ['STAFF', 'ADMIN'];

const RULES: readonly Rule[] = [
  { from: 'PENDING_PAYMENT', to: 'PENDING_CONFIRMATION', roles: ['SYSTEM'] },
  { from: 'PENDING_PAYMENT', to: 'CANCELLED', roles: ['SYSTEM'] },
  { from: 'PENDING_CONFIRMATION', to: 'CONFIRMED', roles: STAFF },
  { from: 'PENDING_CONFIRMATION', to: 'CANCELLED', roles: ['CUSTOMER', 'STAFF', 'ADMIN', 'SYSTEM'] },
  { from: 'CONFIRMED', to: 'PREPARING', roles: STAFF },
  { from: 'CONFIRMED', to: 'CANCELLED', roles: ['ADMIN'] },
  { from: 'PREPARING', to: 'READY_FOR_PICKUP', roles: STAFF, fulfillment: 'PICKUP' },
  { from: 'PREPARING', to: 'OUT_FOR_DELIVERY', roles: STAFF, fulfillment: 'DELIVERY' },
  { from: 'READY_FOR_PICKUP', to: 'DELIVERED', roles: STAFF, fulfillment: 'PICKUP' },
  { from: 'OUT_FOR_DELIVERY', to: 'DELIVERED', roles: STAFF, fulfillment: 'DELIVERY' },
];

/** Estados finales: no salen a ningún lado. */
export const FINAL_ORDER_STATUSES: readonly OrderStatus[] = ['DELIVERED', 'CANCELLED'];

function rule(from: OrderStatus, to: OrderStatus, fulfillment: FulfillmentType): Rule | undefined {
  return RULES.find(
    (r) => r.from === from && r.to === to && (!r.fulfillment || r.fulfillment === fulfillment),
  );
}

/** La transición existe para esa modalidad (sin mirar el rol). */
export function isOrderTransition(from: OrderStatus, to: OrderStatus, fulfillment: FulfillmentType): boolean {
  return rule(from, to, fulfillment) !== undefined;
}

/** La transición existe y ese rol puede hacerla. */
export function canTransitionOrder(
  from: OrderStatus,
  to: OrderStatus,
  role: OrderActorRole,
  fulfillment: FulfillmentType,
): boolean {
  return rule(from, to, fulfillment)?.roles.includes(role) ?? false;
}

/** El rol más alto de la persona, entre los que operan pedidos. */
export function operatingRole(roles: readonly RoleKey[]): OrderActorRole {
  if (roles.includes('ADMIN')) return 'ADMIN';
  if (roles.includes('STAFF')) return 'STAFF';
  return 'CUSTOMER';
}

/** Siguiente paso operativo del Pase ("avanzar"), si ese rol puede darlo. Nunca es cancelar. */
export function nextOrderStatus(
  status: OrderStatus,
  fulfillment: FulfillmentType,
  role: OrderActorRole,
): OrderStatus | null {
  const found = RULES.find(
    (r) =>
      r.from === status &&
      r.to !== 'CANCELLED' &&
      (!r.fulfillment || r.fulfillment === fulfillment) &&
      r.roles.includes(role),
  );
  return found?.to ?? null;
}

export class InvalidOrderTransition extends Error {
  constructor(from: OrderStatus, to: OrderStatus) {
    super(`Transición de pedido inválida: ${from} → ${to}`);
    this.name = 'InvalidOrderTransition';
  }
}
