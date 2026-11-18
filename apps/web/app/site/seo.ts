import type {
  CatalogCategory,
  CatalogProduct,
  CatalogResponse,
  Locale,
  OpeningHoursResponse,
} from '@marea-baja/shared';
import { formatMoney } from '@marea-baja/shared';
import type { MetaDescriptor } from 'react-router';
import { ogImagePath, PAGE_PHOTOS } from '../catalog/images.ts';
import { pathForLocale } from '../i18n/locale.ts';

/**
 * Metadatos por ruta e idioma (§4.2): canónica propia por idioma, `hreflang` es-CR / en /
 * x-default (→ es-CR), Open Graph 1200×630, Twitter card y JSON-LD.
 * `VITE_SITE_URL` es el origen público (se configura en M10); en local, el servidor de Vite.
 */
export const SITE_URL: string = String(import.meta.env['VITE_SITE_URL'] ?? 'http://127.0.0.1:5173').replace(
  /\/+$/,
  '',
);

export const absolute = (path: string): string => `${SITE_URL}${path}`;

const OG_LOCALE: Record<Locale, string> = { 'es-CR': 'es_CR', en: 'en_US' };

export interface SeoInput {
  pathname: string;
  locale: Locale;
  title: string;
  description: string;
  /** Clave de la foto (Open Graph). Por defecto, la foto de marca. */
  imageKey?: string;
  type?: 'website' | 'article';
  jsonLd?: Record<string, unknown> | readonly Record<string, unknown>[];
}

export function seoMeta(input: SeoInput): MetaDescriptor[] {
  const es = pathForLocale(input.pathname, 'es-CR');
  const en = pathForLocale(input.pathname, 'en');
  const image = absolute(ogImagePath(input.imageKey ?? PAGE_PHOTOS.brand));
  const other: Locale = input.locale === 'en' ? 'es-CR' : 'en';
  const meta: MetaDescriptor[] = [
    { title: input.title },
    { name: 'description', content: input.description },
    { tagName: 'link', rel: 'canonical', href: absolute(input.locale === 'en' ? en : es) },
    { tagName: 'link', rel: 'alternate', hrefLang: 'es-CR', href: absolute(es) },
    { tagName: 'link', rel: 'alternate', hrefLang: 'en', href: absolute(en) },
    { tagName: 'link', rel: 'alternate', hrefLang: 'x-default', href: absolute(es) },
    { property: 'og:site_name', content: 'Marea Baja' },
    { property: 'og:type', content: input.type ?? 'website' },
    { property: 'og:title', content: input.title },
    { property: 'og:description', content: input.description },
    { property: 'og:url', content: absolute(input.locale === 'en' ? en : es) },
    { property: 'og:image', content: image },
    { property: 'og:image:width', content: '1200' },
    { property: 'og:image:height', content: '630' },
    { property: 'og:locale', content: OG_LOCALE[input.locale] },
    { property: 'og:locale:alternate', content: OG_LOCALE[other] },
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: input.title },
    { name: 'twitter:description', content: input.description },
    { name: 'twitter:image', content: image },
  ];
  if (input.jsonLd) meta.push({ 'script:ld+json': input.jsonLd });
  return meta;
}

// ─── JSON-LD (§4.2): Restaurant, Menu, MenuSection, MenuItem ─────────────────

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const hhmm = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** Restaurante ficticio: la dirección es la de demostración (§1.1, S7). */
export function restaurantJsonLd(
  locale: Locale,
  hours: OpeningHoursResponse | null,
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    name: 'Marea Baja',
    url: absolute(pathForLocale('/', locale)),
    image: absolute(ogImagePath(PAGE_PHOTOS.brand)),
    servesCuisine: ['Nikkei', 'Ceviche'],
    inLanguage: locale,
    hasMenu: absolute(pathForLocale('/carta', locale)),
    address: {
      '@type': 'PostalAddress',
      streetAddress: 'Calle 33, Barrio Escalante',
      addressLocality: 'San José',
      addressCountry: 'CR',
    },
    ...(hours
      ? {
          openingHoursSpecification: hours.days.map((day) => ({
            '@type': 'OpeningHoursSpecification',
            dayOfWeek: `https://schema.org/${DAY_NAMES[day.dayOfWeek] ?? 'Sunday'}`,
            opens: hhmm(day.opensMinutes),
            closes: hhmm(day.closesMinutes),
          })),
        }
      : {}),
  };
}

const DIETS: Partial<Record<CatalogProduct['tags'][number], string>> = {
  GLUTEN_FREE: 'https://schema.org/GlutenFreeDiet',
  VEGETARIAN: 'https://schema.org/VegetarianDiet',
};

export function menuItemJsonLd(
  product: CatalogProduct,
  category: CatalogCategory,
  locale: Locale,
  currency: CatalogResponse['currency'],
): Record<string, unknown> {
  const diets = product.tags.flatMap((tag) => (DIETS[tag] ? [DIETS[tag]] : []));
  return {
    '@type': 'MenuItem',
    name: product.translatedName ?? product.name,
    description: product.description.text,
    url: absolute(pathForLocale(`/carta/${category.slug}/${product.slug}`, locale)),
    ...(product.image?.provider === 'STATIC'
      ? { image: absolute(ogImagePath(product.image.storageKey)) }
      : {}),
    offers: {
      '@type': 'Offer',
      // Precio con IVA incluido, en la unidad mayor de la moneda.
      price: (product.basePriceMinor / 100).toFixed(2),
      priceCurrency: currency,
      availability: product.isAvailable ? 'https://schema.org/InStock' : 'https://schema.org/SoldOut',
    },
    ...(diets.length > 0 ? { suitableForDiet: diets } : {}),
  };
}

export function menuJsonLd(
  catalog: CatalogResponse,
  categories: readonly CatalogCategory[],
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Menu',
    name: 'Marea Baja',
    inLanguage: catalog.locale,
    hasMenuSection: categories.map((category) => ({
      '@type': 'MenuSection',
      name: category.name.text,
      hasMenuItem: category.products.map((p) =>
        menuItemJsonLd(p, category, catalog.locale, catalog.currency),
      ),
    })),
  };
}

/** Precio legible para descripciones (meta, alt). */
export function priceText(
  amountMinor: number,
  currency: CatalogResponse['currency'],
  locale: Locale,
): string {
  return formatMoney(amountMinor, currency, locale);
}
