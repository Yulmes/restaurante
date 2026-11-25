import { describe, expect, it } from 'vitest';
import { convertMinor, convertPrice, parseRateHundredths, roundToIncrement } from './currency.ts';

describe('cambio de moneda (§6.2, D-M8-4)', () => {
  it('lee el tipo de cambio sin coma flotante', () => {
    expect(parseRateHundredths('510')).toBe(51000);
    expect(parseRateHundredths('510.2')).toBe(51020);
    expect(parseRateHundredths('510.25')).toBe(51025);
    expect(parseRateHundredths('1')).toBe(100);
    expect(() => parseRateHundredths('0.99')).toThrow();
    expect(() => parseRateHundredths('510.255')).toThrow();
    expect(() => parseRateHundredths('-5')).toThrow();
    expect(() => parseRateHundredths('5,10')).toThrow();
  });

  it('convierte CRC → USD en centavos con half-up', () => {
    // ₡8 900 a 500 ₡/$ = $17,80.
    expect(convertMinor(890000, 'CRC', 'USD', 50000)).toBe(1780);
    // ₡1 000 a 510,25 ₡/$ = $1,9598… → 196 centavos.
    expect(convertMinor(100000, 'CRC', 'USD', 51025)).toBe(196);
    // Medio centavo exacto: ₡2,50 a 500 ₡/$ = 0,5 centavos → 1 (half-up).
    expect(convertMinor(250, 'CRC', 'USD', 50000)).toBe(1);
    expect(convertMinor(0, 'CRC', 'USD', 50000)).toBe(0);
  });

  it('convierte USD → CRC en céntimos', () => {
    expect(convertMinor(1780, 'USD', 'CRC', 50000)).toBe(890000);
    // $1,99 a 510,25 = ₡1 015,3975 → 101540 céntimos (half-up).
    expect(convertMinor(199, 'USD', 'CRC', 51025)).toBe(101540);
  });

  it('la misma moneda no cambia el monto', () => {
    expect(convertMinor(12345, 'CRC', 'CRC', 50000)).toBe(12345);
  });

  it('rechaza montos negativos o no enteros', () => {
    expect(() => convertMinor(-1, 'CRC', 'USD', 50000)).toThrow();
    expect(() => convertMinor(1.5, 'CRC', 'USD', 50000)).toThrow();
  });

  it('ajusta los precios al incremento de la moneda de destino', () => {
    expect(roundToIncrement(101540, 100)).toBe(101500);
    expect(roundToIncrement(101550, 100)).toBe(101600);
    expect(roundToIncrement(101549, 100)).toBe(101500);
    expect(roundToIncrement(1999, 1)).toBe(1999);
    // USD → CRC queda en colón entero; CRC → USD, en centavos.
    expect(convertPrice(199, 'USD', 'CRC', 51025)).toBe(101500);
    expect(convertPrice(100000, 'CRC', 'USD', 51025)).toBe(196);
  });

  it('ida y vuelta con un tipo redondo conserva los precios en múltiplos de ₡5', () => {
    for (const price of [890000, 1250000, 450000, 0, 50000]) {
      const usd = convertPrice(price, 'CRC', 'USD', 50000);
      expect(convertPrice(usd, 'USD', 'CRC', 50000)).toBe(price);
    }
  });
});
