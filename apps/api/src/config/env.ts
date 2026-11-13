import { z } from 'zod';

/**
 * Variables de entorno de la API, validadas al arrancar (§8.7 de la propuesta).
 * Si falta una o es inválida, la API no arranca. Los mensajes de error nombran la
 * variable y el problema, pero nunca muestran su valor, porque puede ser un secreto.
 *
 * Cada hito agrega sus variables aquí y en ENVIRONMENT_VARIABLES.md.
 */
const postgresUrl = z
  .url({ protocol: /^postgres(ql)?$/, error: 'debe ser una URL postgres:// o postgresql://' })
  .describe('Cadena de conexión a PostgreSQL');

const httpUrl = z.url({ protocol: /^https?$/, error: 'debe ser una URL http:// o https://' });

const positiveInt = (fallback: number) => z.coerce.number().int().positive().default(fallback);

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: postgresUrl,

    // ─── M3 · Servidor HTTP ───────────────────────────────────────────────────
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
    /** Origen de la web: se exige en `Origin` (CSRF, §8.3) y se usa en los enlaces de los correos. */
    PUBLIC_WEB_URL: httpUrl,
    /** Clave para los tokens CSRF de invitados y el hash de las IP. Secreto. */
    APP_SECRET: z.string().min(32, { error: 'debe tener al menos 32 caracteres' }),

    // ─── M3 · Correo (§8.5, D6) ───────────────────────────────────────────────
    EMAIL_PROVIDER: z.enum(['mailpit', 'resend', 'memory']).default('mailpit'),
    EMAIL_FROM: z.string().min(3),
    MAILPIT_URL: httpUrl.default('http://127.0.0.1:8025'),
    RESEND_API_KEY: z.string().min(1).optional(),

    // ─── M3 · Turnstile condicional (D8, §8.4) ────────────────────────────────
    BOT_CHECK_PROVIDER: z.enum(['turnstile', 'fake']).default('fake'),
    TURNSTILE_SECRET_KEY: z.string().min(1).optional(),
    /** Valores por defecto si `RestaurantSettings` no existe; el admin los ajusta en M8. */
    TURNSTILE_GLOBAL_THRESHOLD: positiveInt(50),
    TURNSTILE_WINDOW_MINUTES: positiveInt(60),
  })
  .superRefine((env, ctx) => {
    const production = env.NODE_ENV === 'production';
    // Neon exige TLS; en producción no se acepta una conexión sin cifrar.
    if (production && !/[?&]sslmode=(require|verify-ca|verify-full)\b/.test(env.DATABASE_URL)) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'en producción debe incluir sslmode=require (o verify-ca / verify-full)',
      });
    }
    if (production && !env.PUBLIC_WEB_URL.startsWith('https://')) {
      ctx.addIssue({ code: 'custom', path: ['PUBLIC_WEB_URL'], message: 'en producción debe usar https' });
    }
    if (env.EMAIL_PROVIDER === 'resend' && !env.RESEND_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['RESEND_API_KEY'],
        message: 'es obligatoria con EMAIL_PROVIDER=resend',
      });
    }
    if (production && env.EMAIL_PROVIDER !== 'resend') {
      ctx.addIssue({ code: 'custom', path: ['EMAIL_PROVIDER'], message: 'en producción debe ser resend' });
    }
    if (env.BOT_CHECK_PROVIDER === 'turnstile' && !env.TURNSTILE_SECRET_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['TURNSTILE_SECRET_KEY'],
        message: 'es obligatoria con BOT_CHECK_PROVIDER=turnstile',
      });
    }
    if (production && env.BOT_CHECK_PROVIDER !== 'turnstile') {
      ctx.addIssue({
        code: 'custom',
        path: ['BOT_CHECK_PROVIDER'],
        message: 'en producción debe ser turnstile (D8)',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`Variables de entorno inválidas:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'EnvValidationError';
    this.problems = problems;
  }
}

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (result.success) {
    return result.data;
  }
  const problems = result.error.issues.map((issue) => {
    const name = issue.path.join('.') || '(raíz)';
    const message =
      issue.code === 'invalid_type' && issue.input === undefined ? 'es obligatoria y falta' : issue.message;
    return `${name}: ${message}`;
  });
  throw new EnvValidationError(problems);
}
