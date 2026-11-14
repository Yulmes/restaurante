import type { ApiErrorBody, ApiErrorCode } from '@marea-baja/shared';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { z } from 'zod';

/**
 * Errores de la API (§8.7): `{ error: { code, message, requestId } }` sin trazas.
 * El detalle técnico va solo al log.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly extra: Omit<ApiErrorBody['error'], 'code' | 'message' | 'requestId'>;
  readonly headers: Record<string, string>;

  constructor(
    status: number,
    code: ApiErrorCode,
    message: string,
    extra: AppError['extra'] = {},
    headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.extra = extra;
    this.headers = headers;
  }
}

export function rateLimited(retryAfterSeconds: number, message = 'Too many requests'): AppError {
  const seconds = Math.max(1, Math.ceil(retryAfterSeconds));
  return new AppError(
    429,
    'RATE_LIMITED',
    message,
    { retryAfterSeconds: seconds },
    {
      'Retry-After': String(seconds),
    },
  );
}

/** Valida el cuerpo con un esquema de `shared`; los errores por campo son códigos traducibles. */
export function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  const result = schema.safeParse(body ?? {});
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_';
    fields[key] ??= /^[a-zA-Z]+$/.test(issue.message) ? issue.message : 'invalid';
  }
  throw new AppError(400, 'VALIDATION_FAILED', 'Invalid request body', { fields });
}

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new AppError(404, 'NOT_FOUND', 'Route not found'));
};

export const errorHandler: ErrorRequestHandler = (error: unknown, req, res, _next) => {
  const requestId = req.requestId;
  if (error instanceof AppError) {
    if (error.status >= 500) req.log.error({ err: error }, error.message);
    for (const [name, value] of Object.entries(error.headers)) res.setHeader(name, value);
    const body: ApiErrorBody = {
      error: { code: error.code, message: error.message, requestId, ...error.extra },
    };
    res.status(error.status).json(body);
    return;
  }
  // JSON mal formado o cuerpo demasiado grande (body-parser de Express).
  if (isHttpError(error) && error.status < 500) {
    const body: ApiErrorBody = {
      error: { code: 'VALIDATION_FAILED', message: 'Malformed request', requestId },
    };
    res.status(error.status).json(body);
    return;
  }
  req.log.error({ err: error }, 'Unhandled error');
  const body: ApiErrorBody = {
    error: { code: 'INTERNAL_ERROR', message: 'Internal error', requestId },
  };
  res.status(500).json(body);
};

function isHttpError(error: unknown): error is { status: number } {
  return typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number';
}
