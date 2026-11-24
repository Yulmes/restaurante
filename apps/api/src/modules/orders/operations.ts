import {
  PASS_STATUSES,
  type Order,
  type OrderStatus,
  type OrdersListResponse,
  type PassOrder,
  type PassResponse,
} from '@marea-baja/shared';
import type { Logger } from 'pino';
import type { AppConfig } from '../../config/app-config.ts';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.ts';
import { AppError } from '../../http/errors.ts';
import type { Clock } from '../../lib/clock.ts';
import { recordAudit } from '../audit/audit.ts';
import type { PaymentService } from '../payments/service.ts';
import { canTransitionOrder, isOrderTransition, nextOrderStatus, type OrderActorRole } from './machine.ts';
import { orderInclude, toOrder } from './service.ts';
import {
  applyOrderTransition,
  transitionNotAllowed,
  versionConflict,
  type OrderActor,
} from './transitions.ts';

/**
 * Operación del local (M7, §7.1, §3.6):
 *
 * - **Pase** (staff y admin): pedidos que esperan trabajo, con su antigüedad, y el cambio de estado
 *   con la versión que vio la persona. Confirmar captura la tarjeta demo, cancelar antes de
 *   confirmar la anula y cancelar después (solo admin) la reembolsa: el pedido cambia recién cuando
 *   el pago terminó (`PaymentService`). El resto de las transiciones son directas.
 * - **Cliente** (D3): historial paginado y cancelación propia antes de la confirmación.
 * - **Barridos** (§7.1, §4.3): cancelan los pedidos que vencieron sin pagar (30 min) y los que no se
 *   confirmaron a tiempo (20 min, configurable), anulando su autorización.
 */
type Tx = Prisma.TransactionClient;
type Db = Tx | PrismaClient;

const notFound = () => new AppError(404, 'NOT_FOUND', 'Order not found');
const inProgress = () => new AppError(409, 'PAYMENT_IN_PROGRESS', 'A payment operation is in progress');
const OPEN_OPERATION = ['REQUESTED', 'UNKNOWN'] as const;
const PAGE_SIZE = 20;

const passInclude = {
  items: { orderBy: { id: 'asc' }, include: { options: { orderBy: { id: 'asc' } } } },
  user: { select: { name: true } },
  payment: {
    select: {
      method: true,
      status: true,
      operations: {
        where: { type: { in: ['CAPTURE', 'VOID', 'REFUND'] } },
        orderBy: { updatedAt: 'desc' },
        take: 1,
        select: { type: true, status: true, updatedAt: true },
      },
    },
  },
  statusHistory: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } },
} as const satisfies Prisma.OrderInclude;
type PassRow = Prisma.OrderGetPayload<{ include: typeof passInclude }>;

interface AddressSnapshot {
  line1: string;
  line2: string | null;
  district: string;
  canton: string;
  reference: string;
}

function passItems(row: PassRow): PassOrder['items'] {
  // Mismo plato y mismas opciones: un único producto con la cantidad total (C5).
  const groups = new Map<string, PassOrder['items'][number]>();
  for (const item of row.items) {
    const key = `${item.productId ?? item.productName}:${item.options
      .map((o) => o.optionId ?? o.labelEsCr)
      .sort()
      .join(',')}`;
    const current = groups.get(key);
    if (current) {
      current.quantity += item.quantity;
      continue;
    }
    groups.set(key, {
      key,
      // El Pase lee la comanda en español, el idioma del local.
      name: item.productName,
      quantity: item.quantity,
      options: item.options.map((o) => ({ group: o.groupLabelEsCr, label: o.labelEsCr })),
    });
  }
  return [...groups.values()];
}

function toPassOrder(row: PassRow, role: OrderActorRole): PassOrder {
  const op = row.payment?.operations[0];
  const operation =
    op && op.type !== 'AUTHORIZE' && op.status !== 'SUCCEEDED'
      ? {
          type: op.type,
          state: op.status === 'FAILED' ? ('FAILED' as const) : ('IN_PROGRESS' as const),
          at: op.updatedAt.toISOString(),
        }
      : null;
  const address = row.deliveryAddress as AddressSnapshot | null;
  const status = row.status;
  return {
    id: row.id,
    code: row.code,
    status,
    version: row.version,
    fulfillmentType: row.fulfillmentType,
    orderLocale: row.orderLocale === 'en' ? 'en' : 'es-CR',
    createdAt: row.createdAt.toISOString(),
    statusSince: (row.statusHistory[0]?.createdAt ?? row.createdAt).toISOString(),
    customerName: row.user.name,
    contactPhone: row.contactPhone,
    customerNote: row.customerNote,
    deliveryAddress: address
      ? {
          line1: address.line1,
          line2: address.line2,
          district: address.district,
          canton: address.canton,
          reference: address.reference,
        }
      : null,
    items: passItems(row),
    currency: row.currency,
    totalMinor: row.totalMinor,
    payment: {
      method: row.payment?.method ?? 'DEMO_CARD',
      status: row.payment?.status ?? 'REQUIRES_PAYMENT',
      operation,
    },
    next: nextOrderStatus(status, row.fulfillmentType, role),
    canCancel: canTransitionOrder(status, 'CANCELLED', role, row.fulfillmentType),
  };
}

export class OperationsService {
  readonly #db: PrismaClient;
  readonly #clock: Clock;
  readonly #config: AppConfig;
  readonly #payments: PaymentService;
  readonly #afterCommit: () => void;

  constructor(deps: {
    db: PrismaClient;
    clock: Clock;
    config: AppConfig;
    payments: PaymentService;
    afterCommit?: () => void;
  }) {
    this.#db = deps.db;
    this.#clock = deps.clock;
    this.#config = deps.config;
    this.#payments = deps.payments;
    this.#afterCommit = deps.afterCommit ?? (() => undefined);
  }

  // ─── Pase (staff y admin) ────────────────────────────────────────────────────

  async pass(role: OrderActorRole): Promise<PassResponse> {
    const rows = await this.#db.order.findMany({
      where: { status: { in: [...PASS_STATUSES] } },
      include: passInclude,
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    const orders = rows
      .map((row) => toPassOrder(row, role))
      .sort((a, b) => a.statusSince.localeCompare(b.statusSince));
    return { orders, serverTime: this.#clock.now().toISOString() };
  }

  async #passOrder(db: Db, orderId: string, role: OrderActorRole): Promise<PassOrder> {
    const row = await db.order.findUnique({ where: { id: orderId }, include: passInclude });
    if (!row) throw notFound();
    return toPassOrder(row, role);
  }

  /**
   * `PATCH /admin/orders/:id/status`. Devuelve 200 si el pedido cambió; 202 si la operación del
   * procesador quedó sin respuesta (la termina la reconciliación y el Pase lo muestra en curso).
   * Si el procesador la rechaza, 502 y el pedido no cambia (§7.2).
   */
  async changeStatus(
    actor: OrderActor,
    orderId: string,
    input: { status: OrderStatus; version: number; reason?: string | null | undefined },
    requestId: string,
  ): Promise<{ status: number; order: PassOrder }> {
    const order = await this.#db.order.findUnique({
      where: { id: orderId },
      select: {
        status: true,
        version: true,
        fulfillmentType: true,
        payment: { select: { method: true, status: true } },
      },
    });
    if (!order) throw notFound();
    if (order.version !== input.version) throw versionConflict();
    const from = order.status;
    const to = input.status;
    if (!isOrderTransition(from, to, order.fulfillmentType)) throw transitionNotAllowed();
    if (!canTransitionOrder(from, to, actor.role, order.fulfillmentType)) {
      throw new AppError(403, 'FORBIDDEN', 'Insufficient role for this transition');
    }
    const reason = input.reason ?? null;
    if (to === 'CANCELLED' && !reason) {
      // §8.6: toda cancelación del staff o del admin queda en el AuditLog con su motivo.
      throw new AppError(400, 'VALIDATION_FAILED', 'A reason is required to cancel', {
        fields: { reason: 'required' },
      });
    }
    const payment = order.payment;
    const options = { expectedVersion: input.version };

    let status = 200;
    if (to === 'CONFIRMED' && payment?.method === 'DEMO_CARD') {
      status = (await this.#payments.capture(actor, orderId, requestId, options)).status;
    } else if (to === 'CANCELLED' && from === 'PENDING_CONFIRMATION') {
      status = (await this.#payments.voidPayment(actor, orderId, reason, requestId, options)).status;
    } else if (to === 'CANCELLED' && from === 'CONFIRMED' && reason) {
      status = (await this.#payments.cancelConfirmed(actor, orderId, reason, requestId, options)).status;
    } else {
      await this.#plainTransition(actor, orderId, from, to, reason, requestId, input.version);
    }
    return { status, order: await this.#passOrder(this.#db, orderId, actor.role) };
  }

  /** Transición sin operación del procesador: con el pago bloqueado y sin operaciones en curso. */
  async #plainTransition(
    actor: OrderActor | null,
    orderId: string,
    from: OrderStatus,
    to: OrderStatus,
    reason: string | null,
    requestId: string | null,
    expectedVersion?: number,
  ): Promise<boolean> {
    const moved = await this.#db.$transaction(async (tx) => {
      // Mismo candado que los pagos: una captura, anulación o reembolso en curso se espera o se informa.
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Payment" WHERE "orderId" = ${orderId}::uuid FOR UPDATE`;
      const paymentId = locked[0]?.id;
      if (paymentId) {
        const busy = await tx.paymentOperation.count({
          where: { paymentId, status: { in: [...OPEN_OPERATION] } },
        });
        if (busy > 0) throw inProgress();
      }
      return applyOrderTransition(tx, {
        orderId,
        from,
        to,
        actor,
        reason,
        requestId,
        now: this.#clock.now(),
        publicWebUrl: this.#config.publicWebUrl,
        ...(expectedVersion === undefined ? {} : { expectedVersion }),
      });
    });
    this.#afterCommit();
    return moved;
  }

  /** Límite de staff/admin superado al cambiar un estado: queda en el AuditLog (§8.4). */
  async auditRateLimited(
    actor: OrderActor,
    orderId: string,
    target: string,
    requestId: string,
  ): Promise<void> {
    const order = await this.#db.order.findUnique({ where: { id: orderId }, select: { id: true } });
    if (!order) return;
    await this.#db.$transaction((tx) =>
      recordAudit(tx, {
        actor,
        action: 'order.rate_limited',
        entityType: 'order',
        entityId: order.id,
        reason: target,
        requestId,
      }),
    );
  }

  // ─── Cliente (D3) ────────────────────────────────────────────────────────────

  /** Historial propio, del más nuevo al más viejo, de a 20. */
  async listForCustomer(userId: string, cursor: string | null): Promise<OrdersListResponse> {
    const rows = await this.#db.order.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: PAGE_SIZE + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        code: true,
        status: true,
        fulfillmentType: true,
        currency: true,
        totalMinor: true,
        createdAt: true,
        userId: true,
        items: { select: { quantity: true } },
        payment: { select: { status: true, method: true } },
      },
    });
    // Un cursor ajeno o inexistente no devuelve pedidos de otra cuenta: el filtro por `userId` manda.
    const page = rows.slice(0, PAGE_SIZE);
    return {
      orders: page.map((row) => ({
        id: row.id,
        code: row.code,
        status: row.status,
        fulfillmentType: row.fulfillmentType,
        currency: row.currency,
        totalMinor: row.totalMinor,
        itemCount: row.items.reduce((sum, item) => sum + item.quantity, 0),
        createdAt: row.createdAt.toISOString(),
        payment: {
          status: row.payment?.status ?? 'REQUIRES_PAYMENT',
          method: row.payment?.method ?? 'DEMO_CARD',
        },
      })),
      nextCursor: rows.length > PAGE_SIZE ? (page.at(-1)?.id ?? null) : null,
    };
  }

  /**
   * El cliente cancela su pedido antes de que el local lo confirme (§7.1): se anula la autorización
   * de la tarjeta demo (o el cobro contra entrega) y, hecha la anulación, el pedido pasa a
   * `CANCELLED`. Ajeno o inexistente → 404.
   */
  async cancelByCustomer(
    userId: string,
    orderId: string,
    reason: string | null,
    requestId: string,
  ): Promise<{ status: number; order: Order }> {
    const order = await this.#db.order.findFirst({
      where: { id: orderId, userId },
      select: { status: true },
    });
    if (!order) throw notFound();
    if (order.status !== 'PENDING_CONFIRMATION') throw transitionNotAllowed();
    const { status } = await this.#payments.voidPayment(
      { userId, role: 'CUSTOMER' },
      orderId,
      reason,
      requestId,
      {
        ownerId: userId,
      },
    );
    const row = await this.#db.order.findUniqueOrThrow({ where: { id: orderId }, include: orderInclude });
    return {
      status,
      order: toOrder(row, { now: this.#clock.now(), demoCardEnabled: this.#config.demoPaymentsEnabled }),
    };
  }

  // ─── Barridos (§7.1, §4.3) ───────────────────────────────────────────────────

  /**
   * 1. `PENDING_PAYMENT` vencido (30 min) → `CANCELLED`. Si el pago está en proceso, se espera a la
   *    reconciliación (no se cancela un pedido cuyo cobro todavía no se sabe).
   * 2. `PENDING_CONFIRMATION` sin confirmar a tiempo (20 min, configurable) → se anula y cancela.
   *    También el que pasó a `PENDING_CONFIRMATION` **después** de vencer (la reconciliación
   *    encontró la autorización tarde, R-M6-2): su reserva ya había vencido, se anula enseguida.
   */
  async sweep(logger?: Logger, limit = 50): Promise<{ expired: number; unconfirmed: number }> {
    const now = this.#clock.now();
    const result = { expired: 0, unconfirmed: 0 };

    const expired = await this.#db.order.findMany({
      where: {
        status: 'PENDING_PAYMENT',
        expiresAt: { lte: now },
        payment: { status: 'REQUIRES_PAYMENT' },
      },
      orderBy: { expiresAt: 'asc' },
      take: limit,
      select: { id: true },
    });
    for (const { id } of expired) {
      try {
        const moved = await this.#db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "Payment" WHERE "orderId" = ${id}::uuid FOR UPDATE`;
          const payment = await tx.payment.findUnique({ where: { orderId: id }, select: { status: true } });
          // Otro proceso empezó a pagarlo justo antes: lo resuelve la reconciliación.
          if (payment && payment.status !== 'REQUIRES_PAYMENT') return false;
          return applyOrderTransition(tx, {
            orderId: id,
            from: 'PENDING_PAYMENT',
            to: 'CANCELLED',
            actor: null,
            reason: 'expired',
            requestId: null,
            now,
            publicWebUrl: this.#config.publicWebUrl,
          });
        });
        if (moved) result.expired += 1;
      } catch (error) {
        logger?.error({ err: error, orderId: id }, 'order expiry failed');
      }
    }

    const deadline = new Date(now.getTime() - this.#config.orderConfirmationTimeoutMs);
    const late = await this.#db.$queryRaw<{ id: string; reason: string }[]>`
      SELECT o."id",
             CASE WHEN o."expiresAt" IS NOT NULL AND h."createdAt" > o."expiresAt"
                  THEN 'authorized_after_expiry' ELSE 'confirmation_timeout' END AS "reason"
        FROM "Order" o
        JOIN LATERAL (
          SELECT "createdAt" FROM "OrderStatusHistory"
           WHERE "orderId" = o."id" AND "toStatus" = 'PENDING_CONFIRMATION'
           ORDER BY "createdAt" DESC LIMIT 1
        ) h ON true
       WHERE o."status" = 'PENDING_CONFIRMATION'
         AND (h."createdAt" <= ${deadline} OR (o."expiresAt" IS NOT NULL AND h."createdAt" > o."expiresAt"))
       ORDER BY h."createdAt"
       LIMIT ${limit}`;
    for (const { id, reason } of late) {
      try {
        const { status } = await this.#payments.voidPayment(null, id, reason, null);
        if (status === 200) result.unconfirmed += 1;
      } catch (error) {
        // En curso (409) o rechazada (502): la próxima vuelta lo intenta de nuevo.
        if (!(error instanceof AppError)) logger?.error({ err: error, orderId: id }, 'order timeout failed');
      }
    }
    if (result.expired > 0) this.#afterCommit();
    return result;
  }
}
