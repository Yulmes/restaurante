import type { CurrencyCode } from '@marea-baja/shared';

/**
 * Cambio de moneda (§6.2, punto 3; D-M8-4). Funciones puras, sin la base:
 * - el tipo de cambio llega siempre como colones por dólar con hasta dos decimales ("510.25") y
 *   se guarda en centésimas enteras (51025), sin pasar por coma flotante;
 * - cada monto se convierte en la unidad menor ISO 4217 (céntimos y centavos, ambos con 2
 *   decimales) y se redondea half-up, como el motor de precios (§6.2, paso 5);
 * - los precios se ajustan después al incremento por defecto de la moneda nueva (CRC: colón
 *   entero; USD: centavo), igual que la semilla (§6.2, punto 1).
 */
export const DEFAULT_ROUNDING_INCREMENT: Record<CurrencyCode, number> = { CRC: 100, USD: 1 };

/** "510.25" → 51025. Lanza si el formato no es el del esquema (lo valida Zod antes). */
export function parseRateHundredths(value: string): number {
  const match = /^(\d{1,6})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) throw new Error(`Tipo de cambio inválido: ${value}`);
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? '').padEnd(2, '0'));
  const hundredths = whole * 100 + fraction;
  if (hundredths < 100) throw new Error('El tipo de cambio debe ser de al menos 1 colón por dólar');
  return hundredths;
}

/** División entera con redondeo half-up (alejándose de cero) para no negativos. */
function divideHalfUp(numerator: number, denominator: number): number {
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

/** Redondea un monto al múltiplo más cercano del incremento (half-up). */
export function roundToIncrement(amountMinor: number, increment: number): number {
  if (increment <= 1) return amountMinor;
  return divideHalfUp(amountMinor, increment) * increment;
}

/**
 * Convierte un monto entre CRC y USD.
 * - CRC → USD: centavos = céntimos × 100 / centésimas del tipo.
 * - USD → CRC: céntimos = centavos × centésimas del tipo / 100.
 */
export function convertMinor(
  amountMinor: number,
  from: CurrencyCode,
  to: CurrencyCode,
  rateHundredths: number,
): number {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new Error(`Monto inválido: ${String(amountMinor)}`);
  }
  if (from === to) return amountMinor;
  return from === 'CRC'
    ? divideHalfUp(amountMinor * 100, rateHundredths)
    : divideHalfUp(amountMinor * rateHundredths, 100);
}

/** Precio convertido y ajustado al incremento por defecto de la moneda de destino. */
export function convertPrice(
  amountMinor: number,
  from: CurrencyCode,
  to: CurrencyCode,
  rateHundredths: number,
): number {
  return roundToIncrement(
    convertMinor(amountMinor, from, to, rateHundredths),
    DEFAULT_ROUNDING_INCREMENT[to],
  );
}
