import { dictionary } from '@zxcvbn-ts/language-common';
import { describe, expect, it } from 'vitest';
import { HOUR, MINUTE } from '../../lib/clock.ts';
import { COMMON_PASSWORD_COUNT, hashPassword, isCommonPassword, verifyPassword } from './passwords.ts';
import { AUTH_LIMITS, lockDurationMs, loginDelayMs } from './policies.ts';
import { policyFor } from './sessions.ts';

describe('contraseñas (§8.7, R-SEC-01)', () => {
  it('usa Argon2id con los parámetros de OWASP', async () => {
    const hash = await hashPassword('una frase larga de prueba');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await verifyPassword(hash, 'una frase larga de prueba')).toBe(true);
    expect(await verifyPassword(hash, 'otra frase larga de prueba')).toBe(false);
  });

  it('un hash inválido nunca verifica', async () => {
    expect(await verifyPassword('no-es-un-hash', 'lo que sea')).toBe(false);
  });

  it('rechaza las 10.000 contraseñas más comunes sin distinguir mayúsculas', () => {
    expect(COMMON_PASSWORD_COUNT).toBeGreaterThan(9_900);
    const list = dictionary['passwords-common'] as readonly string[];
    const longCommon = list.slice(0, 10_000).find((p) => p.length >= 12);
    expect(longCommon).toBeDefined();
    expect(isCommonPassword(longCommon ?? '')).toBe(true);
    expect(isCommonPassword((longCommon ?? '').toUpperCase())).toBe(true);
    expect(isCommonPassword('marea baja en barrio escalante')).toBe(false);
  });
});

describe('políticas de login (§8.4)', () => {
  it('sin demora hasta el 3.er fallo; 2ⁿ s desde el 4.º, con máximo 60 s', () => {
    expect([1, 2, 3].map(loginDelayMs)).toEqual([0, 0, 0]);
    expect([4, 5, 6, 7, 8, 9].map(loginDelayMs)).toEqual([2000, 4000, 8000, 16000, 32000, 60000]);
  });

  it('el bloqueo escala 15 min → 1 h → 4 h y no pasa de 4 h', () => {
    expect([1, 2, 3, 4, 9].map(lockDurationMs)).toEqual([15 * MINUTE, HOUR, 4 * HOUR, 4 * HOUR, 4 * HOUR]);
    expect(AUTH_LIMITS.login.lockAfterFailures).toBe(10);
  });

  it('staff y admin tienen sesiones más cortas que los clientes (§8.2)', () => {
    expect(policyFor(['CUSTOMER'])).toEqual({ idleMs: 7 * 24 * HOUR, absoluteMs: 30 * 24 * HOUR });
    expect(policyFor(['CUSTOMER', 'STAFF'])).toEqual({ idleMs: 2 * HOUR, absoluteMs: 12 * HOUR });
    expect(policyFor(['ADMIN'])).toEqual({ idleMs: 2 * HOUR, absoluteMs: 12 * HOUR });
  });
});
