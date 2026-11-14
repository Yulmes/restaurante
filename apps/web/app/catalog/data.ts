import {
  catalogResponseSchema,
  catchBoardResponseSchema,
  openingHoursResponseSchema,
  type CatalogCategory,
  type CatalogProduct,
  type CatalogResponse,
  type CatchBoardResponse,
  type Locale,
  type OpeningHoursResponse,
} from '@marea-baja/shared';
import { useQuery } from '@tanstack/react-query';
import { catalogApiBase } from '../site/public-paths.ts';
import type { z } from 'zod';

/**
 * Datos del catálogo (M4, §4.2).
 * - **Build (prerender):** los `loader` de las rutas leen la API pública desde
 *   `CATALOG_API_URL` (por defecto la API local). Si no responde, reintentan y el build falla
 *   con un mensaje claro: nunca se publica una carta vacía.
 * - **Al hidratar (D10):** precios, disponibilidad y pesca del día se vuelven a pedir en vivo a
 *   `/api/public/*` (mismo origen).
 */
const API_BASE = (): string => (typeof process === 'undefined' ? 'http://127.0.0.1:3000' : catalogApiBase());

async function buildFetch<S extends z.ZodType>(path: string, schema: S): Promise<z.output<S>> {
  const url = `${API_BASE().replace(/\/+$/, '')}${path}`;
  let lastError: unknown;
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
      return schema.parse(await response.json());
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(attempt, 5) * 1000));
    }
  }
  throw new Error(
    `No se pudo leer ${path} desde la API del catálogo (${API_BASE()}). ¿Está levantada? ${String(lastError)}`,
  );
}

export function loadCatalog(locale: Locale): Promise<CatalogResponse> {
  return buildFetch(`/api/public/catalog?locale=${encodeURIComponent(locale)}`, catalogResponseSchema);
}

export function loadOpeningHours(): Promise<OpeningHoursResponse> {
  return buildFetch('/api/public/opening-hours', openingHoursResponseSchema);
}

async function liveFetch<S extends z.ZodType>(path: string, schema: S): Promise<z.output<S>> {
  const response = await fetch(path, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
  return schema.parse(await response.json());
}

/** Carta en vivo para superponer precio y disponibilidad sobre el HTML prerenderizado (D10). */
export function useLiveCatalog(locale: Locale) {
  return useQuery({
    queryKey: ['catalog', locale],
    queryFn: () =>
      liveFetch(`/api/public/catalog?locale=${encodeURIComponent(locale)}`, catalogResponseSchema),
    staleTime: 60_000,
    retry: 1,
  });
}

export function useCatchBoard() {
  return useQuery<CatchBoardResponse>({
    queryKey: ['catch-of-the-day'],
    queryFn: () => liveFetch('/api/public/catch-of-the-day', catchBoardResponseSchema),
    staleTime: 60_000,
    retry: 1,
  });
}

/** Precio y disponibilidad vigentes: los vivos si llegaron, si no los del prerender. */
export function liveProduct(
  product: CatalogProduct,
  live: CatalogResponse | undefined,
): Pick<CatalogProduct, 'basePriceMinor' | 'isAvailable' | 'optionGroups'> {
  if (!live) return product;
  for (const category of live.categories) {
    const match = category.products.find((p) => p.slug === product.slug);
    if (match)
      return {
        basePriceMinor: match.basePriceMinor,
        isAvailable: match.isAvailable,
        optionGroups: match.optionGroups,
      };
  }
  // Ya no está publicado: se muestra como no disponible en lugar de ofrecerlo.
  return { ...product, isAvailable: false };
}

export function findProduct(
  catalog: CatalogResponse,
  categorySlug: string,
  productSlug: string,
): { category: CatalogCategory; product: CatalogProduct } | null {
  const category = catalog.categories.find((c) => c.slug === categorySlug);
  const product = category?.products.find((p) => p.slug === productSlug);
  return category && product ? { category, product } : null;
}

/**
 * Plato de la casa en la portada (§2.4: "lo primero que se lee: pesca del día y plato estrella").
 * Aprobado por el propietario el 13/11/2026 (docs/m4/CONTENIDO_EDITORIAL.md): la base no
 * tiene una marca de destacado, así que se elige aquí sin cambiar el esquema.
 */
export const FEATURED_PRODUCT_SLUG = 'ceviche-clasico';
