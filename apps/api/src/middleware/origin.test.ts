import { describe, expect, it } from 'vitest';
import { digest, matchesAny, normalizeIp } from './origin.ts';

describe('secreto de origen (D-M10-2)', () => {
  const secrets = [
    'secreto-actual-con-al-menos-32-caracteres!!',
    'secreto-siguiente-con-al-menos-32-caracteres',
  ].map(digest);

  it('acepta cualquiera de los dos secretos de la rotación', () => {
    expect(matchesAny('secreto-actual-con-al-menos-32-caracteres!!', secrets)).toBe(true);
    expect(matchesAny('secreto-siguiente-con-al-menos-32-caracteres', secrets)).toBe(true);
  });

  it('rechaza ausente, vacío, prefijos, sufijos y mayúsculas distintas', () => {
    for (const value of [
      undefined,
      '',
      'secreto-actual',
      'secreto-actual-con-al-menos-32-caracteres!!x',
      'SECRETO-ACTUAL-CON-AL-MENOS-32-CARACTERES!!',
    ]) {
      expect(matchesAny(value, secrets), String(value)).toBe(false);
    }
  });

  it('sin secretos configurados nada coincide', () => {
    expect(matchesAny('', [])).toBe(false);
    expect(matchesAny('cualquiera', [])).toBe(false);
  });
});

describe('IP del cliente', () => {
  it('acepta IPv4 e IPv6 y normaliza a minúsculas', () => {
    expect(normalizeIp('203.0.113.7')).toBe('203.0.113.7');
    expect(normalizeIp(' 2001:DB8::1 ')).toBe('2001:db8::1');
    expect(normalizeIp('::ffff:203.0.113.7')).toBe('::ffff:203.0.113.7');
  });

  it('rechaza listas, nombres, puertos y valores inválidos', () => {
    for (const value of [
      undefined,
      '',
      'localhost',
      '203.0.113.7, 198.51.100.1',
      '203.0.113.7:443',
      '256.1.1.1',
      '[2001:db8::1]',
      'x'.repeat(60),
    ]) {
      expect(normalizeIp(value), String(value)).toBeNull();
    }
  });
});
