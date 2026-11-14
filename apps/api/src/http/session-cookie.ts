import type { Response } from 'express';
import { cookieNames, type AppConfig } from '../config/app-config.ts';

/** Cookie de sesión (§8.2): HttpOnly, SameSite=Lax, Path=/; Secure en producción. */
export function setSessionCookie(res: Response, config: AppConfig, token: string, expires: Date): void {
  res.cookie(cookieNames(config).session, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.production,
    path: '/',
    expires,
  });
}

export function clearSessionCookie(res: Response, config: AppConfig): void {
  res.clearCookie(cookieNames(config).session, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.production,
    path: '/',
  });
}

/** Cookie previa a la sesión para el CSRF de invitados (registro, login), §8.3. */
export function setGuestCsrfCookie(res: Response, config: AppConfig, value: string): void {
  res.cookie(cookieNames(config).guestCsrf, value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.production,
    path: '/',
  });
}
