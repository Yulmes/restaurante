/**
 * Semilla de Marea Baja (M2): carta bilingüe, configuración, impuestos (D5), zonas, horarios,
 * roles y una pizarra de pesca del día. Uso: `npm run db:seed -w @marea-baja/api`.
 *
 * Es idempotente: se puede ejecutar varias veces sin duplicar datos. Las entidades con clave
 * estable (slug, key, día) se actualizan; los grupos de opciones y las fotos de un plato solo se
 * crean si el plato todavía no tiene, para no romper carritos ni pedidos que ya los usen.
 * Corre con el rol propietario (`MIGRATION_DATABASE_URL`).
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPrismaClient } from '../src/db/client.ts';
import type { Prisma } from '../src/generated/prisma/client.ts';
import {
  CATCH_ITEMS,
  CATEGORIES,
  DELIVERY_ZONES,
  OPENING_HOURS,
  ROLES,
  SETTINGS,
  TAX_RATES,
} from './seed-data.ts';

const rootEnvFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile);

const url = process.env['MIGRATION_DATABASE_URL'];
if (!url) throw new Error('Falta MIGRATION_DATABASE_URL.');

/** Fecha de hoy en Costa Rica (UTC−6, sin horario de verano), como AAAA-MM-DD. */
function todayInCostaRica(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: SETTINGS.timezone }).format(new Date());
}

const prisma = createPrismaClient(url);

async function seed(tx: Prisma.TransactionClient): Promise<void> {
  for (const key of ROLES) {
    await tx.role.upsert({ where: { key }, update: {}, create: { key } });
  }

  await tx.restaurantSettings.upsert({ where: { id: 1 }, update: SETTINGS, create: { id: 1, ...SETTINGS } });
  for (const hours of OPENING_HOURS) {
    await tx.openingHours.upsert({
      where: {
        settingsId_dayOfWeek_opensMinutes: {
          settingsId: 1,
          dayOfWeek: hours.dayOfWeek,
          opensMinutes: hours.opensMinutes,
        },
      },
      update: { closesMinutes: hours.closesMinutes },
      create: { settingsId: 1, ...hours },
    });
  }

  const taxRateIds: string[] = [];
  for (const rate of TAX_RATES) {
    const data = { ...rate, fulfillmentTypes: [...rate.fulfillmentTypes] };
    const saved = await tx.taxRate.upsert({ where: { key: rate.key }, update: data, create: data });
    taxRateIds.push(saved.id);
  }

  for (const [index, zone] of DELIVERY_ZONES.entries()) {
    const data = { ...zone, districts: [...zone.districts], sortOrder: index };
    await tx.deliveryZone.upsert({ where: { key: zone.key }, update: data, create: data });
  }

  for (const [categoryIndex, category] of CATEGORIES.entries()) {
    const savedCategory = await tx.category.upsert({
      where: { slug: category.slug },
      update: { name: category.name.es, description: category.description.es, sortOrder: categoryIndex },
      create: {
        slug: category.slug,
        name: category.name.es,
        description: category.description.es,
        sortOrder: categoryIndex,
      },
    });
    await tx.categoryTranslation.upsert({
      where: { categoryId_locale: { categoryId: savedCategory.id, locale: 'en' } },
      update: { name: category.name.en, description: category.description.en },
      create: {
        categoryId: savedCategory.id,
        locale: 'en',
        name: category.name.en,
        description: category.description.en,
      },
    });

    for (const [productIndex, product] of category.products.entries()) {
      const productData = {
        categoryId: savedCategory.id,
        name: product.name,
        description: product.description.es,
        basePriceMinor: product.basePriceMinor,
        tags: [...product.tags],
        isAvailable: product.isAvailable ?? true,
        sortOrder: productIndex,
      };
      const saved = await tx.product.upsert({
        where: { slug: product.slug },
        update: productData,
        create: { slug: product.slug, ...productData },
        include: { optionGroups: { select: { id: true } }, images: { select: { id: true } } },
      });

      const translation = {
        name: product.nameEn ?? null,
        description: product.description.en,
        altText: product.image?.alt.en ?? null,
      };
      await tx.productTranslation.upsert({
        where: { productId_locale: { productId: saved.id, locale: 'en' } },
        update: translation,
        create: { productId: saved.id, locale: 'en', ...translation },
      });

      for (const taxRateId of taxRateIds) {
        await tx.productTaxRate.upsert({
          where: { productId_taxRateId: { productId: saved.id, taxRateId } },
          update: {},
          create: { productId: saved.id, taxRateId },
        });
      }

      if (product.image && saved.images.length === 0) {
        await tx.productImage.create({
          data: {
            productId: saved.id,
            provider: 'STATIC',
            storageKey: product.image.storageKey,
            width: product.image.width,
            height: product.image.height,
            alt: product.image.alt.es,
          },
        });
      }

      if (saved.optionGroups.length === 0) {
        for (const [groupIndex, group] of product.optionGroups.entries()) {
          await tx.productOptionGroup.create({
            data: {
              productId: saved.id,
              name: group.name.es,
              minSelect: group.minSelect,
              maxSelect: group.maxSelect,
              sortOrder: groupIndex,
              translations: { create: { locale: 'en', name: group.name.en } },
              options: {
                create: group.options.map((option, optionIndex) => ({
                  name: option.name.es,
                  priceDeltaMinor: option.priceDeltaMinor,
                  isDefault: option.isDefault ?? false,
                  sortOrder: optionIndex,
                  translations: { create: { locale: 'en', name: option.name.en } },
                })),
              },
            },
          });
        }
      }
    }
  }

  const today = todayInCostaRica();
  const catchOfTheDay = await tx.catchOfTheDay.upsert({
    where: { date: new Date(`${today}T00:00:00.000Z`) },
    update: {},
    create: { date: new Date(`${today}T00:00:00.000Z`), publishedAt: new Date() },
    include: { items: { select: { id: true } } },
  });
  if (catchOfTheDay.items.length === 0) {
    await tx.catchItem.createMany({
      data: CATCH_ITEMS.map((item, index) => ({
        catchId: catchOfTheDay.id,
        species: item.species,
        port: item.port,
        arrivedAt: new Date(`${today}T${item.arrivedAt}:00.000-06:00`),
        sortOrder: index,
      })),
    });
  }
}

try {
  await prisma.$transaction(seed, { timeout: 60_000 });
  const [categories, products, options] = await Promise.all([
    prisma.category.count(),
    prisma.product.count(),
    prisma.productOption.count(),
  ]);
  console.log(
    `Semilla aplicada: ${String(categories)} categorías, ${String(products)} platos, ${String(options)} opciones.`,
  );
} finally {
  await prisma.$disconnect();
}
