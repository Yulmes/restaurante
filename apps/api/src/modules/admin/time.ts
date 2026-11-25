/**
 * Fechas locales del local (§6.1 `RestaurantSettings.timezone`). Costa Rica no tiene horario de
 * verano, pero el cálculo usa el desfase real de la zona en cada fecha para no depender de eso.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

function localParts(date: Date, timeZone: string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const part of partsFormatter(timeZone).formatToParts(date)) {
    if (part.type !== 'literal') result[part.type] = Number(part.value);
  }
  return result;
}

/** Desfase de la zona en ese instante, en milisegundos (hora local − UTC). */
function offsetMs(date: Date, timeZone: string): number {
  const p = localParts(date, timeZone);
  const asUtc = Date.UTC(
    p['year'] ?? 0,
    (p['month'] ?? 1) - 1,
    p['day'] ?? 1,
    p['hour'] ?? 0,
    p['minute'] ?? 0,
    p['second'] ?? 0,
  );
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Fecha local `YYYY-MM-DD` de un instante. */
export function localDateOf(date: Date, timeZone: string): string {
  const p = localParts(date, timeZone);
  const pad = (n: number | undefined) => String(n ?? 0).padStart(2, '0');
  return `${String(p['year'])}-${pad(p['month'])}-${pad(p['day'])}`;
}

/** Instante en que empieza ese día local (más `minutes` minutos). */
export function localDateTime(date: string, timeZone: string, minutes = 0): Date {
  const [y, m, d] = date.split('-').map(Number);
  const guess = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) + minutes * 60_000);
  return new Date(guess.getTime() - offsetMs(guess, timeZone));
}

/** `HH:MM` local de un instante. */
export function localTimeOf(date: Date, timeZone: string): string {
  const p = localParts(date, timeZone);
  return `${String(p['hour'] ?? 0).padStart(2, '0')}:${String(p['minute'] ?? 0).padStart(2, '0')}`;
}

/** `YYYY-MM-DD` desplazado `days` días (calendario, sin zona). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days)).toISOString().slice(0, 10);
}
