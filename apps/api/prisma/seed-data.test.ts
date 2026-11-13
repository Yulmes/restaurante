import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CURRENCIES, SUPPORTED_LOCALES } from '@marea-baja/shared';
import { describe, expect, it } from 'vitest';
import { Currency, Locale } from '../src/generated/prisma/enums.ts';
import { CATEGORIES, DELIVERY_ZONES, OPENING_HOURS, SETTINGS, TAX_RATES } from './seed-data.ts';

const PHOTOS_DIR = fileURLToPath(new URL('../../web/photos/source/', import.meta.url));
const products = CATEGORIES.flatMap((category) => category.products);

/** Ancho y alto de un JPEG, leídos del marcador SOF. */
function jpegSize(file: string): { width: number; height: number } {
  const bytes = readFileSync(file);
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1] ?? 0;
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isStartOfFrame) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    offset += 2 + bytes.readUInt16BE(offset + 2);
  }
  throw new Error(`No se encontró el tamaño de ${file}`);
}

describe('enumeraciones de Prisma frente a @marea-baja/shared', () => {
  it('los idiomas coinciden (Prisma guarda es-CR con @map)', () => {
    expect(Object.values(Locale).map((value) => value.replace('_', '-'))).toEqual([...SUPPORTED_LOCALES]);
  });

  it('las monedas coinciden', () => {
    expect(Object.values(Currency)).toEqual(Object.keys(CURRENCIES));
  });
});

describe('carta semilla', () => {
  it('tiene slugs únicos, en minúsculas y con guiones', () => {
    const slugs = [...CATEGORIES.map((c) => c.slug), ...products.map((p) => p.slug)];
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  it('cada categoría y cada plato tiene texto en es-CR y en (D2)', () => {
    for (const category of CATEGORIES) {
      expect(
        category.name.es && category.name.en && category.description.es && category.description.en,
      ).toBeTruthy();
    }
    for (const product of products) {
      expect(product.name.trim()).not.toBe('');
      expect(product.description.es.trim()).not.toBe('');
      expect(product.description.en.trim()).not.toBe('');
      expect(product.description.en).not.toBe(product.description.es);
      for (const group of product.optionGroups) {
        expect(group.name.en.trim()).not.toBe('');
        for (const option of group.options) expect(option.name.en.trim()).not.toBe('');
      }
    }
  });

  it('"Sin gluten" solo donde todos los ingredientes son simples y conocidos (revisión de etiquetas)', () => {
    // Las preparaciones sin receta en los datos (leches de tigre, glaseados, cremas, purés) no
    // permiten garantizar la etiqueta: hoy solo la llevan las bebidas (docs/m2/CARTA_SEMILLA.md).
    const glutenFree = products.filter((p) => p.tags.includes('GLUTEN_FREE')).map((p) => p.slug);
    expect(glutenFree.sort()).toEqual(['agua-de-pipa', 'chicha-morada', 'limonada-de-hierbabuena']);
    const withGluten = /soya|shoyu|ponzu|panko|empanizad|chicharr|leche de tigre|crema|glasead|puré/i;
    for (const product of products.filter((p) => withGluten.test(p.description.es))) {
      expect(product.tags, product.slug).not.toContain('GLUTEN_FREE');
    }
  });

  it('los precios son enteros en céntimos, positivos y al colón entero', () => {
    for (const product of products) {
      expect(Number.isSafeInteger(product.basePriceMinor)).toBe(true);
      expect(product.basePriceMinor).toBeGreaterThan(0);
      expect(product.basePriceMinor % SETTINGS.roundingIncrementMinor).toBe(0);
      for (const option of product.optionGroups.flatMap((g) => g.options)) {
        expect(Number.isSafeInteger(option.priceDeltaMinor)).toBe(true);
        expect(option.priceDeltaMinor).toBeGreaterThanOrEqual(0);
        expect(option.priceDeltaMinor % SETTINGS.roundingIncrementMinor).toBe(0);
      }
    }
  });

  it('los grupos de opciones son coherentes: mínimo ≤ máximo ≤ opciones y un solo valor por defecto', () => {
    for (const group of products.flatMap((p) => p.optionGroups)) {
      expect(group.minSelect).toBeGreaterThanOrEqual(0);
      expect(group.maxSelect).toBeGreaterThanOrEqual(Math.max(1, group.minSelect));
      expect(group.maxSelect).toBeLessThanOrEqual(group.options.length);
      expect(group.options.filter((o) => o.isDefault).length).toBeLessThanOrEqual(1);
    }
  });

  it('cada foto existe entre las aprobadas, con el tamaño declarado, y no se repite', () => {
    const approved = new Set(readdirSync(PHOTOS_DIR).map((file) => file.replace(/\.jpg$/, '')));
    const used = products.flatMap((p) => (p.image ? [p.image] : []));
    expect(new Set(used.map((image) => image.storageKey)).size).toBe(used.length);
    for (const image of used) {
      expect(approved.has(image.storageKey), image.storageKey).toBe(true);
      expect(jpegSize(`${PHOTOS_DIR}${image.storageKey}.jpg`)).toEqual({
        width: image.width,
        height: image.height,
      });
      expect(image.alt.es.trim()).not.toBe('');
      expect(image.alt.en.trim()).not.toBe('');
    }
  });

  it('no usa la foto 13, descartada', () => {
    expect(products.some((p) => p.image?.storageKey.startsWith('13-'))).toBe(false);
  });
});

describe('configuración semilla', () => {
  it('aplica los valores fiscales aprobados (D5): IVA 13 % incluido y servicio 10 % inactivo', () => {
    expect(SETTINGS.pricesIncludeTax).toBe(true);
    expect(SETTINGS.currency).toBe('CRC');
    const iva = TAX_RATES.find((rate) => rate.key === 'iva');
    const servicio = TAX_RATES.find((rate) => rate.key === 'servicio');
    expect(iva).toMatchObject({ rateBps: 1300, appliesTo: 'BOTH', isActive: true });
    expect(iva?.fulfillmentTypes).toEqual(['PICKUP', 'DELIVERY']);
    expect(servicio).toMatchObject({ rateBps: 1000, appliesTo: 'ITEMS', isActive: false });
    expect(servicio?.fulfillmentTypes).toEqual(['DINE_IN']);
  });

  it('DINE_IN solo aparece en un cargo inactivo (D4, C10)', () => {
    for (const rate of TAX_RATES) {
      if ((rate.fulfillmentTypes as readonly string[]).includes('DINE_IN')) expect(rate.isActive).toBe(false);
    }
  });

  it('el redondeo es al colón entero (100 céntimos) y el pedido mínimo está en céntimos', () => {
    expect(SETTINGS.roundingIncrementMinor).toBe(100);
    expect(SETTINGS.minOrderMinor % 100).toBe(0);
  });

  it('los horarios son válidos y no se repiten por día', () => {
    expect(new Set(OPENING_HOURS.map((h) => h.dayOfWeek)).size).toBe(OPENING_HOURS.length);
    for (const hours of OPENING_HOURS) {
      expect(hours.dayOfWeek).toBeGreaterThanOrEqual(0);
      expect(hours.dayOfWeek).toBeLessThanOrEqual(6);
      expect(hours.opensMinutes).toBeLessThan(hours.closesMinutes);
      expect(hours.closesMinutes).toBeLessThanOrEqual(1440);
    }
  });

  it('las zonas de delivery tienen clave única y tarifa al colón entero', () => {
    expect(new Set(DELIVERY_ZONES.map((z) => z.key)).size).toBe(DELIVERY_ZONES.length);
    for (const zone of DELIVERY_ZONES) expect(zone.feeMinor % 100).toBe(0);
  });
});
