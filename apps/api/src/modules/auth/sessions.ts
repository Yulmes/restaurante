import type { RoleKey } from '@marea-baja/shared';
import type { Prisma } from '../../generated/prisma/client.ts';
import { DAY, HOUR } from '../../lib/clock.ts';
import { hmac, randomToken, sha256 } from '../../lib/crypto.ts';

/**
 * Sesiones con token opaco (§8.2). En la base solo se guarda `SHA-256(token)`.
 * - Clientes: 7 días de inactividad y 30 días absolutos.
 * - Staff y admin: 2 h de inactividad y 12 h absolutas.
 * - Rotación: al iniciar sesión (sesión nueva), al verificar el correo, al cambiar la contraseña
 *   o el rol, y cada 24 h de uso. El token anterior deja de valer en el acto.
 */
export const SESSION_POLICY = {
  customer: { idleMs: 7 * DAY, absoluteMs: 30 * DAY },
  staff: { idleMs: 2 * HOUR, absoluteMs: 12 * HOUR },
  rotateEveryMs: DAY,
  /** `lastSeenAt` se actualiza como mucho una vez por minuto para no escribir en cada petición. */
  touchEveryMs: 60_000,
} as const;

/** Marca de "rotar en la próxima petición" (cambio de rol, §8.2): una fecha muy antigua. */
export const FORCE_ROTATION_AT = new Date(0);

type Db = Prisma.TransactionClient;

export function policyFor(roles: readonly RoleKey[]): { idleMs: number; absoluteMs: number } {
  return roles.includes('STAFF') || roles.includes('ADMIN') ? SESSION_POLICY.staff : SESSION_POLICY.customer;
}

/** Token CSRF de una sesión (§8.3): derivado de su secreto, estable durante toda la sesión. */
export function sessionCsrfToken(csrfSecret: string, sessionId: string): string {
  return hmac(csrfSecret, `session:${sessionId}`);
}

export interface NewSession {
  token: string;
  sessionId: string;
  csrfSecret: string;
  absoluteExpiresAt: Date;
}

export async function createSession(
  db: Db,
  input: {
    userId: string;
    roles: readonly RoleKey[];
    ipHash: string;
    userAgent: string | undefined;
    now: Date;
  },
): Promise<NewSession> {
  const token = randomToken();
  const csrfSecret = randomToken();
  const policy = policyFor(input.roles);
  const absoluteExpiresAt = new Date(input.now.getTime() + policy.absoluteMs);
  const session = await db.session.create({
    data: {
      userId: input.userId,
      tokenHash: sha256(token),
      csrfSecret,
      createdAt: input.now,
      lastSeenAt: input.now,
      idleExpiresAt: new Date(input.now.getTime() + policy.idleMs),
      absoluteExpiresAt,
      ipHash: input.ipHash,
      userAgent: input.userAgent?.slice(0, 300) ?? null,
    },
    select: { id: true },
  });
  return { token, sessionId: session.id, csrfSecret, absoluteExpiresAt };
}

/**
 * Cambia el token de la sesión (misma fila, mismo secreto CSRF) y recalcula los vencimientos con
 * la política de los roles actuales. El vencimiento absoluto nunca se alarga.
 */
export async function rotateSession(
  db: Db,
  input: {
    sessionId: string;
    createdAt: Date;
    absoluteExpiresAt: Date;
    roles: readonly RoleKey[];
    now: Date;
  },
): Promise<{ token: string; absoluteExpiresAt: Date }> {
  const token = randomToken();
  const policy = policyFor(input.roles);
  const absoluteExpiresAt = new Date(
    Math.min(input.absoluteExpiresAt.getTime(), input.createdAt.getTime() + policy.absoluteMs),
  );
  const idleExpiresAt = new Date(Math.min(input.now.getTime() + policy.idleMs, absoluteExpiresAt.getTime()));
  await db.session.update({
    where: { id: input.sessionId },
    data: {
      tokenHash: sha256(token),
      rotatedAt: input.now,
      lastSeenAt: input.now,
      idleExpiresAt,
      absoluteExpiresAt,
    },
  });
  return { token, absoluteExpiresAt };
}

export async function revokeSession(db: Db, sessionId: string, now: Date): Promise<void> {
  await db.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: now } });
}

/** Revoca todas las sesiones activas del usuario, salvo `exceptSessionId` si se indica. */
export async function revokeAllSessions(
  db: Db,
  userId: string,
  now: Date,
  exceptSessionId?: string,
): Promise<number> {
  const result = await db.session.updateMany({
    where: {
      userId,
      revokedAt: null,
      ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
    },
    data: { revokedAt: now },
  });
  return result.count;
}
