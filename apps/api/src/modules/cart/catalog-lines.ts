import type { CartLineView, CartView, Locale, LocalizedText } from '@marea-baja/shared';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.ts';
import { selectionProblem, type GroupedLine, type SelectableProduct } from './lines.ts';

/**
 * Lee del catálogo vigente lo que hace falta para validar y valorizar líneas (carrito, fusión y
 * pedido). Siempre desde la base, dentro de la transacción del llamador cuando la hay: el precio
 * y la disponibilidad nunca vienen del navegador (§7.3).
 */
export type Db = PrismaClient | Prisma.TransactionClient;

const productSelect = {
  id: true,
  slug: true,
  name: true,
  isActive: true,
  isAvailable: true,
  basePriceMinor: true,
  category: { select: { slug: true, isActive: true } },
  translations: { select: { locale: true, name: true } },
  taxRates: { select: { taxRateId: true } },
  optionGroups: {
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      name: true,
      isActive: true,
      minSelect: true,
      maxSelect: true,
      translations: { select: { locale: true, name: true } },
      options: {
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          name: true,
          priceDeltaMinor: true,
          isAvailable: true,
          translations: { select: { locale: true, name: true } },
        },
      },
    },
  },
} as const satisfies Prisma.ProductSelect;

export type ProductRecord = Prisma.ProductGetPayload<{ select: typeof productSelect }>;

export async function loadProducts(db: Db, ids: readonly string[]): Promise<Map<string, ProductRecord>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await db.product.findMany({ where: { id: { in: unique } }, select: productSelect });
  return new Map(rows.map((row) => [row.id, row]));
}

export function toSelectable(record: ProductRecord | undefined): SelectableProduct | undefined {
  if (!record) return undefined;
  return {
    id: record.id,
    // Un plato de una categoría retirada no está publicado (M4): cuenta como inexistente.
    isActive: record.isActive && record.category.isActive,
    isAvailable: record.isAvailable,
    groups: record.optionGroups.map((g) => ({
      id: g.id,
      isActive: g.isActive,
      minSelect: g.minSelect,
      maxSelect: g.maxSelect,
      options: g.options.map((o) => ({ id: o.id, isAvailable: o.isAvailable })),
    })),
  };
}

function localized(
  rows: readonly { locale: string; name: string | null }[],
  locale: Locale,
  source: string,
): LocalizedText {
  if (locale === 'en') {
    const value = rows.find((r) => r.locale === 'en')?.name;
    if (value && value.trim() !== '') return { text: value, lang: 'en' };
  }
  return { text: source, lang: 'es-CR' };
}

/** Datos de una línea valorizada, más lo que necesita el pedido para su copia histórica. */
export interface ResolvedLine {
  view: CartLineView;
  record: ProductRecord | undefined;
  /** Opciones elegidas con sus etiquetas en el idioma del pedido y en es-CR (§4.5). */
  options: {
    id: string;
    groupLabel: string;
    groupLabelEsCr: string;
    label: string;
    labelEsCr: string;
    priceDeltaMinor: number;
  }[];
  basePriceMinor: number;
  optionsTotalMinor: number;
}

export function resolveLine(
  line: GroupedLine,
  record: ProductRecord | undefined,
  locale: Locale,
): ResolvedLine {
  const reason = selectionProblem(toSelectable(record), line.optionIds);
  const chosen = new Set(line.optionIds);
  const options: ResolvedLine['options'] = [];
  const viewOptions: CartLineView['options'] = [];
  for (const group of record?.optionGroups ?? []) {
    for (const option of group.options) {
      if (!chosen.has(option.id)) continue;
      const groupText = localized(group.translations, locale, group.name);
      const optionText = localized(option.translations, locale, option.name);
      options.push({
        id: option.id,
        groupLabel: groupText.text,
        groupLabelEsCr: group.name,
        label: optionText.text,
        labelEsCr: option.name,
        priceDeltaMinor: option.priceDeltaMinor,
      });
      viewOptions.push({
        id: option.id,
        group: groupText,
        name: optionText,
        priceDeltaMinor: option.priceDeltaMinor,
      });
    }
  }
  const basePriceMinor = record?.basePriceMinor ?? 0;
  const optionsTotalMinor = options.reduce((acc, o) => acc + o.priceDeltaMinor, 0);
  const unitPriceMinor = basePriceMinor + optionsTotalMinor;
  const translatedName =
    locale === 'en' ? (record?.translations.find((t) => t.locale === 'en')?.name ?? null) : null;
  return {
    record,
    options,
    basePriceMinor,
    optionsTotalMinor,
    view: {
      key: line.key,
      productId: line.productId,
      optionIds: line.optionIds,
      quantity: line.quantity,
      slug: record?.slug ?? null,
      categorySlug: record?.category.slug ?? null,
      name: record?.name ?? '',
      translatedName: translatedName && translatedName.trim() !== '' ? translatedName : null,
      options: viewOptions,
      unitPriceMinor,
      lineTotalMinor: unitPriceMinor * line.quantity,
      available: reason === null,
      reason,
    },
  };
}

export interface CartSettings {
  currency: 'CRC' | 'USD';
  minOrderMinor: number;
}

/** Vista del carrito: el subtotal y el mínimo solo cuentan las líneas que se pueden pedir. */
export function cartView(lines: readonly ResolvedLine[], settings: CartSettings): CartView {
  const available = lines.filter((l) => l.view.available);
  const subtotalMinor = available.reduce((acc, l) => acc + l.view.lineTotalMinor, 0);
  return {
    currency: settings.currency,
    lines: lines.map((l) => l.view),
    itemCount: available.reduce((acc, l) => acc + l.view.quantity, 0),
    subtotalMinor,
    minOrderMinor: settings.minOrderMinor,
    // D-M5-4: el mínimo se mide sobre el subtotal de productos (IVA incluido), sin el envío.
    meetsMinimum: subtotalMinor >= settings.minOrderMinor,
  };
}

export async function loadCartSettings(db: Db): Promise<CartSettings> {
  const settings = await db.restaurantSettings.findUnique({
    where: { id: 1 },
    select: { currency: true, minOrderMinor: true },
  });
  return { currency: settings?.currency ?? 'CRC', minOrderMinor: settings?.minOrderMinor ?? 0 };
}
