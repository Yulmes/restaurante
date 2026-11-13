import type { RequestHandler, Request } from 'express';
import { cookieNames, type AppConfig } from '../config/app-config.ts';
import { AppError } from '../http/errors.ts';
import { hmac, safeEqual } from '../lib/crypto.ts';
import { sessionCsrfToken } from '../modules/auth/sessions.ts';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Token CSRF de un invitado (§8.3), ligado a su cookie previa a la sesión. */
export function guestCsrfToken(config: AppConfig, cookieValue: string): string {
  return hmac(config.appSecret, `guest:${cookieValue}`);
}

/** El token que corresponde a la petición: el de la sesión o, sin sesión, el del invitado. */
export function expectedCsrfToken(req: Request, config: AppConfig): string | undefined {
  if (req.auth) return sessionCsrfToken(req.auth.csrfSecret, req.auth.sessionId);
  const guest = req.cookieJar[cookieNames(config).guestCsrf];
  return guest ? guestCsrfToken(config, guest) : undefined;
}

/**
 * Defensa en capas (§8.3) para todo método que modifica datos:
 * 1. `SameSite=Lax` en las cookies;
 * 2. `Origin` igual al de la web o, si falta, `Sec-Fetch-Site: same-origin`;
 * 3. token sincronizador en `X-CSRF-Token`.
 * Cualquier fallo → 403 `CSRF_FAILED`.
 */
export function csrfProtection(config: AppConfig): RequestHandler {
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) {
      next();
      return;
    }
    const origin = req.get('origin');
    const sameOrigin = origin ? origin === config.webOrigin : req.get('sec-fetch-site') === 'same-origin';
    if (!sameOrigin) {
      next(new AppError(403, 'CSRF_FAILED', 'Cross-origin request rejected'));
      return;
    }
    const sent = req.get('x-csrf-token');
    const expected = expectedCsrfToken(req, config);
    if (!sent || !expected || !safeEqual(sent, expected)) {
      next(new AppError(403, 'CSRF_FAILED', 'Missing or invalid CSRF token'));
      return;
    }
    next();
  };
}
