import type { RoleKey } from '@marea-baja/shared';
import type { Request, RequestHandler } from 'express';
import type { AuthContext } from '../http/context.ts';
import { AppError } from '../http/errors.ts';

/**
 * RBAC (§8.7). La protección real está en la API: la web solo oculta lo que no corresponde.
 * La propiedad de cada recurso se comprueba en los servicios y responde 404 (no 403) para no
 * confirmar que el recurso existe (pedidos, desde M5).
 */
export const requireAuth: RequestHandler = (req, _res, next) => {
  next(req.auth ? undefined : new AppError(401, 'UNAUTHENTICATED', 'Authentication required'));
};

/** Pagar exige un correo verificado (D3): `POST /api/orders` y `/authorize` lo usarán en M5 y M6. */
export const requireVerifiedEmail: RequestHandler = (req, _res, next) => {
  if (!req.auth) {
    next(new AppError(401, 'UNAUTHENTICATED', 'Authentication required'));
    return;
  }
  next(req.auth.emailVerified ? undefined : new AppError(403, 'EMAIL_NOT_VERIFIED', 'Email not verified'));
};

export function requireRole(...allowed: readonly RoleKey[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) {
      next(new AppError(401, 'UNAUTHENTICATED', 'Authentication required'));
      return;
    }
    const permitted = req.auth.roles.some((role) => allowed.includes(role));
    next(permitted ? undefined : new AppError(403, 'FORBIDDEN', 'Insufficient role'));
  };
}

/** Para los controladores que ya pasaron por `requireAuth`. */
export function authOf(req: Request): AuthContext {
  if (!req.auth) throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required');
  return req.auth;
}
