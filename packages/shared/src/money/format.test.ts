import { describe, expect, it } from 'vitest';
import { formatMoney } from './format.ts';

// Intl separa los miles con U+00A0 (espacio no separable) en es-CR.
const NBSP = ' ';

describe('formatMoney', () => {
  it('formatea colones en es-CR con ₡ y sin decimales (CLDR)', () => {
    expect(formatMoney(890_000, 'CRC', 'es-CR')).toBe(`₡8${NBSP}900`);
    expect(formatMoney(12_500_000, 'CRC', 'es-CR')).toBe(`₡125${NBSP}000`);
  });

  it('muestra ₡ también en inglés', () => {
    expect(formatMoney(890_000, 'CRC', 'en')).toBe('₡8,900');
  });

  it('usa es-CR por defecto', () => {
    expect(formatMoney(120_000, 'CRC')).toBe(`₡1${NBSP}200`);
  });

  it('formatea dólares con dos decimales', () => {
    expect(formatMoney(1250, 'USD', 'en')).toBe('$12.50');
    expect(formatMoney(1250, 'USD', 'es-CR')).toBe('$12,50');
  });

  it('rechaza montos que no son enteros', () => {
    expect(() => formatMoney(10.5, 'CRC')).toThrow(RangeError);
  });
});
