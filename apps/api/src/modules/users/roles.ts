import { ROLE_KEYS, type RoleKey } from '@marea-baja/shared';
import type { PrismaClient } from '../../generated/prisma/client.ts';
import { recordAudit, type AuditActor } from '../audit/audit.ts';
import { FORCE_ROTATION_AT } from '../auth/sessions.ts';

/**
 * Cambio de roles (RBAC, §8.6 "Roles y permisos", §8.2 "rotación al cambiar el rol").
 * En una sola transacción:
 * 1. reemplaza los roles del usuario;
 * 2. marca sus sesiones activas para rotar en la próxima petición, que además aplica la política
 *    de vencimiento del nuevo rol (2 h / 12 h para staff y admin);
 * 3. escribe la entrada del AuditLog.
 * Si cualquier paso falla, no cambia nada.
 *
 * En M3 lo usa el script del propietario (`users:set-role`); la pantalla de clientes del admin
 * llega en M8.
 */
export class UserNotFoundError extends Error {
  constructor() {
    super('No existe un usuario con ese correo.');
    this.name = 'UserNotFoundError';
  }
}

export async function setUserRoles(
  db: PrismaClient,
  input: {
    email: string;
    roles: readonly RoleKey[];
    actor: AuditActor | null;
    reason: string | null;
    requestId?: string | null;
  },
): Promise<{ userId: string; before: RoleKey[]; after: RoleKey[]; changed: boolean }> {
  const after = ROLE_KEYS.filter((role) => input.roles.includes(role));
  if (after.length === 0) throw new Error('Un usuario necesita al menos un rol.');

  return db.$transaction(async (tx) => {
    const user = await tx.user.findFirst({
      where: { email: { equals: input.email.trim(), mode: 'insensitive' } },
      select: { id: true, email: true, roles: { select: { role: { select: { key: true } } } } },
    });
    if (!user) throw new UserNotFoundError();
    const before = ROLE_KEYS.filter((role) => user.roles.some((r) => r.role.key === role));
    if (before.join() === after.join()) return { userId: user.id, before, after, changed: false };

    const roleRows = await tx.role.findMany({ where: { key: { in: after } }, select: { id: true } });
    await tx.userRole.deleteMany({ where: { userId: user.id } });
    await tx.userRole.createMany({
      data: roleRows.map((role) => ({
        userId: user.id,
        roleId: role.id,
        grantedById: input.actor?.userId ?? null,
      })),
    });
    await tx.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { rotatedAt: FORCE_ROTATION_AT },
    });
    await recordAudit(tx, {
      actor: input.actor,
      action: 'user.roles_changed',
      entityType: 'user',
      entityId: user.id,
      before: { email: user.email, roles: before },
      after: { email: user.email, roles: after },
      reason: input.reason,
      requestId: input.requestId ?? null,
    });
    return { userId: user.id, before, after, changed: true };
  });
}
