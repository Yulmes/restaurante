import { describe, expect, it } from 'vitest';
import {
  PricingError,
  allocateLargestRemainder,
  divideHalfUp,
  priceOrder,
  promotionDiscount,
  roundToIncrement,
  type PricingInput,
  type PricingTaxRate,
} from './engine.ts';

/** Valores semilla aprobados (D5): IVA 13 % incluido y servicio 10 % inactivo solo en DINE_IN. */
const IVA: PricingTaxRate = {
  id: 'iva',
  name: 'IVA',
  rateBps: 1300,
  appliesTo: 'BOTH',
  fulfillmentTypes: ['PICKUP', 'DELIVERY'],
  isActive: true,
};
const SERVICIO: PricingTaxRate = {
  id: 'servicio',
  name: 'Cargo de servicio',
  rateBps: 1000,
  appliesTo: 'ITEMS',
  fulfillmentTypes: ['DINE_IN'],
  isActive: false,
};

const crc = (colones: number) => colones * 100;

function input(overrides: Partial<PricingInput> = {}): PricingInput {
  return {
    pricesIncludeTax: true,
    roundingIncrementMinor: 100,
    fulfillmentType: 'PICKUP',
    lines: [{ key: 'ceviche', unitPriceMinor: crc(8900), quantity: 1, taxRateIds: ['iva', 'servicio'] }],
    taxRates: [IVA, SERVICIO],
    deliveryFeeMinor: 0,
    ...overrides,
  };
}

describe('divideHalfUp y roundToIncrement', () => {
  it.each([
    [5, 10, 1],
    [4, 10, 0],
    [15, 10, 2],
    [14, 10, 1],
    [13, 2, 7],
    [0, 7, 0],
    [-5, 10, -1],
    [-4, 10, 0],
  ])('round(%i / %i) = %i (half-up, alejándose de cero)', (n, d, expected) => {
    expect(divideHalfUp(n, d)).toBe(expected);
  });

  it.each([
    [123450, 100, 123500],
    [123449, 100, 123400],
    [123400, 100, 123400],
    [1999, 1, 1999],
  ])('%i redondeado a %i → %i', (amount, increment, expected) => {
    expect(roundToIncrement(amount, increment)).toBe(expected);
  });

  it('rechaza denominadores no positivos e incrementos inválidos', () => {
    expect(() => divideHalfUp(1, 0)).toThrow(PricingError);
    expect(() => roundToIncrement(1, 0)).toThrow(PricingError);
  });
});

describe('allocateLargestRemainder', () => {
  it.each([
    [10, [10, 10, 10], [4, 3, 3]],
    [7, [50, 30, 20], [4, 2, 1]],
    [100, [333, 333, 334], [33, 33, 34]],
    [0, [5, 5], [0, 0]],
    [9, [0, 0], [0, 0]],
    [6, [6], [6]],
  ])('reparte %i entre %j → %j', (total, weights, expected) => {
    const result = allocateLargestRemainder(total, weights);
    expect(result).toEqual(expected);
    if (weights.some((w) => w > 0)) expect(result.reduce((a, b) => a + b, 0)).toBe(total);
  });

  it('la suma cierra exactamente con pesos desparejos', () => {
    const weights = [1_234_500, 99_900, 1, 7_777_700];
    for (const total of [1, 17, 999, 123_456]) {
      expect(allocateLargestRemainder(total, weights).reduce((a, b) => a + b, 0)).toBe(total);
    }
  });

  it('no reparte más que la suma de los pesos', () => {
    expect(() => allocateLargestRemainder(11, [5, 5])).toThrow(PricingError);
  });
});

describe('priceOrder · IVA incluido (D5) en CRC', () => {
  it('un ceviche de ₡8 900: IVA 13 % incluido = ₡1 023,89 y total sin ajuste', () => {
    const result = priceOrder(input());
    expect(result).toMatchObject({
      subtotalMinor: 890000,
      deliveryFeeMinor: 0,
      taxTotalMinor: 102389,
      roundingAdjustmentMinor: 0,
      totalMinor: 890000,
    });
    // El cargo de servicio está inactivo y además solo aplica a DINE_IN (C10).
    expect(result.taxLines).toEqual([
      {
        taxRateId: 'iva',
        name: 'IVA',
        rateBps: 1300,
        inclusive: true,
        taxableBaseMinor: 890000,
        taxMinor: 102389,
      },
    ]);
  });

  it('delivery: el envío suma al total y entra en la base del IVA (appliesTo BOTH)', () => {
    const result = priceOrder(input({ fulfillmentType: 'DELIVERY', deliveryFeeMinor: crc(1200) }));
    expect(result.subtotalMinor).toBe(890000);
    expect(result.taxLines[0]).toMatchObject({ taxableBaseMinor: 1010000, taxMinor: 116195 });
    expect(result.totalMinor).toBe(1010000);
  });

  it('las líneas se multiplican por la cantidad (opciones ya sumadas al unitario)', () => {
    const result = priceOrder(
      input({
        lines: [
          { key: 'a', unitPriceMinor: crc(8900 + 500), quantity: 25, taxRateIds: ['iva'] },
          { key: 'b', unitPriceMinor: crc(2500), quantity: 2, taxRateIds: ['iva'] },
        ],
      }),
    );
    expect(result.lines.map((l) => l.lineTotalMinor)).toEqual([crc(235000), crc(5000)]);
    expect(result.subtotalMinor).toBe(crc(240000));
    expect(result.totalMinor).toBe(crc(240000));
  });

  it('un plato sin tasas ligadas no genera impuesto', () => {
    const result = priceOrder(
      input({ lines: [{ key: 'x', unitPriceMinor: crc(1000), quantity: 1, taxRateIds: [] }] }),
    );
    expect(result.taxLines).toEqual([]);
    expect(result.taxTotalMinor).toBe(0);
  });

  it('el servicio activo para DINE_IN sigue sin aplicar a retiro ni delivery (D4, C10)', () => {
    const result = priceOrder(input({ taxRates: [IVA, { ...SERVICIO, isActive: true }] }));
    expect(result.taxLines.map((t) => t.taxRateId)).toEqual(['iva']);
  });

  it('una tasa configurada para PICKUP y activa sí aplica (configurable, D5)', () => {
    const result = priceOrder(
      input({ taxRates: [IVA, { ...SERVICIO, isActive: true, fulfillmentTypes: ['PICKUP'] }] }),
    );
    expect(result.taxLines.map((t) => [t.taxRateId, t.taxMinor])).toEqual([
      ['iva', 102389],
      ['servicio', 80909],
    ]);
    // Incluidos: el total no cambia.
    expect(result.totalMinor).toBe(890000);
  });
});

describe('priceOrder · impuesto no incluido y USD', () => {
  it('USD con 13 % sumado: 3 × $10,00 → $3,90 de impuesto y $33,90 de total', () => {
    const result = priceOrder(
      input({
        pricesIncludeTax: false,
        roundingIncrementMinor: 1,
        lines: [{ key: 'a', unitPriceMinor: 1000, quantity: 3, taxRateIds: ['iva'] }],
      }),
    );
    expect(result).toMatchObject({ subtotalMinor: 3000, taxTotalMinor: 390, totalMinor: 3390 });
  });

  it('redondea una vez por tasa y por pedido, no por línea', () => {
    const lines = [1, 2, 3].map((n) => ({
      key: String(n),
      unitPriceMinor: 333,
      quantity: 1,
      taxRateIds: ['iva'],
    }));
    const result = priceOrder(input({ pricesIncludeTax: false, roundingIncrementMinor: 1, lines }));
    // Por línea serían 3 × round(43,29) = 129; una vez sobre 999 es round(129,87) = 130.
    expect(result.taxTotalMinor).toBe(130);
    expect(result.totalMinor).toBe(1129);
  });

  it('ajusta el total al incremento de la moneda y guarda la diferencia', () => {
    const result = priceOrder(
      input({
        pricesIncludeTax: false,
        lines: [{ key: 'a', unitPriceMinor: 100000, quantity: 1, taxRateIds: ['iva'] }],
        taxRates: [{ ...IVA, rateBps: 1255 }],
      }),
    );
    // 100000 + 12550 = 112550 → al colón entero (100 céntimos): 112600, ajuste +50.
    expect(result).toMatchObject({ taxTotalMinor: 12550, roundingAdjustmentMinor: 50, totalMinor: 112600 });
  });

  it('el ajuste puede ser negativo', () => {
    const result = priceOrder(
      input({
        pricesIncludeTax: false,
        lines: [{ key: 'a', unitPriceMinor: 100000, quantity: 1, taxRateIds: ['iva'] }],
        taxRates: [{ ...IVA, rateBps: 1240 }],
      }),
    );
    expect(result).toMatchObject({ taxTotalMinor: 12400, roundingAdjustmentMinor: 0, totalMinor: 112400 });
    const odd = priceOrder(
      input({
        pricesIncludeTax: false,
        lines: [{ key: 'a', unitPriceMinor: 100030, quantity: 1, taxRateIds: [] }],
      }),
    );
    expect(odd).toMatchObject({ roundingAdjustmentMinor: -30, totalMinor: 100000 });
  });
});

describe('priceOrder · descuentos (motor listo; M5 no expone códigos, D-M5-5)', () => {
  it('reparte el descuento por mayor resto y lo descuenta de la base imponible', () => {
    const result = priceOrder(
      input({
        lines: [
          { key: 'a', unitPriceMinor: 500000, quantity: 1, taxRateIds: ['iva'] },
          { key: 'b', unitPriceMinor: 300000, quantity: 1, taxRateIds: ['iva'] },
          { key: 'c', unitPriceMinor: 200000, quantity: 1, taxRateIds: [] },
        ],
        discountMinor: 70001,
      }),
    );
    expect(result.lines.map((l) => l.discountMinor)).toEqual([35001, 21000, 14000]);
    expect(result.lines.reduce((a, l) => a + l.discountMinor, 0)).toBe(70001);
    // Base del IVA: (500000 − 35001) + (300000 − 21000) = 743999.
    expect(result.taxLines[0]).toMatchObject({ taxableBaseMinor: 743999, taxMinor: 85593 });
    // 1000000 − 70001 = 929999 → redondeado al colón: 930000.
    expect(result).toMatchObject({ discountMinor: 70001, roundingAdjustmentMinor: 1, totalMinor: 930000 });
  });

  it('rechaza un descuento mayor que el subtotal', () => {
    expect(() => priceOrder(input({ discountMinor: 890001 }))).toThrow(PricingError);
  });

  it('promotionDiscount: porcentaje, monto fijo, mínimo y tope en el subtotal', () => {
    const percent = { kind: 'PERCENT' as const, percentBps: 1000, amountMinor: null, minSubtotalMinor: 0 };
    expect(promotionDiscount(percent, 890000)).toBe(89000);
    expect(promotionDiscount({ ...percent, percentBps: 3333 }, 100)).toBe(33);
    expect(promotionDiscount({ ...percent, minSubtotalMinor: 1_000_000 }, 890000)).toBe(0);
    const fixed = {
      kind: 'FIXED_AMOUNT' as const,
      percentBps: null,
      amountMinor: 200000,
      minSubtotalMinor: 0,
    };
    expect(promotionDiscount(fixed, 890000)).toBe(200000);
    expect(promotionDiscount(fixed, 150000)).toBe(150000);
  });
});

describe('priceOrder · validaciones', () => {
  it.each([
    ['cantidad 0', { lines: [{ key: 'a', unitPriceMinor: 100, quantity: 0, taxRateIds: [] }] }],
    ['cantidad fraccionaria', { lines: [{ key: 'a', unitPriceMinor: 100, quantity: 1.5, taxRateIds: [] }] }],
    ['precio negativo', { lines: [{ key: 'a', unitPriceMinor: -1, quantity: 1, taxRateIds: [] }] }],
    ['precio con decimales', { lines: [{ key: 'a', unitPriceMinor: 10.5, quantity: 1, taxRateIds: [] }] }],
    ['envío negativo', { fulfillmentType: 'DELIVERY' as const, deliveryFeeMinor: -1 }],
    ['envío en un retiro', { deliveryFeeMinor: 100 }],
    ['tasa fuera de rango', { taxRates: [{ ...IVA, rateBps: 10_001 }] }],
  ])('rechaza %s', (_name, overrides) => {
    expect(() => priceOrder(input(overrides))).toThrow(PricingError);
  });

  it('un carrito vacío da cero', () => {
    expect(priceOrder(input({ lines: [] }))).toMatchObject({ subtotalMinor: 0, totalMinor: 0, taxLines: [] });
  });
});
