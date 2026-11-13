import { pino, type DestinationStream, type Logger } from 'pino';

/**
 * Logs estructurados con Pino (§8.7). La redacción impide que cookies, tokens, contraseñas y
 * secretos lleguen a la salida; los correos se enmascaran. `logger.test.ts` lo verifica.
 */
export const REDACTED_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["x-csrf-token"]',
  'req.headers["x-origin-auth"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.currentPassword',
  '*.newPassword',
  '*.passwordHash',
  '*.token',
  '*.tokenHash',
  '*.turnstileToken',
  '*.csrfToken',
  '*.csrfSecret',
  '*.secret',
] as const;

/** `ana@dominio.cr` → `a***@dominio.cr`. También se usa en el AuditLog (§8.6). */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}

export interface LoggerOptions {
  level: string;
  pretty?: boolean;
}

export function createLogger(options: LoggerOptions, destination?: DestinationStream): Logger {
  return pino(
    {
      level: options.level,
      redact: { paths: [...REDACTED_PATHS], censor: '[redactado]' },
      formatters: {
        log(object) {
          // Los correos se enmascaran en cualquier campo `email` del primer nivel.
          if (typeof object['email'] === 'string') return { ...object, email: maskEmail(object['email']) };
          return object;
        },
      },
      ...(options.pretty && !destination ? { transport: { target: 'pino-pretty' } } : {}),
    },
    destination,
  );
}
