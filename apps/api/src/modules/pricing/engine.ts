/**
 * Motor de precios e impuestos (§6.2, R-MONEY-01). **Puro:** sin base de datos, red ni reloj; recibe
 * todo lo que necesita y devuelve enteros en la unidad menor. Nunca usa decimales para el dinero.
 *
 * Algoritmo aprobado (§6.2, punto 5):
 * 1. Precio de línea = (precio base + Σ opciones) × cantidad.
 * 2. Los descuentos se reparten entre líneas por el **método del mayor resto**.
 * 3. Se agrupan las bases imponibles por tasa.
 * 4. Impuesto incluido: `round(base × r / (1 + r))`; no incluido: `round(base × r)`.
 * 5. Redondeo **half-up**, una vez por tasa y por pedido (no por línea).
 * 6. El total se redondea al incremento de la moneda y la diferencia queda en
 *    `roundingAdjustmentMinor`.
 *
 * ⚠️ Configuración de software para una demo (D5): no es asesoramiento ni certificación fiscal.
 */

export type FulfillmentScope = 'PICKUP' | 'DELIVERY' | 'DINE_IN';

export interface PricingTaxRate {
  id: string;
  name: string;
  /** Puntos básicos: 1300 = 13,00 %. */
  rateBps: number;
  appliesTo: 'ITEMS' | 'DELIVERY' | 'BOTH';
  /** Modalidades a las que aplica (`DINE_IN` solo existe para el cargo inactivo, C10). */
  fulfillmentTypes: readonly FulfillmentScope[];
  isActive: boolean;
}

export interface PricingLine {
  key: string;
  /** Precio base + opciones, por unidad. */
  unitPriceMinor: number;
  quantity: number;
  /** Tasas ligadas al plato (`ProductTaxRate`). */
  taxRateIds: readonly string[];
}

export interface PricingInput {
  pricesIncludeTax: boolean;
  /** Incremento de cobro de la moneda (`RestaurantSettings.roundingIncrementMinor`). */
  roundingIncrementMinor: number;
  fulfillmentType: 'PICKUP' | 'DELIVERY';
  lines: readonly PricingLine[];
  taxRates: readonly PricingTaxRate[];
  deliveryFeeMinor: number;
  /** Descuento total ya calculado (por ejemplo, una promoción). Se reparte entre las líneas. */
  discountMinor?: number;
}

export interface PricedLine {
  key: string;
  unitPriceMinor: number;
  quantity: number;
  lineTotalMinor: number;
  /** Parte del descuento asignada a la línea (mayor resto). */
  discountMinor: number;
}

export interface PricedTaxLine {
  taxRateId: string;
  name: string;
  rateBps: number;
  inclusive: boolean;
  taxableBaseMinor: number;
  taxMinor: number;
}

export interface PricingResult {
  lines: PricedLine[];
  subtotalMinor: number;
  discountMinor: number;
  deliveryFeeMinor: number;
  taxLines: PricedTaxLine[];
  taxTotalMinor: number;
  roundingAdjustmentMinor: number;
  totalMinor: number;
}

export class PricingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PricingError';
  }
}

function assertMinor(value: number, what: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new PricingError(`${what} debe ser un entero ≥ 0`);
}

/**
 * División entera con redondeo half-up (alejándose de cero) para numerador y denominador
 * positivos: `round(n / d)` sin pasar por decimales.
 */
export function divideHalfUp(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new PricingError('divideHalfUp requiere enteros seguros y denominador positivo');
  }
  const sign = numerator < 0 ? -1 : 1;
  const n = Math.abs(numerator);
  const result = Math.floor((2 * n + denominator) / (2 * denominator));
  return result === 0 ? 0 : sign * result;
}

/** Redondea al múltiplo más cercano de `increment` (half-up). */
export function roundToIncrement(amount: number, increment: number): number {
  if (!Number.isSafeInteger(increment) || increment < 1) throw new PricingError('incremento inválido');
  return divideHalfUp(amount, increment) * increment;
}

/**
 * Reparte `total` entre `weights` en proporción, con el método del mayor resto: la suma de las
 * partes es exactamente `total`. Los empates de resto se resuelven por orden (estable).
 */
export function allocateLargestRemainder(total: number, weights: readonly number[]): number[] {
  assertMinor(total, 'el monto a repartir');
  for (const weight of weights) assertMinor(weight, 'cada peso');
  const sum = weights.reduce((acc, w) => acc + w, 0);
  if (total === 0 || sum === 0) return weights.map(() => 0);
  if (total > sum) throw new PricingError('el monto a repartir supera la suma de los pesos');
  const base = weights.map((w) => Math.floor((total * w) / sum));
  const remainders = weights.map((w, i) => ({ i, r: total * w - (base[i] ?? 0) * sum }));
  let left = total - base.reduce((acc, v) => acc + v, 0);
  remainders.sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of remainders) {
    if (left === 0) break;
    base[i] = (base[i] ?? 0) + 1;
    left -= 1;
  }
  return base;
}

function taxFor(base: number, rateBps: number, inclusive: boolean): number {
  if (base === 0 || rateBps === 0) return 0;
  return inclusive ? divideHalfUp(base * rateBps, 10_000 + rateBps) : divideHalfUp(base * rateBps, 10_000);
}

export function priceOrder(input: PricingInput): PricingResult {
  assertMinor(input.deliveryFeeMinor, 'el envío');
  const discount = input.discountMinor ?? 0;
  assertMinor(discount, 'el descuento');
  if (input.fulfillmentType === 'PICKUP' && input.deliveryFeeMinor !== 0) {
    throw new PricingError('un retiro no lleva envío');
  }

  const lines = input.lines.map((line) => {
    assertMinor(line.unitPriceMinor, 'el precio unitario');
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1) {
      throw new PricingError('la cantidad debe ser un entero ≥ 1');
    }
    const lineTotalMinor = line.unitPriceMinor * line.quantity;
    assertMinor(lineTotalMinor, 'el total de línea');
    return { ...line, lineTotalMinor };
  });
  const subtotalMinor = lines.reduce((acc, l) => acc + l.lineTotalMinor, 0);
  if (discount > subtotalMinor) throw new PricingError('el descuento supera el subtotal');
  const shares = allocateLargestRemainder(
    discount,
    lines.map((l) => l.lineTotalMinor),
  );

  // Tasas activas para esta modalidad, en un orden estable (por id) para la copia histórica.
  const rates = input.taxRates
    .filter((rate) => rate.isActive && rate.fulfillmentTypes.includes(input.fulfillmentType))
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const rate of rates) {
    if (!Number.isInteger(rate.rateBps) || rate.rateBps < 0 || rate.rateBps > 10_000) {
      throw new PricingError('rateBps fuera de rango');
    }
  }

  const taxLines: PricedTaxLine[] = [];
  for (const rate of rates) {
    let base = 0;
    if (rate.appliesTo !== 'DELIVERY') {
      lines.forEach((line, i) => {
        if (line.taxRateIds.includes(rate.id)) base += line.lineTotalMinor - (shares[i] ?? 0);
      });
    }
    if (rate.appliesTo !== 'ITEMS') base += input.deliveryFeeMinor;
    if (base === 0) continue;
    taxLines.push({
      taxRateId: rate.id,
      name: rate.name,
      rateBps: rate.rateBps,
      inclusive: input.pricesIncludeTax,
      taxableBaseMinor: base,
      taxMinor: taxFor(base, rate.rateBps, input.pricesIncludeTax),
    });
  }
  const taxTotalMinor = taxLines.reduce((acc, t) => acc + t.taxMinor, 0);
  // Con precios con impuesto incluido, el impuesto ya está dentro del subtotal y del envío.
  const exclusiveTax = input.pricesIncludeTax ? 0 : taxTotalMinor;
  const raw = subtotalMinor - discount + input.deliveryFeeMinor + exclusiveTax;
  const totalMinor = roundToIncrement(raw, input.roundingIncrementMinor);

  return {
    lines: lines.map((line, i) => ({
      key: line.key,
      unitPriceMinor: line.unitPriceMinor,
      quantity: line.quantity,
      lineTotalMinor: line.lineTotalMinor,
      discountMinor: shares[i] ?? 0,
    })),
    subtotalMinor,
    discountMinor: discount,
    deliveryFeeMinor: input.deliveryFeeMinor,
    taxLines,
    taxTotalMinor,
    roundingAdjustmentMinor: totalMinor - raw,
    totalMinor,
  };
}

/** Promoción (§6.1). M5 no expone códigos al cliente (D-M5-5); el cálculo queda listo para M8. */
export interface PricingPromotion {
  kind: 'PERCENT' | 'FIXED_AMOUNT';
  percentBps: number | null;
  amountMinor: number | null;
  minSubtotalMinor: number;
}

/** Descuento de una promoción sobre el subtotal: nunca negativo ni mayor que el subtotal. */
export function promotionDiscount(promotion: PricingPromotion, subtotalMinor: number): number {
  assertMinor(subtotalMinor, 'el subtotal');
  if (subtotalMinor < promotion.minSubtotalMinor) return 0;
  const raw =
    promotion.kind === 'PERCENT'
      ? divideHalfUp(subtotalMinor * (promotion.percentBps ?? 0), 10_000)
      : (promotion.amountMinor ?? 0);
  return Math.max(0, Math.min(raw, subtotalMinor));
}
