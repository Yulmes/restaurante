import type {
  CatalogResponse,
  CatchBoardResponse,
  Locale,
  LocalizedText,
  OpeningHoursResponse,
} from '@marea-baja/shared';
import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.ts';
import type { Clock } from '../../lib/clock.ts';

/**
 * Catálogo público (M4, §4.2):
 * - la carta se lee de la base en cada petición: precios y disponibilidad siempre en vivo (D10);
 * - la versión del catálogo se guarda en memoria y `catalog-version` no toca la base (R20). Se
 *   recalcula con cada lectura de la carta y se puede invalidar (los cambios del admin, M8);
 * - los textos llegan en el idioma pedido o, si falta la traducción, en es-CR marcados (§4.5).
 */
const productInclude = {
  translations: true,
  images: { orderBy: { sortOrder: 'asc' } },
  optionGroups: {
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
    include: {
      translations: true,
      options: { orderBy: { sortOrder: 'asc' }, include: { translations: true } },
    },
  },
} as const satisfies Prisma.ProductInclude;

type ProductRow = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

type Translated = { locale: 'es_CR' | 'en' } & Record<string, unknown>;

function pick<T extends Translated>(
  rows: readonly T[],
  locale: Locale,
  field: keyof T,
  source: string,
): LocalizedText {
  if (locale === 'en') {
    const value = rows.find((row) => row.locale === 'en')?.[field];
    if (typeof value === 'string' && value.trim() !== '') return { text: value, lang: 'en' };
  }
  return { text: source, lang: 'es-CR' };
}

function toProduct(
  row: ProductRow,
  locale: Locale,
): CatalogResponse['categories'][number]['products'][number] {
  const image = row.images[0];
  const en = row.translations.find((t) => t.locale === 'en');
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    translatedName: locale === 'en' && en?.name ? en.name : null,
    description: pick(row.translations, locale, 'description', row.description),
    basePriceMinor: row.basePriceMinor,
    tags: row.tags,
    isAvailable: row.isAvailable,
    image: image
      ? {
          provider: image.provider,
          storageKey: image.storageKey,
          width: image.width,
          height: image.height,
          alt: pick(row.translations, locale, 'altText', image.alt),
        }
      : null,
    optionGroups: row.optionGroups.map((group) => ({
      id: group.id,
      name: pick(group.translations, locale, 'name', group.name),
      minSelect: group.minSelect,
      maxSelect: group.maxSelect,
      options: group.options.map((option) => ({
        id: option.id,
        name: pick(option.translations, locale, 'name', option.name),
        priceDeltaMinor: option.priceDeltaMinor,
        isDefault: option.isDefault,
        isAvailable: option.isAvailable,
      })),
    })),
  };
}

/** Fecha local `YYYY-MM-DD` y hora `HH:mm` en la zona del restaurante. */
function localDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(date);
}
function localTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

export class CatalogService {
  readonly #db: PrismaClient;
  readonly #clock: Clock;
  #version: string | null = null;

  constructor(db: PrismaClient, clock: Clock) {
    this.#db = db;
    this.#clock = clock;
  }

  async catalog(locale: Locale): Promise<CatalogResponse> {
    const [settings, categories] = await Promise.all([
      this.#db.restaurantSettings.findUnique({ where: { id: 1 }, select: { currency: true } }),
      this.#db.category.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
        include: {
          translations: true,
          products: { where: { isActive: true }, orderBy: { sortOrder: 'asc' }, include: productInclude },
        },
      }),
    ]);
    // La versión no depende del idioma: se calcula sobre los datos con todas sus traducciones.
    this.#version = createHash('sha256').update(JSON.stringify(categories)).digest('base64url').slice(0, 16);
    return {
      locale,
      currency: settings?.currency ?? 'CRC',
      version: this.#version,
      categories: categories.map((category) => ({
        slug: category.slug,
        name: pick(category.translations, locale, 'name', category.name),
        description:
          category.description === null
            ? null
            : pick(category.translations, locale, 'description', category.description),
        products: category.products.map((product) => toProduct(product, locale)),
      })),
    };
  }

  /** Desde memoria; solo la primera consulta tras reiniciar lee la base (§4.2, R20). */
  async version(): Promise<string> {
    if (this.#version === null) await this.catalog('es-CR');
    return this.#version ?? '';
  }

  /** Para los servicios que cambien el catálogo (admin, M8). */
  invalidateVersion(): void {
    this.#version = null;
  }

  /** Última pizarra publicada con fecha de hoy o anterior (hora de Costa Rica). */
  async catchBoard(): Promise<CatchBoardResponse> {
    const settings = await this.#db.restaurantSettings.findUnique({
      where: { id: 1 },
      select: { timezone: true },
    });
    const timeZone = settings?.timezone ?? 'America/Costa_Rica';
    const today = localDate(this.#clock.now(), timeZone);
    const board = await this.#db.catchOfTheDay.findFirst({
      where: { publishedAt: { not: null }, date: { lte: new Date(`${today}T00:00:00.000Z`) } },
      orderBy: { date: 'desc' },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!board) return { board: null };
    const date = board.date.toISOString().slice(0, 10);
    return {
      board: {
        date,
        isToday: date === today,
        items: board.items.map((item) => ({
          species: item.species,
          port: item.port,
          arrivedAt: localTime(item.arrivedAt, timeZone),
        })),
      },
    };
  }

  async openingHours(): Promise<OpeningHoursResponse> {
    const settings = await this.#db.restaurantSettings.findUnique({
      where: { id: 1 },
      include: { openingHours: { orderBy: [{ dayOfWeek: 'asc' }, { opensMinutes: 'asc' }] } },
    });
    return {
      timezone: settings?.timezone ?? 'America/Costa_Rica',
      days: (settings?.openingHours ?? []).map((h) => ({
        dayOfWeek: h.dayOfWeek,
        opensMinutes: h.opensMinutes,
        closesMinutes: h.closesMinutes,
      })),
      pickupEnabled: settings?.pickupEnabled ?? false,
      deliveryEnabled: settings?.deliveryEnabled ?? false,
    };
  }
}
