/**
 * API pública del catálogo (M4, §4.2, D10) contra PostgreSQL real.
 */
import {
  apiErrorBodySchema,
  catalogResponseSchema,
  catchBoardResponseSchema,
  openingHoursResponseSchema,
} from '@marea-baja/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CATEGORIES } from '../prisma/seed-data.ts';
import { DAY } from '../src/lib/clock.ts';
import { buildApi, type TestApi } from './http.ts';

let api: TestApi;
beforeAll(() => {
  api = buildApi();
});
afterAll(async () => {
  await api.close();
});

const get = (path: string) => request(api.app).get(path);
const seedProducts = CATEGORIES.flatMap((c) => c.products);

describe('GET /api/public/catalog', () => {
  it('devuelve la carta en es-CR con el orden, los precios y los textos de la semilla aprobada', async () => {
    const res = await get('/api/public/catalog?locale=es-CR').expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const catalog = catalogResponseSchema.parse(res.body);
    expect(catalog.currency).toBe('CRC');
    expect(catalog.categories.map((c) => c.slug)).toEqual(CATEGORIES.map((c) => c.slug));
    const products = catalog.categories.flatMap((c) => c.products);
    expect(products.map((p) => [p.slug, p.basePriceMinor])).toEqual(
      seedProducts.map((p) => [p.slug, p.basePriceMinor]),
    );
    for (const product of products) {
      expect(product.description.lang).toBe('es-CR');
      expect(product.translatedName).toBeNull();
    }
    const pulpo = products.find((p) => p.slug === 'pulpo-anticuchero');
    expect(pulpo?.isAvailable).toBe(false);
    expect(products.find((p) => p.slug === 'ceviche-clasico')?.optionGroups.map((g) => g.minSelect)).toEqual([
      1, 0,
    ]);
  });

  it('en inglés traduce categorías, descripciones, opciones y alt; el nombre original no cambia', async () => {
    const catalog = catalogResponseSchema.parse(
      (await get('/api/public/catalog?locale=en').expect(200)).body,
    );
    expect(catalog.categories.find((c) => c.slug === 'crudos')?.name).toEqual({
      text: 'Raw dishes',
      lang: 'en',
    });
    const langostinos = catalog.categories
      .flatMap((c) => c.products)
      .find((p) => p.slug === 'langostinos-al-aji-amarillo');
    expect(langostinos).toMatchObject({
      name: 'Langostinos crudos al ají amarillo',
      translatedName: 'Raw prawns with ají amarillo',
      description: { lang: 'en' },
      image: { provider: 'STATIC', storageKey: '11-langostinos-crudos', alt: { lang: 'en' } },
    });
    const ceviche = catalog.categories.flatMap((c) => c.products).find((p) => p.slug === 'ceviche-clasico');
    expect(ceviche?.optionGroups[0]?.name).toEqual({ text: 'Heat level', lang: 'en' });
    expect(ceviche?.optionGroups[0]?.options.map((o) => o.name.text)).toEqual([
      'Mild',
      'With ají limo',
      'Rocoto, for the brave',
    ]);
  });

  it('si falta una traducción, devuelve el texto es-CR marcado con su idioma (§4.5)', async () => {
    const product = await api.db.product.findUniqueOrThrow({
      where: { slug: 'agua-de-pipa' },
      include: { translations: true },
    });
    const translation = product.translations.find((t) => t.locale === 'en');
    await api.db.productTranslation.delete({ where: { id: translation?.id ?? '' } });
    try {
      const catalog = catalogResponseSchema.parse(
        (await get('/api/public/catalog?locale=en').expect(200)).body,
      );
      const agua = catalog.categories.flatMap((c) => c.products).find((p) => p.slug === 'agua-de-pipa');
      expect(agua?.description).toEqual({ text: product.description, lang: 'es-CR' });
      expect(agua?.translatedName).toBeNull();
    } finally {
      await api.db.productTranslation.create({
        data: {
          productId: product.id,
          locale: 'en',
          name: translation?.name ?? null,
          description: translation?.description ?? '',
          altText: translation?.altText ?? null,
        },
      });
    }
  });

  it('no publica platos ni categorías desactivados', async () => {
    await api.db.product.update({ where: { slug: 'chicha-morada' }, data: { isActive: false } });
    try {
      const catalog = catalogResponseSchema.parse((await get('/api/public/catalog').expect(200)).body);
      expect(catalog.categories.flatMap((c) => c.products).map((p) => p.slug)).not.toContain('chicha-morada');
    } finally {
      await api.db.product.update({ where: { slug: 'chicha-morada' }, data: { isActive: true } });
    }
  });

  it('rechaza un idioma no soportado con un código, sin trazas', async () => {
    const res = await get('/api/public/catalog?locale=fr').expect(400);
    expect(apiErrorBodySchema.parse(res.body).error).toMatchObject({
      code: 'VALIDATION_FAILED',
      fields: { locale: 'invalid' },
    });
  });

  it('no expone datos internos (ids de base de los platos, impuestos, fechas)', async () => {
    const body = JSON.stringify((await get('/api/public/catalog').expect(200)).body);
    expect(body).not.toMatch(/"categoryId"|"taxRates"|"createdAt"|"updatedAt"|"isActive"/);
  });
});

describe('precios en vivo y versión del catálogo (D10, R20)', () => {
  it('un cambio de precio o disponibilidad se ve en la siguiente lectura; la versión cambia', async () => {
    const before = catalogResponseSchema.parse((await get('/api/public/catalog').expect(200)).body);
    expect((await get('/api/public/catalog-version').expect(200)).body).toEqual({ version: before.version });

    const original = await api.db.product.findUniqueOrThrow({ where: { slug: 'ceviche-nikkei' } });
    await api.db.product.update({
      where: { slug: 'ceviche-nikkei' },
      data: { basePriceMinor: 990000, isAvailable: false },
    });
    try {
      // catalog-version sale de memoria: sin una lectura de la carta (o una invalidación del admin,
      // M8) no consulta la base.
      expect((await get('/api/public/catalog-version').expect(200)).body).toEqual({
        version: before.version,
      });
      const after = catalogResponseSchema.parse((await get('/api/public/catalog').expect(200)).body);
      const nikkei = after.categories.flatMap((c) => c.products).find((p) => p.slug === 'ceviche-nikkei');
      expect(nikkei).toMatchObject({ basePriceMinor: 990000, isAvailable: false });
      expect(after.version).not.toBe(before.version);
      expect((await get('/api/public/catalog-version').expect(200)).body).toEqual({ version: after.version });
    } finally {
      await api.db.product.update({
        where: { slug: 'ceviche-nikkei' },
        data: { basePriceMinor: original.basePriceMinor, isAvailable: original.isAvailable },
      });
    }
  });

  it('la versión no depende del idioma pedido', async () => {
    const es = catalogResponseSchema.parse((await get('/api/public/catalog?locale=es-CR')).body);
    const en = catalogResponseSchema.parse((await get('/api/public/catalog?locale=en')).body);
    expect(en.version).toBe(es.version);
  });
});

describe('pesca del día y horario', () => {
  it('devuelve la pizarra publicada de hoy con horas locales', async () => {
    const board = catchBoardResponseSchema.parse(
      (await get('/api/public/catch-of-the-day').expect(200)).body,
    ).board;
    expect(board?.isToday).toBe(true);
    expect(board?.items).toEqual([
      { species: 'Corvina', port: 'Puntarenas', arrivedAt: '06:40' },
      { species: 'Pargo rojo', port: 'Golfo de Nicoya', arrivedAt: '07:15' },
      { species: 'Atún aleta amarilla', port: 'Quepos', arrivedAt: '05:55' },
    ]);
  });

  it('al día siguiente muestra la última pizarra con su fecha, sin decir que es de hoy', async () => {
    api.clock.advance(DAY);
    const board = catchBoardResponseSchema.parse(
      (await get('/api/public/catch-of-the-day').expect(200)).body,
    ).board;
    expect(board?.isToday).toBe(false);
    expect(board?.items).toHaveLength(3);
  });

  it('devuelve el horario semanal y las modalidades habilitadas', async () => {
    const hours = openingHoursResponseSchema.parse((await get('/api/public/opening-hours').expect(200)).body);
    expect(hours).toMatchObject({
      timezone: 'America/Costa_Rica',
      pickupEnabled: true,
      deliveryEnabled: true,
    });
    expect(hours.days.map((d) => d.dayOfWeek)).toEqual([0, 2, 3, 4, 5, 6]);
  });
});
