import { describe, expect, it } from 'vitest';
import { EnvValidationError, loadEnv } from './env.ts';

const LOCAL_URL = 'postgresql://marea:marea_dev_local@localhost:5432/marea_baja';

function problemsOf(source: Record<string, string | undefined>): readonly string[] {
  try {
    loadEnv(source);
  } catch (error) {
    if (error instanceof EnvValidationError) return error.problems;
    throw error;
  }
  throw new Error('se esperaba un EnvValidationError');
}

describe('loadEnv', () => {
  it('acepta una configuración local válida y usa development por defecto', () => {
    expect(loadEnv({ DATABASE_URL: LOCAL_URL })).toEqual({
      NODE_ENV: 'development',
      DATABASE_URL: LOCAL_URL,
    });
  });

  it('acepta el esquema postgres:// además de postgresql://', () => {
    expect(loadEnv({ DATABASE_URL: 'postgres://u:p@db:5432/x' }).DATABASE_URL).toBe(
      'postgres://u:p@db:5432/x',
    );
  });

  it('informa que DATABASE_URL falta', () => {
    expect(problemsOf({})).toEqual(['DATABASE_URL: es obligatoria y falta']);
  });

  it('rechaza URLs que no son de PostgreSQL', () => {
    const problems = problemsOf({ DATABASE_URL: 'mysql://u:p@localhost/x' });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^DATABASE_URL: /);
  });

  it('rechaza un NODE_ENV desconocido', () => {
    const problems = problemsOf({ NODE_ENV: 'staging', DATABASE_URL: LOCAL_URL });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^NODE_ENV: /);
  });

  it('en producción exige TLS en la conexión a la base', () => {
    expect(problemsOf({ NODE_ENV: 'production', DATABASE_URL: LOCAL_URL })).toEqual([
      'DATABASE_URL: en producción debe incluir sslmode=require (o verify-ca / verify-full)',
    ]);
    expect(loadEnv({ NODE_ENV: 'production', DATABASE_URL: `${LOCAL_URL}?sslmode=require` }).NODE_ENV).toBe(
      'production',
    );
  });

  it('nunca incluye el valor de una variable en el mensaje de error', () => {
    const secret = 'super-secreto-que-no-debe-aparecer';
    const source = { NODE_ENV: 'production', DATABASE_URL: `postgresql://user:${secret}@host/db` };
    let message = '';
    try {
      loadEnv(source);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toBe('');
    expect(message).not.toContain(secret);
  });
});
