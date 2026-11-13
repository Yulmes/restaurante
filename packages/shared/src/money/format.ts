import { DEFAULT_LOCALE, type Locale } from '../i18n/locales.ts';

/**
 * Monedas soportadas (§6.2): los montos viajan siempre como enteros en la
 * unidad menor ISO 4217 (céntimos para CRC, centavos para USD).
 */
export const CURRENCIES = {
  CRC: { minorUnits: 2, displayFractionDigits: 0 },
  USD: { minorUnits: 2, displayFractionDigits: 2 },
} as const;

export type CurrencyCode = keyof typeof CURRENCIES;

const formatters = new Map<string, Intl.NumberFormat>();

function formatterFor(locale: Locale, currency: CurrencyCode): Intl.NumberFormat {
  const key = `${locale}|${currency}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    const digits = CURRENCIES[currency].displayFractionDigits;
    formatter = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      // "narrowSymbol" muestra ₡ también en inglés (con "symbol", en mostraría "CRC").
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    formatters.set(key, formatter);
  }
  return formatter;
}

/**
 * Formatea un monto en unidad menor para mostrarlo. Solo presenta: no redondea
 * reglas de negocio (el redondeo al colón entero lo resuelve el motor de precios).
 * Usa el formato estándar de CLDR por idioma (§4.5), por ejemplo "₡8 900" en es-CR.
 */
export function formatMoney(
  amountMinor: number,
  currency: CurrencyCode,
  locale: Locale = DEFAULT_LOCALE,
): string {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new RangeError('El monto debe ser un entero en unidad menor');
  }
  const major = amountMinor / 10 ** CURRENCIES[currency].minorUnits;
  return formatterFor(locale, currency).format(major);
}
