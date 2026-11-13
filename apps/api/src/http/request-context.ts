import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import type { Logger } from 'pino';
import './context.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * `requestId` (§8.7): se respeta el que llega del Worker si es un UUID válido y se devuelve en
 * `X-Request-Id`. Cada petición tiene un logger hijo con ese id y un registro al terminar, sin
 * cuerpo ni query string.
 */
export function requestContext(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const incoming = req.get('x-request-id');
    req.requestId = incoming && UUID.test(incoming) ? incoming : randomUUID();
    req.log = logger.child({ requestId: req.requestId });
    req.clientIp = req.socket.remoteAddress ?? 'unknown';
    req.cookieJar = parseCookies(req.get('cookie'));
    res.setHeader('X-Request-Id', req.requestId);
    const started = performance.now();
    res.on('finish', () => {
      req.log.info(
        {
          method: req.method,
          path: req.path,
          status: res.statusCode,
          ms: Math.round(performance.now() - started),
        },
        'request',
      );
    });
    next();
  };
}

/** Lector mínimo de la cabecera `Cookie` (solo se usan cookies propias con valores base64url). */
export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name && !(name in cookies)) {
      try {
        cookies[name] = decodeURIComponent(value);
      } catch {
        // Valor mal codificado: se ignora la cookie.
      }
    }
  }
  return cookies;
}
