import {
  ORDER_STATUSES,
  type AdminAuditQuery,
  type AdminAuditResponse,
  type AdminDashboard,
  type AdminOrderDetail,
  type AdminOrdersResponse,
  type DashboardRange,
  type OrderStatus,
} from '@marea-baja/shared';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.ts';
import { AppError } from '../../http/errors.ts';
import type { Clock } from '../../lib/clock.ts';
import { canTransitionOrder } from '../orders/machine.ts';
import { orderInclude, toOrder } from '../orders/service.ts';
import type { PaymentService } from '../payments/service.ts';
import { addDays, localDateOf, localDateTime } from './time.ts';

/**
 * Lecturas del admin (M8): dashboard con datos reales (§12), auditoría de solo lectura con filtros
 * (§8.6) y la lista y el detalle de pedidos con su pago, desde donde se reembolsa (ADR 0008).
 */
const RANGE_DAYS: Record<DashboardRange, number> = { today: 1, '7d': 7, '30d': 30 };
/** Pedidos aceptados por el local: cuentan como venta (§7.1). */
const ACCEPTED: OrderStatus[] = [
  'CONFIRMED',
  'PREPARING',
  'READY_FOR_PICKUP',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
];
const PAGE_SIZE = 25;

export interface InsightsDeps {
  db: PrismaClient;
  clock: Clock;
  payments: PaymentService;
  demoPaymentsEnabled: boolean;
}

export class InsightsAdminService {
  readonly #db: PrismaClient;
  readonly #clock: Clock;
  readonly #payments: PaymentService;
  readonly #demoPaymentsEnabled: boolean;

  constructor(deps: InsightsDeps) {
    this.#db = deps.db;
    this.#clock = deps.clock;
    this.#payments = deps.payments;
    this.#demoPaymentsEnabled = deps.demoPaymentsEnabled;
  }

  async #localeSettings(): Promise<{ timezone: string; currency: 'CRC' | 'USD' }> {
    const settings = await this.#db.restaurantSettings.findUniqueOrThrow({
      where: { id: 1 },
      select: { timezone: true, currency: true },
    });
    return settings;
  }

  async dashboard(range: DashboardRange): Promise<AdminDashboard> {
    const now = this.#clock.now();
    const { timezone, currency } = await this.#localeSettings();
    const today = localDateOf(now, timezone);
    const from = localDateTime(addDays(today, -(RANGE_DAYS[range] - 1)), timezone);
    const inRange: Prisma.OrderWhereInput = { createdAt: { gte: from, lte: now } };
    const sold: Prisma.OrderWhereInput = { ...inRange, status: { in: ACCEPTED }, currency };

    const [byStatus, salesAgg, refundedAgg, otherCurrency, pendingNow, top] = await Promise.all([
      this.#db.order.groupBy({ by: ['status'], where: inRange, _count: { _all: true } }),
      this.#db.order.aggregate({ where: sold, _sum: { totalMinor: true }, _count: { _all: true } }),
      this.#db.payment.aggregate({ where: { order: sold }, _sum: { amountRefundedMinor: true } }),
      this.#db.order.count({ where: { ...inRange, status: { in: ACCEPTED }, currency: { not: currency } } }),
      this.#db.order.groupBy({
        by: ['status'],
        where: {
          status: {
            in: ['PENDING_CONFIRMATION', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY'],
          },
        },
        _count: { _all: true },
      }),
      this.#db.orderItem.groupBy({
        by: ['productName'],
        where: { order: sold },
        _sum: { quantity: true, lineTotalMinor: true },
        orderBy: [{ _sum: { quantity: 'desc' } }, { productName: 'asc' }],
        take: 5,
      }),
    ]);

    const count = (rows: { status: OrderStatus; _count: { _all: number } }[], ...statuses: OrderStatus[]) =>
      rows.filter((row) => statuses.includes(row.status)).reduce((sum, row) => sum + row._count._all, 0);
    const orders = salesAgg._count._all;
    const grossMinor = salesAgg._sum.totalMinor ?? 0;
    const refundedMinor = refundedAgg._sum.amountRefundedMinor ?? 0;

    return {
      range,
      from: from.toISOString(),
      to: now.toISOString(),
      timezone,
      currency,
      serverTime: now.toISOString(),
      ordersByStatus: ORDER_STATUSES.map((status) => ({ status, count: count(byStatus, status) })),
      sales: {
        orders,
        grossMinor,
        refundedMinor,
        netMinor: grossMinor - refundedMinor,
        averageTicketMinor: orders === 0 ? 0 : Math.floor((2 * grossMinor + orders) / (2 * orders)),
      },
      pending: {
        confirmation: count(pendingNow, 'PENDING_CONFIRMATION'),
        kitchen: count(pendingNow, 'CONFIRMED', 'PREPARING'),
        ready: count(pendingNow, 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY'),
      },
      cancelled: count(byStatus, 'CANCELLED'),
      topProducts: top
        .filter((row) => (row._sum.quantity ?? 0) > 0)
        .map((row) => ({
          name: row.productName,
          quantity: row._sum.quantity ?? 0,
          revenueMinor: row._sum.lineTotalMinor ?? 0,
        })),
      otherCurrencyOrders: otherCurrency,
    };
  }

  async audit(query: AdminAuditQuery): Promise<AdminAuditResponse> {
    const { timezone } = await this.#localeSettings();
    const createdAt: Prisma.DateTimeFilter = {};
    if (query.from) createdAt.gte = localDateTime(query.from, timezone);
    if (query.to) createdAt.lt = localDateTime(addDays(query.to, 1), timezone);
    const rows = await this.#db.auditLog.findMany({
      where: {
        ...(query.entityType ? { entityType: query.entityType } : {}),
        ...(query.action ? { action: { startsWith: query.action } } : {}),
        ...(query.entityId ? { entityId: query.entityId } : {}),
        ...(query.from || query.to ? { createdAt } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: PAGE_SIZE + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: { actor: { select: { name: true } } },
    });
    const page = rows.slice(0, PAGE_SIZE);
    const asRecord = (value: Prisma.JsonValue | null): Record<string, unknown> | null =>
      value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
    return {
      entries: page.map((row) => ({
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        actor: row.actor ? { name: row.actor.name, role: row.actorRole } : null,
        before: asRecord(row.before),
        after: asRecord(row.after),
        reason: row.reason,
        requestId: row.requestId,
      })),
      nextCursor: rows.length > PAGE_SIZE ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async orders(query: {
    status?: OrderStatus | undefined;
    q?: string | undefined;
    cursor?: string | undefined;
  }): Promise<AdminOrdersResponse> {
    const q = query.q?.trim();
    const rows = await this.#db.order.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(q
          ? {
              OR: [
                { code: { startsWith: q.toUpperCase() } },
                { user: { name: { contains: q, mode: 'insensitive' } } },
                { user: { email: { contains: q, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: PAGE_SIZE + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        code: true,
        status: true,
        fulfillmentType: true,
        currency: true,
        totalMinor: true,
        createdAt: true,
        user: { select: { name: true } },
        payment: { select: { status: true, method: true, amountRefundedMinor: true } },
      },
    });
    const page = rows.slice(0, PAGE_SIZE);
    return {
      orders: page.map((row) => ({
        id: row.id,
        code: row.code,
        status: row.status,
        fulfillmentType: row.fulfillmentType,
        currency: row.currency,
        totalMinor: row.totalMinor,
        createdAt: row.createdAt.toISOString(),
        customerName: row.user.name,
        payment: {
          status: row.payment?.status ?? 'REQUIRES_PAYMENT',
          method: row.payment?.method ?? 'DEMO_CARD',
          amountRefundedMinor: row.payment?.amountRefundedMinor ?? 0,
        },
      })),
      nextCursor: rows.length > PAGE_SIZE ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async order(orderId: string): Promise<AdminOrderDetail> {
    const row = await this.#db.order.findUnique({
      where: { id: orderId },
      include: { ...orderInclude, user: { select: { id: true, name: true, email: true } } },
    });
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Order not found');
    const payment = await this.#payments.adminView(orderId);
    return {
      order: toOrder(row, { now: this.#clock.now(), demoCardEnabled: this.#demoPaymentsEnabled }),
      version: row.version,
      customer: { id: row.user.id, name: row.user.name, email: row.user.email },
      payment,
      canCancel: canTransitionOrder(row.status, 'CANCELLED', 'ADMIN', row.fulfillmentType),
    };
  }
}
