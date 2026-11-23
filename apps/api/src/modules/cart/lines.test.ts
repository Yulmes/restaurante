import { lineKey } from '@marea-baja/shared';
import { describe, expect, it } from 'vitest';
import {
  groupLines,
  isOpenAt,
  localDayAndMinutes,
  normalizeDistrict,
  selectionProblem,
  splitQuantity,
  type SelectableProduct,
} from './lines.ts';

describe('splitQuantity (regla C5: líneas internas de hasta 20)', () => {
  it.each([
    [0, []],
    [1, [1]],
    [15, [15]],
    [19, [19]],
    [20, [20]],
    [21, [20, 1]],
    [25, [20, 5]],
    [30, [20, 10]],
    [40, [20, 20]],
    [41, [20, 20, 1]],
    [47, [20, 20, 7]],
    [999, [...Array<number>(49).fill(20), 19]],
  ])('%i → %j', (total, expected) => {
    const parts = splitQuantity(total);
    expect(parts).toEqual(expected);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
    expect(parts.every((p) => p >= 1 && p <= 20)).toBe(true);
  });

  it('rechaza cantidades negativas o fraccionarias', () => {
    expect(() => splitQuantity(-1)).toThrow(RangeError);
    expect(() => splitQuantity(2.5)).toThrow(RangeError);
  });
});

describe('groupLines (identidad de línea, §7.5)', () => {
  const p = '00000000-0000-4000-8000-000000000001';
  const a = '00000000-0000-4000-8000-0000000000aa';
  const b = '00000000-0000-4000-8000-0000000000bb';

  it('las mismas opciones en distinto orden son la misma línea y las cantidades se suman', () => {
    const grouped = groupLines([
      { productId: p, optionIds: [b, a], quantity: 20 },
      { productId: p, optionIds: [a, b], quantity: 5 },
      { productId: p, optionIds: [a], quantity: 2 },
    ]);
    expect(grouped).toEqual([
      { key: lineKey(p, [a, b]), productId: p, optionIds: [a, b], quantity: 25 },
      { key: lineKey(p, [a]), productId: p, optionIds: [a], quantity: 2 },
    ]);
  });

  it('opciones repetidas cuentan una vez en la identidad', () => {
    expect(groupLines([{ productId: p, optionIds: [a, a], quantity: 1 }])[0]?.optionIds).toEqual([a]);
  });

  it('las líneas internas 20 + 20 + 7 se ven como un único producto de 47', () => {
    const internal = splitQuantity(47).map((quantity) => ({ productId: p, optionIds: [a], quantity }));
    expect(groupLines(internal)).toEqual([
      { key: lineKey(p, [a]), productId: p, optionIds: [a], quantity: 47 },
    ]);
  });
});

describe('selectionProblem', () => {
  const product: SelectableProduct = {
    id: 'p',
    isActive: true,
    isAvailable: true,
    groups: [
      {
        id: 'picante',
        isActive: true,
        minSelect: 1,
        maxSelect: 1,
        options: [
          { id: 'suave', isAvailable: true },
          { id: 'rocoto', isAvailable: false },
        ],
      },
      {
        id: 'extras',
        isActive: true,
        minSelect: 0,
        maxSelect: 2,
        options: [
          { id: 'camote', isAvailable: true },
          { id: 'choclo', isAvailable: true },
          { id: 'cancha', isAvailable: true },
        ],
      },
      {
        id: 'viejo',
        isActive: false,
        minSelect: 1,
        maxSelect: 1,
        options: [{ id: 'retirada', isAvailable: true }],
      },
    ],
  };

  it.each([
    ['selección válida', product, ['suave', 'camote'], null],
    ['plato inexistente', undefined, [], 'PRODUCT_NOT_FOUND'],
    ['plato retirado', { ...product, isActive: false }, ['suave'], 'PRODUCT_NOT_FOUND'],
    ['falta el grupo obligatorio', product, ['camote'], 'OPTIONS_INVALID'],
    ['dos opciones en un grupo de una', product, ['suave', 'rocoto'], 'OPTIONS_INVALID'],
    ['más extras que el máximo', product, ['suave', 'camote', 'choclo', 'cancha'], 'OPTIONS_INVALID'],
    ['opción de otro plato', product, ['suave', 'ajena'], 'OPTIONS_INVALID'],
    ['opción de un grupo desactivado', product, ['suave', 'retirada'], 'OPTIONS_INVALID'],
    ['opción repetida', product, ['suave', 'suave'], 'OPTIONS_INVALID'],
    ['plato agotado hoy', { ...product, isAvailable: false }, ['suave'], 'PRODUCT_SOLD_OUT'],
    ['opción agotada', product, ['rocoto'], 'OPTION_UNAVAILABLE'],
  ] as const)('%s → %s', (_name, candidate, optionIds, expected) => {
    expect(selectionProblem(candidate, optionIds)).toBe(expected);
  });
});

describe('horario (D-M5-3), en la zona del restaurante', () => {
  const tz = 'America/Costa_Rica';
  // Martes 12:00–21:30, cerrado los lunes (semilla).
  const hours = [{ dayOfWeek: 2, opensMinutes: 12 * 60, closesMinutes: 21 * 60 + 30 }];

  it('convierte UTC a la hora local de Costa Rica (UTC−6, sin horario de verano)', () => {
    // 17/11/2026 es martes: 19:00 UTC = 13:00 en San José.
    expect(localDayAndMinutes(new Date('2026-11-17T19:00:00Z'), tz)).toEqual({ day: 2, minutes: 13 * 60 });
    // 18/11 a las 03:00 UTC todavía es martes 21:00 en San José.
    expect(localDayAndMinutes(new Date('2026-11-18T03:00:00Z'), tz)).toEqual({ day: 2, minutes: 21 * 60 });
  });

  it.each([
    ['2026-11-17T17:59:00Z', false], // 11:59, antes de abrir
    ['2026-11-17T18:00:00Z', true], // 12:00, abre (incluido)
    ['2026-11-18T03:29:00Z', true], // 21:29
    ['2026-11-18T03:30:00Z', false], // 21:30, cierra (excluido)
    ['2026-11-16T19:00:00Z', false], // lunes 13:00, cerrado
  ])('%s → abierto: %s', (iso, open) => {
    expect(isOpenAt(new Date(iso), tz, hours)).toBe(open);
  });
});

describe('normalizeDistrict', () => {
  it('ignora tildes, mayúsculas y espacios', () => {
    expect(normalizeDistrict('  San   Pedro ')).toBe(normalizeDistrict('san pedro'));
    expect(normalizeDistrict('Sabanílla')).toBe('sabanilla');
  });
});
