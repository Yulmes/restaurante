import { describe, expect, it } from 'vitest';
import { EnvValidationError, loadEnv } from './env.ts';

const LOCAL_URL = 'postgresql://marea:marea_dev_local@localhost:5432/marea_baja';
const SECRET = 'x'.repeat(32);
/** Mínimo válido en desarrollo. */
const BASE = {
  DATABASE_URL: LOCAL_URL,
  PUBLIC_WEB_URL: 'http://127.0.0.1:5173',
  APP_SECRET: SECRET,
  EMAIL_FROM: 'Marea Baja <no-reply@marea-baja.test>',
};
/** Mínimo válido en producción. */
const PROD = {
  ...BASE,
  NODE_ENV: 'production',
  DATABASE_URL: `${LOCAL_URL}?sslmode=require`,
  PUBLIC_WEB_URL: 'https://marea-baja.example',
  EMAIL_PROVIDER: 'resend',
  RESEND_API_KEY: 're_test',
  BOT_CHECK_PROVIDER: 'turnstile',
  TURNSTILE_SECRET_KEY: 'secret',
};

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
  it('acepta una configuración local válida y aplica los valores por defecto', () => {
    expect(loadEnv(BASE)).toEqual({
      ...BASE,
      NODE_ENV: 'development',
      API_PORT: 3000,
      EMAIL_PROVIDER: 'mailpit',
      MAILPIT_URL: 'http://127.0.0.1:8025',
      BOT_CHECK_PROVIDER: 'fake',
      TURNSTILE_GLOBAL_THRESHOLD: 50,
      TURNSTILE_WINDOW_MINUTES: 60,
    });
  });

  it('acepta el esquema postgres:// además de postgresql://', () => {
    expect(loadEnv({ ...BASE, DATABASE_URL: 'postgres://u:p@db:5432/x' }).DATABASE_URL).toBe(
      'postgres://u:p@db:5432/x',
    );
  });

  it('informa cada variable obligatoria que falta', () => {
    expect(problemsOf({})).toEqual([
      'DATABASE_URL: es obligatoria y falta',
      'PUBLIC_WEB_URL: es obligatoria y falta',
      'APP_SECRET: es obligatoria y falta',
      'EMAIL_FROM: es obligatoria y falta',
    ]);
  });

  it('rechaza URLs que no son de PostgreSQL', () => {
    const problems = problemsOf({ ...BASE, DATABASE_URL: 'mysql://u:p@localhost/x' });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^DATABASE_URL: /);
  });

  it('rechaza un NODE_ENV desconocido', () => {
    const problems = problemsOf({ ...BASE, NODE_ENV: 'staging' });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^NODE_ENV: /);
  });

  it('exige un APP_SECRET de al menos 32 caracteres', () => {
    expect(problemsOf({ ...BASE, APP_SECRET: 'corto' })).toEqual([
      'APP_SECRET: debe tener al menos 32 caracteres',
    ]);
  });

  it('acepta una configuración de producción completa', () => {
    expect(loadEnv(PROD).NODE_ENV).toBe('production');
  });

  it('en producción exige TLS, https, Resend y Turnstile', () => {
    expect(
      problemsOf({
        ...BASE,
        NODE_ENV: 'production',
      }),
    ).toEqual([
      'DATABASE_URL: en producción debe incluir sslmode=require (o verify-ca / verify-full)',
      'PUBLIC_WEB_URL: en producción debe usar https',
      'EMAIL_PROVIDER: en producción debe ser resend',
      'BOT_CHECK_PROVIDER: en producción debe ser turnstile (D8)',
    ]);
  });

  it('pide la clave de cada proveedor externo elegido', () => {
    expect(problemsOf({ ...BASE, EMAIL_PROVIDER: 'resend', BOT_CHECK_PROVIDER: 'turnstile' })).toEqual([
      'RESEND_API_KEY: es obligatoria con EMAIL_PROVIDER=resend',
      'TURNSTILE_SECRET_KEY: es obligatoria con BOT_CHECK_PROVIDER=turnstile',
    ]);
  });

  it('nunca incluye el valor de una variable en el mensaje de error', () => {
    const secret = 'super-secreto-que-no-debe-aparecer';
    const source = {
      ...BASE,
      NODE_ENV: 'production',
      DATABASE_URL: `postgresql://user:${secret}@host/db`,
      APP_SECRET: secret.slice(0, 10),
    };
    let message = '';
    try {
      loadEnv(source);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toBe('');
    expect(message).not.toContain(secret);
    expect(message).not.toContain(secret.slice(0, 10));
  });
});
