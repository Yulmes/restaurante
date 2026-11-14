import { z } from 'zod';

/**
 * Códigos de error de la API (§4.5, §8.7). La API devuelve
 * `{ error: { code, message, requestId, fields?, retryAfterSeconds?, challengeRequired? } }`;
 * la web traduce `code`. `message` es una ayuda en inglés para depurar, nunca se muestra.
 */
export const API_ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CSRF_FAILED',
  'RATE_LIMITED',
  'INVALID_CREDENTIALS',
  'CHALLENGE_REQUIRED',
  'CHALLENGE_FAILED',
  'ACCOUNT_BLOCKED',
  'EMAIL_NOT_VERIFIED',
  'EMAIL_ALREADY_VERIFIED',
  'INVALID_OR_EXPIRED_TOKEN',
  'INTERNAL_ERROR',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export const apiErrorBodySchema = z.object({
  error: z.object({
    code: z.enum(API_ERROR_CODES),
    message: z.string(),
    requestId: z.string(),
    /** Errores por campo: el valor es un código de validación (`required`, `invalidEmail`…). */
    fields: z.record(z.string(), z.string()).optional(),
    retryAfterSeconds: z.number().int().nonnegative().optional(),
    /** D8: el login necesita el desafío de Turnstile. */
    challengeRequired: z.boolean().optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof apiErrorBodySchema>;
