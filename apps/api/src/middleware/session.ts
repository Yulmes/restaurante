import type { RoleKey } from '@marea-baja/shared';
import type { RequestHandler } from 'express';
import { cookieNames, type AppConfig } from '../config/app-config.ts';
import type { PrismaClient } from '../generated/prisma/client.ts';
import { clearSessionCookie, setSessionCookie } from '../http/session-cookie.ts';
import type { Clock } from '../lib/clock.ts';
import { sha256 } from '../lib/crypto.ts';
import { SESSION_POLICY, policyFor, rotateSession } from '../modules/auth/sessions.ts';

/**
 * Carga la sesión de la cookie (§8.2). Una sesión revocada, vencida (por inactividad o absoluta)
 * o de un usuario bloqueado no cuenta: la petición sigue como invitado y la cookie se borra.
 * Rota el token cada 24 h de uso o si se pidió rotar (cambio de rol).
 */
export function loadSession(deps: { db: PrismaClient; clock: Clock; config: AppConfig }): RequestHandler {
  const cookieName = cookieNames(deps.config).session;
  return async (req, res, next) => {
    const token = req.cookieJar[cookieName];
    if (!token) {
      next();
      return;
    }
    const now = deps.clock.now();
    const session = await deps.db.session.findUnique({
      where: { tokenHash: sha256(token) },
      include: {
        user: {
          select: {
            emailVerifiedAt: true,
            blockedAt: true,
            roles: { select: { role: { select: { key: true } } } },
          },
        },
      },
    });
    const valid =
      session !== null &&
      session.revokedAt === null &&
      session.idleExpiresAt > now &&
      session.absoluteExpiresAt > now &&
      session.user.blockedAt === null;
    if (!valid) {
      clearSessionCookie(res, deps.config);
      next();
      return;
    }

    const roles: RoleKey[] = session.user.roles.map((r) => r.role.key);
    const lastRotation = session.rotatedAt ?? session.createdAt;
    if (now.getTime() - lastRotation.getTime() >= SESSION_POLICY.rotateEveryMs) {
      const rotated = await rotateSession(deps.db, {
        sessionId: session.id,
        createdAt: session.createdAt,
        absoluteExpiresAt: session.absoluteExpiresAt,
        roles,
        now,
      });
      setSessionCookie(res, deps.config, rotated.token, rotated.absoluteExpiresAt);
    } else if (now.getTime() - session.lastSeenAt.getTime() >= SESSION_POLICY.touchEveryMs) {
      const idle = Math.min(now.getTime() + policyFor(roles).idleMs, session.absoluteExpiresAt.getTime());
      await deps.db.session.update({
        where: { id: session.id },
        data: { lastSeenAt: now, idleExpiresAt: new Date(idle) },
      });
    }

    req.auth = {
      sessionId: session.id,
      userId: session.userId,
      csrfSecret: session.csrfSecret,
      roles,
      emailVerified: session.user.emailVerifiedAt !== null,
    };
    next();
  };
}
