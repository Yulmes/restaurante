import { LINE_MAX_QUANTITY, lineKey, type UnavailableReason } from '@marea-baja/shared';

/**
 * Reglas puras de las líneas del carrito (§7.5, regla C5). Sin base de datos: las usan el
 * carrito, la fusión y la creación del pedido, y se prueban con tablas.
 */

/**
 * Reparte una cantidad total en líneas internas de hasta 20 unidades (C5):
 * 15 → [15]; 25 → [20, 5]; 47 → [20, 20, 7]. La suma siempre es exactamente el total.
 */
export function splitQuantity(total: number, max: number = LINE_MAX_QUANTITY): number[] {
  if (!Number.isSafeInteger(total) || total < 0) throw new RangeError('cantidad inválida');
  if (!Number.isSafeInteger(max) || max < 1) throw new RangeError('máximo inválido');
  const parts: number[] = [];
  let left = total;
  while (left > 0) {
    const take = Math.min(max, left);
    parts.push(take);
    left -= take;
  }
  return parts;
}

export interface LineRef {
  productId: string;
  optionIds: readonly string[];
  quantity: number;
}

export interface GroupedLine {
  key: string;
  productId: string;
  /** Ordenadas y sin repetir. */
  optionIds: string[];
  quantity: number;
}

/**
 * Agrupa líneas por identidad (plato + opciones ordenadas) y **suma** sus cantidades: no toma el
 * máximo ni sobrescribe (§7.5). Conserva el orden de la primera aparición.
 */
export function groupLines(lines: readonly LineRef[]): GroupedLine[] {
  const groups = new Map<string, GroupedLine>();
  for (const line of lines) {
    const optionIds = [...new Set(line.optionIds)].sort();
    const key = lineKey(line.productId, optionIds);
    const current = groups.get(key);
    if (current) current.quantity += line.quantity;
    else groups.set(key, { key, productId: line.productId, optionIds, quantity: line.quantity });
  }
  return [...groups.values()];
}

/** Lo mínimo del catálogo que hace falta para validar una selección. */
export interface SelectableProduct {
  id: string;
  isActive: boolean;
  isAvailable: boolean;
  groups: readonly {
    id: string;
    isActive: boolean;
    minSelect: number;
    maxSelect: number;
    options: readonly { id: string; isAvailable: boolean }[];
  }[];
}

/**
 * Valida una selección contra el catálogo vigente. Orden de los motivos: plato inexistente o
 * retirado → opciones inválidas (ajenas o fuera de mínimo/máximo) → plato agotado → opción agotada.
 * `null` = se puede pedir.
 */
export function selectionProblem(
  product: SelectableProduct | undefined,
  optionIds: readonly string[],
): UnavailableReason | null {
  if (!product?.isActive) return 'PRODUCT_NOT_FOUND';
  const chosen = new Set(optionIds);
  if (chosen.size !== optionIds.length) return 'OPTIONS_INVALID';
  const groups = product.groups.filter((g) => g.isActive);
  const known = new Map<string, { groupId: string; isAvailable: boolean }>();
  for (const group of groups) {
    for (const option of group.options) {
      known.set(option.id, { groupId: group.id, isAvailable: option.isAvailable });
    }
  }
  for (const id of chosen) if (!known.has(id)) return 'OPTIONS_INVALID';
  for (const group of groups) {
    const count = group.options.filter((o) => chosen.has(o.id)).length;
    if (count < group.minSelect || count > group.maxSelect) return 'OPTIONS_INVALID';
  }
  if (!product.isAvailable) return 'PRODUCT_SOLD_OUT';
  for (const id of chosen) if (known.get(id)?.isAvailable === false) return 'OPTION_UNAVAILABLE';
  return null;
}

export interface OpeningRange {
  dayOfWeek: number;
  opensMinutes: number;
  closesMinutes: number;
}

/** Día (0 = domingo) y minutos desde la medianoche en la zona horaria del restaurante. */
export function localDayAndMinutes(date: Date, timeZone: string): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return { day: days.indexOf(get('weekday')), minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

/** Abierto si la hora local cae en algún rango del día: apertura incluida, cierre excluido. */
export function isOpenAt(date: Date, timeZone: string, hours: readonly OpeningRange[]): boolean {
  const { day, minutes } = localDayAndMinutes(date, timeZone);
  return hours.some((h) => h.dayOfWeek === day && minutes >= h.opensMinutes && minutes < h.closesMinutes);
}

/** Compara nombres de distrito sin tildes, mayúsculas ni espacios de más. */
export function normalizeDistrict(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
