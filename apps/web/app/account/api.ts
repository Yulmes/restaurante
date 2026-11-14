import { apiErrorBodySchema, csrfResponseSchema, type ApiErrorCode } from '@marea-baja/shared';
import type { z } from 'zod';

/**
 * Cliente de la API para la web (§4.2: mutaciones contra la API, mismo origen).
 * - Envía `X-CSRF-Token` en todo método que modifica datos (§8.3). Si la API responde
 *   `CSRF_FAILED` (token viejo tras rotar la sesión), pide uno nuevo y reintenta una vez.
 * - Las respuestas se validan con los esquemas de `shared` (contrato, §11).
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly fields: Record<string, string>;
  readonly retryAfterSeconds: number | undefined;
  readonly challengeRequired: boolean;

  constructor(status: number, body: z.infer<typeof apiErrorBodySchema>['error']) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
    this.fields = body.fields ?? {};
    this.retryAfterSeconds = body.retryAfterSeconds;
    this.challengeRequired = body.challengeRequired ?? false;
  }
}

/** Sin conexión o respuesta ilegible. */
export class NetworkError extends Error {
  constructor() {
    super('network');
    this.name = 'NetworkError';
  }
}

let csrfToken: string | null = null;

/** Las respuestas que crean o rotan la sesión traen su token CSRF nuevo. */
export function rememberCsrfToken(token: string | null): void {
  csrfToken = token;
}

async function request(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(path, { credentials: 'same-origin', ...init });
  } catch {
    throw new NetworkError();
  }
}

async function readError(response: Response): Promise<never> {
  const parsed = apiErrorBodySchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new NetworkError();
  throw new ApiError(response.status, parsed.data.error);
}

async function ensureCsrf(): Promise<string> {
  if (csrfToken) return csrfToken;
  const response = await request('/api/auth/csrf', { method: 'GET' });
  if (!response.ok) await readError(response);
  const token = csrfResponseSchema.parse(await response.json()).csrfToken;
  csrfToken = token;
  return token;
}

export async function apiGet<S extends z.ZodType>(path: string, schema: S): Promise<z.output<S>> {
  const response = await request(path, { method: 'GET', headers: { accept: 'application/json' } });
  if (!response.ok) await readError(response);
  return schema.parse(await response.json());
}

export async function apiSend<S extends z.ZodType>(
  method: 'POST' | 'PATCH',
  path: string,
  body: unknown,
  schema?: S,
): Promise<z.output<S> | undefined> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await request(path, {
      method,
      headers: { 'content-type': 'application/json', 'x-csrf-token': await ensureCsrf() },
      body: JSON.stringify(body ?? {}),
    });
    if (response.ok) {
      if (response.status === 204 || !schema) return undefined;
      return schema.parse(await response.json());
    }
    const parsed = apiErrorBodySchema.safeParse(
      await response
        .clone()
        .json()
        .catch(() => null),
    );
    if (attempt === 0 && parsed.success && parsed.data.error.code === 'CSRF_FAILED') {
      csrfToken = null;
      continue;
    }
    await readError(response);
  }
  throw new NetworkError();
}
