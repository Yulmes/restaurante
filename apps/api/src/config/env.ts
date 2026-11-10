import { z } from 'zod';

/**
 * Variables de entorno de la API, validadas al arrancar (§8.7 de la propuesta).
 * Si falta una o es inválida, la API no arranca. Los mensajes de error nombran la
 * variable y el problema, pero nunca muestran su valor, porque puede ser un secreto.
 *
 * M0 solo define lo que ya existe: el entorno y la base de datos. Cada hito agrega
 * sus variables aquí y en ENVIRONMENT_VARIABLES.md.
 */
const postgresUrl = z
  .url({ protocol: /^postgres(ql)?$/, error: 'debe ser una URL postgres:// o postgresql://' })
  .describe('Cadena de conexión a PostgreSQL');

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: postgresUrl,
  })
  .superRefine((env, ctx) => {
    // Neon exige TLS; en producción no se acepta una conexión sin cifrar.
    if (
      env.NODE_ENV === 'production' &&
      !/[?&]sslmode=(require|verify-ca|verify-full)\b/.test(env.DATABASE_URL)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'en producción debe incluir sslmode=require (o verify-ca / verify-full)',
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
