import { formatMoney, resolveLocale, type Locale, type OrderStatus, type RoleKey } from '@marea-baja/shared';
import type { Prisma } from '../../generated/prisma/client.ts';
import { AppError } from '../../http/errors.ts';
import { recordAudit } from '../audit/audit.ts';
import { enqueueEmail } from '../notifications/outbox.ts';
import type { OrderEmailTemplate } from '../notifications/templates/order-messages.ts';
import { canTransitionOrder, isOrderTransition } from './machine.ts';

/**
 * Cada transición del pedido (§7.1) pasa por aquí, dentro de la transacción de quien la pide:
 *
 * 1. `UPDATE … WHERE id = $1 AND status = $from [AND version = $2]`: si otra persona cambió el
 *    pedido, no se escribe nada (409 `ORDER_VERSION_CONFLICT` para quien envió una versión);
 * 2. inserta `OrderStatusHistory` (de, a, actor, motivo, fecha);
 * 3. inserta el `AuditLog` si el actor es staff o admin;
 * 4. encola los correos en `EmailOutbox` (misma transacción: si se revierte, no hay correo).
 *
 * Al entregar un pedido contra entrega, el pago pasa de `PENDING_COLLECTION` a `COLLECTED` en la
 * misma transacción (§7.4: "el staff lo marca como COLLECTED al entregar", D-M7-2).
 */
type Tx = Prisma.TransactionClient;

export interface OrderActor {
  userId: string;
  role: RoleKey;
}

export interface TransitionInput {
  orderId: string;
  from: OrderStatus;
  to: OrderStatus;
  /** `null`: la API misma (pago aprobado, reconciliación, barridos). */
  actor: OrderActor | null;
  reason: string | null;
  requestId: string | null;
  now: Date;
  /** Base de los enlaces de los correos. */
  publicWebUrl: string;
  /** Versión que vio la persona; sin ella, solo se exige que el estado siga siendo `from`. */
  expectedVersion?: number;
  /**
   * `false` cuando el permiso ya se comprobó al abrir la operación de pago que ahora termina (por
   * ejemplo, la reconciliación completa una captura que pidió el staff). La transición igual tiene
   * que existir en la máquina.
   */
  checkRole?: boolean;
}

export const versionConflict = () =>
  new AppError(409, 'ORDER_VERSION_CONFLICT', 'The order changed; reload it and try again');
export const transitionNotAllowed = () =>
  new AppError(409, 'ORDER_TRANSITION_NOT_ALLOWED', 'The order cannot move to that status');

const STATUS_EMAIL: Partial<Record<OrderStatus, OrderEmailTemplate>> = {
  PENDING_CONFIRMATION: 'order-received',
  CONFIRMED: 'order-confirmed',
  PREPARING: 'order-preparing',
  READY_FOR_PICKUP: 'order-ready',
  OUT_FOR_DELIVERY: 'order-out-for-delivery',
  DELIVERED: 'order-delivered',
  CANCELLED: 'order-cancelled',
};

const toLocale = (value: string): Locale => resolveLocale(value.replace('_', '-'));

/** Página del pedido del cliente (seguimiento), en su idioma. */
export function orderPageUrl(publicWebUrl: string, locale: Locale, orderId: string): string {
  return `${publicWebUrl}${locale === 'en' ? '/en/account/orders' : '/cuenta/pedidos'}/${orderId}`;
}

export function passPageUrl(publicWebUrl: string, locale: Locale): string {
  return `${publicWebUrl}${locale === 'en' ? '/en/admin/pass' : '/admin/pase'}`;
}

/** Aplica la transición. Devuelve `false` si el pedido ya no estaba en `from` (sin versión pedida). */
export async function applyOrderTransition(tx: Tx, input: TransitionInput): Promise<boolean> {
  const order = await tx.order.findUnique({
    where: { id: input.orderId },
    select: {
      id: true,
      code: true,
      status: true,
      version: true,
      fulfillmentType: true,
      user: { select: { id: true, email: true, name: true, locale: true } },
    },
  });
  if (!order) throw new AppError(404, 'NOT_FOUND', 'Order not found');
  if (!isOrderTransition(input.from, input.to, order.fulfillmentType)) throw transitionNotAllowed();
  const role = input.actor?.role ?? 'SYSTEM';
  if (input.checkRole !== false && !canTransitionOrder(input.from, input.to, role, order.fulfillmentType)) {
    throw transitionNotAllowed();
  }

  const moved = await tx.order.updateMany({
    where: {
      id: input.orderId,
      status: input.from,
      ...(input.expectedVersion === undefined ? {} : { version: input.expectedVersion }),
    },
    data: { status: input.to, version: { increment: 1 }, updatedAt: input.now },
  });
  if (moved.count === 0) {
    if (input.expectedVersion !== undefined) throw versionConflict();
    return false;
  }

  await tx.orderStatusHistory.create({
    data: {
      orderId: order.id,
      fromStatus: input.from,
      toStatus: input.to,
      actorUserId: input.actor?.userId ?? null,
      actorRole: input.actor?.role ?? null,
      reason: input.reason,
      createdAt: input.now,
    },
  });

  if (input.actor && (input.actor.role === 'STAFF' || input.actor.role === 'ADMIN')) {
    await recordAudit(tx, {
      actor: input.actor,
      action: input.to === 'CANCELLED' ? 'order.cancelled' : 'order.status_changed',
      entityType: 'order',
      entityId: order.id,
      before: { code: order.code, status: input.from, version: order.version },
      after: { code: order.code, status: input.to, version: order.version + 1 },
      reason: input.reason,
      requestId: input.requestId,
    });
  }

  if (input.to === 'DELIVERED') await collectOnDelivery(tx, order.id, order.code, input);

  // `PENDING_PAYMENT` es interno (§7.1): un pedido que vence sin pagar no dispara correos.
  const template =
    input.from === 'PENDING_PAYMENT' && input.to === 'CANCELLED' ? undefined : STATUS_EMAIL[input.to];
  if (template) {
    const locale = toLocale(order.user.locale);
    await enqueueEmail(
      tx,
      {
        userId: order.user.id,
        to: order.user.email,
        locale,
        template,
        data: {
          name: order.user.name,
          actionUrl: orderPageUrl(input.publicWebUrl, locale, order.id),
          orderCode: order.code,
        },
      },
      input.now,
    );
  }
  if (input.to === 'PENDING_CONFIRMATION') {
    await notifyStaff(tx, { code: order.code, fulfillmentType: order.fulfillmentType }, input);
  }
  return true;
}

/** Contra entrega: al entregar, el cobro queda hecho (`PENDING_COLLECTION → COLLECTED`). */
async function collectOnDelivery(
  tx: Tx,
  orderId: string,
  code: string,
  input: TransitionInput,
): Promise<void> {
  const payment = await tx.payment.findUnique({
    where: { orderId },
    select: { id: true, method: true, status: true },
  });
  if (payment?.method !== 'CASH_ON_DELIVERY' || payment.status !== 'PENDING_COLLECTION') return;
  await tx.payment.update({
    where: { id: payment.id },
    data: { status: 'COLLECTED', version: { increment: 1 } },
  });
  await recordAudit(tx, {
    actor: input.actor,
    action: 'payment.collected',
    entityType: 'payment',
    entityId: payment.id,
    before: { orderCode: code, method: payment.method, status: payment.status },
    after: { orderCode: code, method: payment.method, status: 'COLLECTED' },
    reason: null,
    requestId: input.requestId,
  });
}

/** Correo de administración "nuevo pedido por confirmar" (§8.5) a cada cuenta de staff o admin. */
async function notifyStaff(
  tx: Tx,
  order: { code: string; fulfillmentType: 'PICKUP' | 'DELIVERY' },
  input: TransitionInput,
): Promise<void> {
  const staff = await tx.user.findMany({
    where: { blockedAt: null, roles: { some: { role: { key: { in: ['STAFF', 'ADMIN'] } } } } },
    select: { id: true, email: true, name: true, locale: true },
    orderBy: { createdAt: 'asc' },
  });
  for (const person of staff) {
    const locale = toLocale(person.locale);
    await enqueueEmail(
      tx,
      {
        userId: person.id,
        to: person.email,
        locale,
        template: 'staff-new-order',
        data: {
          name: person.name,
          actionUrl: passPageUrl(input.publicWebUrl, locale),
          orderCode: order.code,
          fulfillmentType: order.fulfillmentType,
        },
      },
      input.now,
    );
  }
}

/** Correo "reembolso" al cliente (§8.5), con el monto en su idioma. */
export async function enqueueRefundEmail(
  tx: Tx,
  input: { orderId: string; amountMinor: number; now: Date; publicWebUrl: string },
): Promise<void> {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: input.orderId },
    select: {
      id: true,
      code: true,
      currency: true,
      user: { select: { id: true, email: true, name: true, locale: true } },
    },
  });
  const locale = toLocale(order.user.locale);
  await enqueueEmail(
    tx,
    {
      userId: order.user.id,
      to: order.user.email,
      locale,
      template: 'order-refunded',
      data: {
        name: order.user.name,
        actionUrl: orderPageUrl(input.publicWebUrl, locale, order.id),
        orderCode: order.code,
        amount: formatMoney(input.amountMinor, order.currency, locale),
      },
    },
    input.now,
  );
}
