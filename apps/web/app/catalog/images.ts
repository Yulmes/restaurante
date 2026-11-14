import type { CatalogImage } from '@marea-baja/shared';

/**
 * `StaticProvider` de `ImageStorageProvider` (§9.4) del lado de la web: la base guarda
 * `provider` + `storageKey` y la URL se arma al leer. Las variantes las genera
 * `scripts/build-images.ts`. Cloudinary y R2 (subidas del admin) llegan en M8 y M10.
 */
export type ImageVariant = 'card' | 'hero' | 'thumb' | 'og';

/**
 * Anchos generados de cada recorte (los usa también `scripts/build-images.ts`). `card` tiene un
 * paso de 720 px para el celular: la foto ocupa el ancho de la pantalla menos los márgenes
 * (unos 380 px CSS), que a densidad 1,75–2 pide entre 665 y 760 px.
 */
export const WIDTHS = {
  card: [480, 720, 960],
  hero: [1000, 2000],
  thumb: [480],
  og: [1200],
} as const satisfies Record<ImageVariant, readonly number[]>;
const RATIO: Record<ImageVariant, number> = { card: 4 / 5, hero: 3 / 2, thumb: 1, og: 1200 / 630 };

export interface PictureSources {
  avif: string;
  webp: string;
  /** `src` de respaldo (WebP, el ancho mayor). */
  fallback: string;
  width: number;
  height: number;
}

function path(key: string, variant: ImageVariant, width: number, format: string): string {
  return `/images/${encodeURIComponent(key)}/${variant}-${String(width)}.${format}`;
}

export function staticPicture(key: string, variant: Exclude<ImageVariant, 'og'>): PictureSources {
  const widths = WIDTHS[variant];
  const largest = widths[widths.length - 1] ?? 960;
  const set = (format: string) =>
    widths.map((w) => `${path(key, variant, w, format)} ${String(w)}w`).join(', ');
  return {
    avif: set('avif'),
    webp: set('webp'),
    fallback: path(key, variant, largest, 'webp'),
    width: largest,
    height: Math.round(largest / RATIO[variant]),
  };
}

/**
 * `sizes` de una foto en media columna de la grilla de página (`max-w-7xl`, 12 columnas, `gap-10`):
 * 588 px desde 1280; entre 768 y 1280, la mitad del ancho menos márgenes y medianil; en el celular,
 * el ancho de la pantalla menos los márgenes de 16 px. Con `100vw` el celular pedía la de 960 px.
 */
export const HALF_COLUMN_SIZES =
  '(min-width: 1280px) 588px, (min-width: 768px) calc(50vw - 3.25rem), calc(100vw - 2rem)';

/** Imagen de Open Graph (JPEG 1200×630), como ruta relativa al sitio. */
export function ogImagePath(key: string): string {
  return path(key, 'og', 1200, 'jpg');
}

export function catalogPicture(
  image: CatalogImage,
  variant: Exclude<ImageVariant, 'og'>,
): PictureSources | null {
  // M4 solo sirve fotos estáticas; otros proveedores llegan con el admin (M8) y M10.
  return image.provider === 'STATIC' ? staticPicture(image.storageKey, variant) : null;
}

/** Fotos de las páginas (M1, CREDITS.md: 18 a 22 se reservaron para las páginas públicas). */
export const PAGE_PHOTOS = {
  catch: '18-pesca-del-dia-hielo',
  craft: '19-oficio-emplatado',
  ingredient: '20-cebolla-morada',
  brand: '21-marea-baja-aerea',
  coast: '22-costa-pacifico',
} as const;
