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
  ORIGIN_SECRETS: 'o'.repeat(32),
  TASKS_SECRETS: 't'.repeat(32),
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
      ORDERS_ALLOW_OUTSIDE_HOURS: false,
      DEMO_PAYMENTS_ENABLED: false,
      EMAIL_DELIVERABLE_TO: [],
      ORDER_CONFIRMATION_TIMEOUT_MINUTES: 20,
      ORIGIN_SECRETS: [],
      TASKS_SECRETS: [],
      DEMO_EMAIL_VERIFICATION_ENABLED: false,
    });
  });

  it('M5 (D-M5-3): los pedidos fuera de horario están bloqueados salvo ORDERS_ALLOW_OUTSIDE_HOURS=true', () => {
    expect(loadEnv(BASE).ORDERS_ALLOW_OUTSIDE_HOURS).toBe(false);
    expect(loadEnv({ ...BASE, ORDERS_ALLOW_OUTSIDE_HOURS: 'true' }).ORDERS_ALLOW_OUTSIDE_HOURS).toBe(true);
    expect(loadEnv({ ...BASE, ORDERS_ALLOW_OUTSIDE_HOURS: 'false' }).ORDERS_ALLOW_OUTSIDE_HOURS).toBe(false);
    expect(problemsOf({ ...BASE, ORDERS_ALLOW_OUTSIDE_HOURS: 'yes' })).toEqual([
      'ORDERS_ALLOW_OUTSIDE_HOURS: debe ser true o false',
    ]);
  });

  it('M6 (§7.4): la tarjeta demo está apagada salvo DEMO_PAYMENTS_ENABLED=true', () => {
    expect(loadEnv(BASE).DEMO_PAYMENTS_ENABLED).toBe(false);
    expect(loadEnv({ ...BASE, DEMO_PAYMENTS_ENABLED: 'true' }).DEMO_PAYMENTS_ENABLED).toBe(true);
    expect(problemsOf({ ...BASE, DEMO_PAYMENTS_ENABLED: '1' })).toEqual([
      'DEMO_PAYMENTS_ENABLED: debe ser true o false',
    ]);
  });

  it('M7 (§7.1): el plazo de confirmación es 20 min por defecto, configurable entre 1 y 1440', () => {
    expect(
      loadEnv({ ...BASE, ORDER_CONFIRMATION_TIMEOUT_MINUTES: '5' }).ORDER_CONFIRMATION_TIMEOUT_MINUTES,
    ).toBe(5);
    expect(problemsOf({ ...BASE, ORDER_CONFIRMATION_TIMEOUT_MINUTES: '0' })).toHaveLength(1);
    expect(problemsOf({ ...BASE, ORDER_CONFIRMATION_TIMEOUT_MINUTES: 'veinte' })).toHaveLength(1);
  });

  it('M7 (§8.5): EMAIL_DELIVERABLE_TO es una lista de correos y EMAIL_PROVIDER acepta demo', () => {
    expect(
      loadEnv({ ...BASE, EMAIL_DELIVERABLE_TO: ' Dueno@Example.com , otra@example.com ' })
        .EMAIL_DELIVERABLE_TO,
    ).toEqual(['dueno@example.com', 'otra@example.com']);
    expect(problemsOf({ ...BASE, EMAIL_DELIVERABLE_TO: 'no-es-un-correo' })).toHaveLength(1);
    expect(loadEnv({ ...BASE, EMAIL_PROVIDER: 'demo' }).EMAIL_PROVIDER).toBe('demo');
    // En producción el proveedor sigue siendo Resend (D6); `demo` no se acepta.
    expect(problemsOf({ ...BASE, NODE_ENV: 'production', EMAIL_PROVIDER: 'demo' })).toContain(
      'EMAIL_PROVIDER: en producción debe ser resend',
    );
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
      'ORIGIN_SECRETS: es obligatoria en producción',
      'TASKS_SECRETS: es obligatoria en producción',
      'BOT_CHECK_PROVIDER: en producción debe ser turnstile (D8)',
    ]);
  });

  it('M10 (ADR 0010): secretos de origen y de tareas, uno o dos, de 32+ caracteres y distintos', () => {
    const env = loadEnv({
      ...BASE,
      ORIGIN_SECRETS: ` ${'a'.repeat(32)} , ${'b'.repeat(40)} `,
      TASKS_SECRETS: 'c'.repeat(32),
    });
    expect(env.ORIGIN_SECRETS).toEqual(['a'.repeat(32), 'b'.repeat(40)]);
    expect(env.TASKS_SECRETS).toEqual(['c'.repeat(32)]);
    // En desarrollo pueden faltar: las funciones quedan apagadas.
    expect(loadEnv(BASE).ORIGIN_SECRETS).toEqual([]);
    expect(loadEnv(BASE).TASKS_SECRETS).toEqual([]);
    expect(problemsOf({ ...BASE, ORIGIN_SECRETS: 'corto' })).toEqual([
      'ORIGIN_SECRETS.0: cada secreto debe tener al menos 32 caracteres',
    ]);
    expect(
      problemsOf({ ...BASE, TASKS_SECRETS: ['d'.repeat(32), 'e'.repeat(32), 'f'.repeat(32)].join(',') }),
    ).toEqual(['TASKS_SECRETS: admite como máximo dos secretos (el actual y el siguiente)']);
    expect(problemsOf({ ...BASE, ORIGIN_SECRETS: 'g'.repeat(32), TASKS_SECRETS: 'g'.repeat(32) })).toEqual([
      'TASKS_SECRETS: no puede repetir un secreto de ORIGIN_SECRETS',
    ]);
  });

  it('M10 (D-M10-P1): la verificación demo está apagada salvo DEMO_EMAIL_VERIFICATION_ENABLED=true', () => {
    expect(loadEnv(BASE).DEMO_EMAIL_VERIFICATION_ENABLED).toBe(false);
    expect(
      loadEnv({ ...BASE, DEMO_EMAIL_VERIFICATION_ENABLED: 'true' }).DEMO_EMAIL_VERIFICATION_ENABLED,
    ).toBe(true);
    expect(problemsOf({ ...BASE, DEMO_EMAIL_VERIFICATION_ENABLED: 'si' })).toEqual([
      'DEMO_EMAIL_VERIFICATION_ENABLED: debe ser true o false',
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
