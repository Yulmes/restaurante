/**
 * Semilla en la base real: carta bilingüe (D2), valores fiscales (D5), configuración e idempotencia.
 * La lectura de la carta usa Prisma con el rol de la aplicación, como lo hará la API.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../src/db/client.ts';
import { CATCH_ITEMS, CATEGORIES, ROLES } from '../prisma/seed-data.ts';
import { appUrl, inRolledBackTx, ownerUrl, type Query } from './db.ts';

const products = CATEGORIES.flatMap((category) => category.products);
const expectedOptions = products.flatMap((p) => p.optionGroups).flatMap((g) => g.options).length;
const prisma = createPrismaClient(appUrl());
afterAll(() => prisma.$disconnect());

async function counts(q: Query): Promise<Record<string, number>> {
  const tables = [
    'Role',
    'Category',
    'CategoryTranslation',
    'Product',
    'ProductTranslation',
    'ProductImage',
    'ProductOptionGroup',
    'OptionGroupTranslation',
    'ProductOption',
    'OptionTranslation',
    'ProductTaxRate',
    'TaxRate',
    'DeliveryZone',
    'OpeningHours',
    'RestaurantSettings',
    'CatchOfTheDay',
    'CatchItem',
    'User',
  ];
  const result: Record<string, number> = {};
  for (const table of tables) {
    const { rows } = await q(`SELECT count(*)::int AS total FROM "${table}"`);
    result[table] = (rows[0] as { total: number }).total;
  }
  return result;
}

describe('carta semilla', () => {
  it('carga todas las categorías, platos y opciones', async () => {
    const total = await inRolledBackTx(ownerUrl(), counts);
    expect(total).toMatchObject({
      Category: CATEGORIES.length,
      Product: products.length,
      ProductOption: expectedOptions,
      ProductImage: products.filter((p) => p.image).length,
      Role: ROLES.length,
    });
  });

  it('todo texto de la carta tiene su versión en inglés (D2)', async () => {
    const total = await inRolledBackTx(ownerUrl(), counts);
    expect(total['CategoryTranslation']).toBe(total['Category']);
    expect(total['ProductTranslation']).toBe(total['Product']);
    expect(total['OptionGroupTranslation']).toBe(total['ProductOptionGroup']);
    expect(total['OptionTranslation']).toBe(total['ProductOption']);
  });

  it('el rol de la aplicación lee la carta en inglés con Prisma', async () => {
    const product = await prisma.product.findUniqueOrThrow({
      where: { slug: 'langostinos-al-aji-amarillo' },
      include: { translations: true, images: true, category: { include: { translations: true } } },
    });
    expect(product.name).toBe('Langostinos crudos al ají amarillo');
    expect(product.translations).toEqual([
      expect.objectContaining({ locale: 'en', name: 'Raw prawns with ají amarillo' }),
    ]);
    expect(product.images[0]).toMatchObject({ provider: 'STATIC', storageKey: '11-langostinos-crudos' });
    expect(product.category.translations[0]).toMatchObject({ locale: 'en', name: 'Raw bar' });
  });

  it('los nombres originales no llevan traducción salvo los descriptivos (§4.5)', async () => {
    const translated = await prisma.productTranslation.findMany({
      where: { name: { not: null } },
      select: { product: { select: { slug: true } } },
    });
    expect(translated.map((t) => t.product.slug).sort()).toEqual(
      products
        .filter((p) => p.nameEn)
        .map((p) => p.slug)
        .sort(),
    );
  });

  it('marca como agotado el plato previsto, sin desactivarlo', async () => {
    const soldOut = await prisma.product.findMany({
      where: { isAvailable: false },
      select: { slug: true, isActive: true },
    });
    expect(soldOut).toEqual([{ slug: 'pulpo-anticuchero', isActive: true }]);
  });

  it('cada plato tiene el IVA y el cargo de servicio asociados', async () => {
    const withoutTaxes = await prisma.product.count({ where: { taxRates: { none: {} } } });
    expect(withoutTaxes).toBe(0);
    const links = await prisma.productTaxRate.count();
    expect(links).toBe(products.length * 2);
  });
});

describe('configuración semilla', () => {
  it('aplica los valores fiscales de D5: IVA 13 % incluido, servicio 10 % inactivo y solo en el local', async () => {
    const [settings, rates] = await Promise.all([
      prisma.restaurantSettings.findUniqueOrThrow({ where: { id: 1 } }),
      prisma.taxRate.findMany({ orderBy: { key: 'asc' } }),
    ]);
    expect(settings).toMatchObject({
      currency: 'CRC',
      pricesIncludeTax: true,
      roundingIncrementMinor: 100,
      isDemo: true,
    });
    expect(
      rates.map(({ key, rateBps, appliesTo, fulfillmentTypes, isActive }) => ({
        key,
        rateBps,
        appliesTo,
        fulfillmentTypes,
        isActive,
      })),
    ).toEqual([
      {
        key: 'iva',
        rateBps: 1300,
        appliesTo: 'BOTH',
        fulfillmentTypes: ['PICKUP', 'DELIVERY'],
        isActive: true,
      },
      { key: 'servicio', rateBps: 1000, appliesTo: 'ITEMS', fulfillmentTypes: ['DINE_IN'], isActive: false },
    ]);
  });

  it('carga la pizarra de pesca del día de hoy (hora de Costa Rica)', async () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Costa_Rica' }).format(new Date());
    const board = await prisma.catchOfTheDay.findUniqueOrThrow({
      where: { date: new Date(`${today}T00:00:00.000Z`) },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    expect(board.items.map((item) => item.species)).toEqual(CATCH_ITEMS.map((item) => item.species));
  });

  it('no crea usuarios ni contraseñas (las cuentas llegan en M3)', async () => {
    expect(await prisma.user.count()).toBe(0);
  });
});

describe('idempotencia', () => {
  it('ejecutar la semilla otra vez no duplica nada', async () => {
    const before = await inRolledBackTx(ownerUrl(), counts);
    const result = spawnSync('node', ['prisma/seed.ts'], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: { ...process.env, MIGRATION_DATABASE_URL: ownerUrl() },
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
    expect(await inRolledBackTx(ownerUrl(), counts)).toEqual(before);
  });
});
