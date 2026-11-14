import { catalogResponseSchema } from '@marea-baja/shared';
import { pathForLocale } from '../i18n/locale.ts';

/**
 * Rutas públicas que se prerenderizan en los dos idiomas (§4.2) y que van al sitemap.
 * Las de la cuenta, el pedido, el admin y el sistema de diseño usan el fallback SPA con noindex.
 * Los slugs de categorías y platos son iguales en los dos idiomas.
 */
export interface PublicPath {
  es: string;
  en: string;
}

export async function fetchCatalogForBuild(apiBase: string) {
  const url = `${apiBase.replace(/\/+$/, '')}/api/public/catalog?locale=es-CR`;
  let lastError: unknown;
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
      return catalogResponseSchema.parse(await response.json());
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(attempt, 5) * 1000));
    }
  }
  throw new Error(
    `El prerender necesita la API del catálogo en ${apiBase} (CATALOG_API_URL): ${String(lastError)}`,
  );
}

export function publicPaths(catalog: Awaited<ReturnType<typeof fetchCatalogForBuild>>): PublicPath[] {
  const es = [
    '/',
    '/carta',
    '/nosotros',
    '/visitanos',
    ...catalog.categories.flatMap((category) => [
      `/carta/${category.slug}`,
      ...category.products.map((product) => `/carta/${category.slug}/${product.slug}`),
    ]),
  ];
  return es.map((path) => ({ es: path, en: pathForLocale(path, 'en') }));
}

export const catalogApiBase = (): string => process.env['CATALOG_API_URL'] ?? 'http://127.0.0.1:3000';
