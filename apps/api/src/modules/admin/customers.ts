import {
  ROLE_KEYS,
  type AdminCustomer,
  type AdminCustomerDetail,
  type AdminCustomersResponse,
  type AdminCustomerUpdateRequest,
  type RoleKey,
} from '@marea-baja/shared';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.ts';
import { AppError } from '../../http/errors.ts';
import type { Clock } from '../../lib/clock.ts';
import { recordAudit, type AuditActor } from '../audit/audit.ts';
import { replaceUserRoles } from '../users/roles.ts';

/**
 * Clientes (M8, §8.6 "roles y permisos, bloqueo de cuentas"):
 * - lista con búsqueda por nombre o correo y detalle con los últimos pedidos;
 * - bloquear (revoca todas sus sesiones al instante) y desbloquear;
 * - cambiar roles (reutiliza el cambio de M3: rotación de sesiones y AuditLog).
 *
 * Reglas para no dejar el local sin administración: nadie se cambia a sí mismo
 * (403 `ADMIN_SELF_CHANGE`) y siempre queda al menos un ADMIN sin bloquear (409 `LAST_ADMIN`).
 * Los cambios de administradores se serializan con un candado de la transacción.
 */
const PAGE_SIZE = 25;
const ADMIN_LOCK = 812_008; // Candado de transacción (pg_advisory_xact_lock) para los cambios de roles.

const customerSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  locale: true,
  emailVerifiedAt: true,
  blockedAt: true,
  createdAt: true,
  roles: { select: { role: { select: { key: true } } } },
  _count: { select: { orders: true } },
} as const satisfies Prisma.UserSelect;
type CustomerRow = Prisma.UserGetPayload<{ select: typeof customerSelect }>;

const rolesOf = (row: { roles: { role: { key: RoleKey } }[] }): RoleKey[] =>
  ROLE_KEYS.filter((role) => row.roles.some((r) => r.role.key === role));

function toCustomer(row: CustomerRow): AdminCustomer {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    roles: rolesOf(row),
    emailVerified: row.emailVerifiedAt !== null,
    blocked: row.blockedAt !== null,
    createdAt: row.createdAt.toISOString(),
    orderCount: row._count.orders,
  };
}

export class CustomersAdminService {
  readonly #db: PrismaClient;
  readonly #clock: Clock;

  constructor(deps: { db: PrismaClient; clock: Clock }) {
    this.#db = deps.db;
    this.#clock = deps.clock;
  }

  async list(query: {
    q?: string | undefined;
    cursor?: string | undefined;
  }): Promise<AdminCustomersResponse> {
    const q = query.q?.trim();
    const rows = await this.#db.user.findMany({
      where: q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { email: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {},
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: PAGE_SIZE + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: customerSelect,
    });
    const page = rows.slice(0, PAGE_SIZE);
    return {
      customers: page.map(toCustomer),
      nextCursor: rows.length > PAGE_SIZE ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async detail(userId: string): Promise<AdminCustomerDetail> {
    const row = await this.#db.user.findUnique({
      where: { id: userId },
      select: {
        ...customerSelect,
        orders: {
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 10,
          select: {
            id: true,
            code: true,
            status: true,
            fulfillmentType: true,
            currency: true,
            totalMinor: true,
            createdAt: true,
            items: { select: { quantity: true } },
            payment: { select: { status: true, method: true } },
          },
        },
      },
    });
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Customer not found');
    return {
      ...toCustomer(row),
      phone: row.phone,
      locale: row.locale === 'en' ? 'en' : 'es-CR',
      blockedAt: row.blockedAt?.toISOString() ?? null,
      recentOrders: row.orders.map((order) => ({
        id: order.id,
        code: order.code,
        status: order.status,
        fulfillmentType: order.fulfillmentType,
        currency: order.currency,
        totalMinor: order.totalMinor,
        itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
        createdAt: order.createdAt.toISOString(),
        payment: {
          status: order.payment?.status ?? 'REQUIRES_PAYMENT',
          method: order.payment?.method ?? 'DEMO_CARD',
        },
      })),
    };
  }

  async update(
    actor: AuditActor,
    userId: string,
    input: AdminCustomerUpdateRequest,
    requestId: string,
  ): Promise<AdminCustomerDetail> {
    if (userId === actor.userId) {
      throw new AppError(403, 'ADMIN_SELF_CHANGE', 'Administrators cannot change their own account here');
    }
    await this.#db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADMIN_LOCK})`;
      const user = await tx.user.findUnique({ where: { id: userId }, select: customerSelect });
      if (!user) throw new AppError(404, 'NOT_FOUND', 'Customer not found');
      const currentRoles = rolesOf(user);
      const nextRoles = input.roles ? ROLE_KEYS.filter((role) => input.roles?.includes(role)) : currentRoles;
      const nextBlocked = input.blocked ?? user.blockedAt !== null;
      const losesAdmin =
        currentRoles.includes('ADMIN') &&
        user.blockedAt === null &&
        (!nextRoles.includes('ADMIN') || nextBlocked);
      if (losesAdmin) {
        const others = await tx.user.count({
          where: { id: { not: userId }, blockedAt: null, roles: { some: { role: { key: 'ADMIN' } } } },
        });
        if (others === 0)
          throw new AppError(409, 'LAST_ADMIN', 'At least one active administrator is required');
      }

      if (input.roles) {
        await replaceUserRoles(tx, { userId, roles: nextRoles, actor, reason: input.reason, requestId });
      }
      if (input.blocked !== undefined && input.blocked !== (user.blockedAt !== null)) {
        const now = this.#clock.now();
        await tx.user.update({ where: { id: userId }, data: { blockedAt: input.blocked ? now : null } });
        // Bloquear corta el acceso ya: las sesiones abiertas se revocan (§8.2).
        if (input.blocked) {
          await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
        }
        await recordAudit(tx, {
          actor,
          action: input.blocked ? 'user.blocked' : 'user.unblocked',
          entityType: 'user',
          entityId: userId,
          before: { email: user.email, blocked: user.blockedAt !== null },
          after: { email: user.email, blocked: input.blocked },
          reason: input.reason,
          requestId,
        });
      }
    });
    return this.detail(userId);
  }
}
