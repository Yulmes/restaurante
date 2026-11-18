import type { CatalogResponse } from '@marea-baja/shared';
import { describe, expect, it } from 'vitest';
import { robotsTxt, sitemapXml, withNoindex } from '../../scripts/seo-files.ts';
import { liveProduct } from '../catalog/data.ts';
import { ogImagePath, staticPicture } from '../catalog/images.ts';
import { publicPaths } from './public-paths.ts';
import { menuItemJsonLd, menuJsonLd, restaurantJsonLd, seoMeta, SITE_URL } from './seo.ts';

const product = {
  slug: 'ceviche-clasico',
  name: 'Ceviche clásico de corvina',
  translatedName: null,
  description: { text: 'Corvina de Puntarenas…', lang: 'es-CR' as const },
  basePriceMinor: 890000,
  tags: ['GLUTEN_FREE' as const],
  isAvailable: true,
  image: {
    provider: 'STATIC' as const,
    storageKey: '02-ceviche-clasico',
    width: 1600,
    height: 2400,
    alt: { text: 'Ceviche', lang: 'es-CR' as const },
  },
  optionGroups: [],
};
const category = {
  slug: 'ceviches',
  name: { text: 'Ceviches', lang: 'es-CR' as const },
  description: null,
  products: [product],
};
const catalog: CatalogResponse = { locale: 'es-CR', currency: 'CRC', version: 'v1', categories: [category] };

describe('metadatos por idioma (§4.2)', () => {
  it('canónica propia, hreflang es-CR / en / x-default y Open Graph', () => {
    const meta = seoMeta({ pathname: '/en/menu/ceviches', locale: 'en', title: 'T', description: 'D' });
    const links = meta.filter((m) => 'tagName' in m) as { rel: string; hrefLang?: string; href: string }[];
    expect(links).toEqual([
      { tagName: 'link', rel: 'canonical', href: `${SITE_URL}/en/menu/ceviches` },
      { tagName: 'link', rel: 'alternate', hrefLang: 'es-CR', href: `${SITE_URL}/carta/ceviches` },
      { tagName: 'link', rel: 'alternate', hrefLang: 'en', href: `${SITE_URL}/en/menu/ceviches` },
      { tagName: 'link', rel: 'alternate', hrefLang: 'x-default', href: `${SITE_URL}/carta/ceviches` },
    ]);
    expect(meta).toContainEqual({ property: 'og:locale', content: 'en_US' });
    expect(meta).toContainEqual({ property: 'og:locale:alternate', content: 'es_CR' });
    expect(meta).toContainEqual({
      property: 'og:image',
      content: `${SITE_URL}/images/21-marea-baja-aerea/og-1200.jpg`,
    });
    expect(meta).toContainEqual({ name: 'twitter:card', content: 'summary_large_image' });
  });

  it('JSON-LD: restaurante con dirección ficticia y horario; carta con precios en CRC y dietas', () => {
    const restaurant = restaurantJsonLd('es-CR', {
      timezone: 'America/Costa_Rica',
      days: [{ dayOfWeek: 2, opensMinutes: 720, closesMinutes: 1290 }],
      pickupEnabled: true,
      deliveryEnabled: true,
    });
    expect(restaurant).toMatchObject({
      '@type': 'Restaurant',
      address: { streetAddress: 'Calle 33, Barrio Escalante', addressCountry: 'CR' },
      openingHoursSpecification: [
        { dayOfWeek: 'https://schema.org/Tuesday', opens: '12:00', closes: '21:30' },
      ],
    });
    expect(menuItemJsonLd(product, category, 'es-CR', 'CRC')).toMatchObject({
      '@type': 'MenuItem',
      offers: { price: '8900.00', priceCurrency: 'CRC', availability: 'https://schema.org/InStock' },
      suitableForDiet: ['https://schema.org/GlutenFreeDiet'],
    });
    expect(menuJsonLd(catalog, [category])).toMatchObject({
      '@type': 'Menu',
      hasMenuSection: [{ name: 'Ceviches' }],
    });
  });
});

describe('rutas prerenderizadas, sitemap y robots', () => {
  it('lista las páginas públicas en los dos idiomas con segmentos traducidos', () => {
    expect(publicPaths(catalog)).toEqual([
      { es: '/', en: '/en' },
      { es: '/carta', en: '/en/menu' },
      { es: '/nosotros', en: '/en/about' },
      { es: '/visitanos', en: '/en/visit' },
      { es: '/carta/ceviches', en: '/en/menu/ceviches' },
      { es: '/carta/ceviches/ceviche-clasico', en: '/en/menu/ceviches/ceviche-clasico' },
    ]);
  });

  it('el sitemap tiene cada URL con sus alternativas y escapa los caracteres', () => {
    const xml = sitemapXml([{ es: '/carta', en: '/en/menu' }], 'https://x.test');
    expect(xml).toContain('<loc>https://x.test/carta</loc>');
    expect(xml).toContain('<loc>https://x.test/en/menu</loc>');
    expect(xml.match(/hreflang="x-default" href="https:\/\/x.test\/carta"/g)).toHaveLength(2);
    expect(sitemapXml([{ es: '/a&b', en: '/en/a&b' }], 'https://x.test')).toContain('/a&amp;b');
  });

  it('robots bloquea cuenta, pedido, admin y el sistema de diseño en los dos idiomas', () => {
    const robots = robotsTxt('https://x.test');
    for (const path of [
      '/cuenta',
      '/en/account',
      '/pedido',
      '/en/order',
      '/admin',
      '/en/admin',
      '/_design',
    ]) {
      expect(robots).toContain(`Disallow: ${path}\n`);
    }
    expect(robots).toContain('Sitemap: https://x.test/sitemap.xml');
    expect(robots).not.toMatch(/Disallow: \/carta/);
  });

  it('agrega noindex al fallback SPA una sola vez', () => {
    const once = withNoindex('<html><head><title>x</title></head></html>');
    expect(once).toContain('<head><meta name="robots" content="noindex"/>');
    expect(withNoindex(once)).toBe(once);
  });
});

describe('datos en vivo e imágenes', () => {
  it('usa precio y disponibilidad vivos; si el plato dejó de publicarse, lo marca no disponible', () => {
    expect(liveProduct(product, undefined).basePriceMinor).toBe(890000);
    const live: CatalogResponse = {
      ...catalog,
      categories: [{ ...category, products: [{ ...product, basePriceMinor: 950000, isAvailable: false }] }],
    };
    expect(liveProduct(product, live)).toMatchObject({ basePriceMinor: 950000, isAvailable: false });
    expect(liveProduct(product, { ...catalog, categories: [] }).isAvailable).toBe(false);
  });

  it('arma las variantes AVIF/WebP y la de Open Graph del proveedor estático', () => {
    expect(staticPicture('02-ceviche-clasico', 'card')).toEqual({
      avif: '/images/02-ceviche-clasico/card-480.avif 480w, /images/02-ceviche-clasico/card-720.avif 720w, /images/02-ceviche-clasico/card-960.avif 960w',
      webp: '/images/02-ceviche-clasico/card-480.webp 480w, /images/02-ceviche-clasico/card-720.webp 720w, /images/02-ceviche-clasico/card-960.webp 960w',
      fallback: '/images/02-ceviche-clasico/card-960.webp',
      width: 960,
      height: 1200,
    });
    expect(ogImagePath('02-ceviche-clasico')).toBe('/images/02-ceviche-clasico/og-1200.jpg');
  });
});
