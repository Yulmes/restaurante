import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { RequestHandler } from 'express';
import { AppError } from '../http/errors.ts';

/**
 * Secreto de origen e IP del cliente (ADR 0010, D-M10-2; §5, R5, R-SEC-09).
 *
 * En producción la API vive detrás del Worker de Cloudflare. El Worker borra lo que el cliente haya
 * mandado como IP o secreto, pone `X-Client-IP` con la IP que le da Cloudflare y agrega
 * `X-Origin-Auth`. Aquí:
 * - sin un secreto válido → 403, para que nadie llame a `*.onrender.com` salteando el Worker;
 * - con secreto válido, la IP del cliente es `X-Client-IP`, solo si es una IPv4 o IPv6 válida
 *   (si no, 400). `X-Forwarded-For` nunca se usa: el cliente puede escribir en él.
 *
 * Sin secretos configurados (desarrollo y pruebas) no hace nada y queda la IP del socket.
 * `/api/health` se monta antes que este middleware y no lo necesita (§9.5).
 */
export function originGuard(secrets: readonly string[]): RequestHandler {
  const digests = secrets.map(digest);
  return (req, _res, next) => {
    if (digests.length === 0) {
      next();
      return;
    }
    if (!matchesAny(req.get('x-origin-auth'), digests)) {
      next(new AppError(403, 'ORIGIN_FORBIDDEN', 'Forbidden'));
      return;
    }
    const ip = normalizeIp(req.get('x-client-ip'));
    if (!ip) {
      next(new AppError(400, 'INVALID_CLIENT_IP', 'Invalid client address'));
      return;
    }
    req.clientIp = ip;
    next();
  };
}

/**
 * Compara contra todos los secretos sin cortar al primer acierto ni depender del largo: los dos
 * lados pasan por SHA-256 y `timingSafeEqual` compara 32 bytes siempre.
 */
export function matchesAny(value: string | undefined, digests: readonly Buffer[]): boolean {
  const candidate = digest(value ?? '');
  let ok = false;
  for (const expected of digests) {
    // La comparación va primero: se evalúa con todos los secretos aunque uno ya haya coincidido.
    ok = timingSafeEqual(candidate, expected) || ok;
  }
  return ok && value !== undefined && value !== '';
}

export function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/** IPv4 o IPv6 válida, en minúsculas; cualquier otra cosa → `null`. */
export function normalizeIp(value: string | undefined): string | null {
  const ip = value?.trim().toLowerCase();
  if (!ip || ip.length > 45 || isIP(ip) === 0) return null;
  return ip;
}
