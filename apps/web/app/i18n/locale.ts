import { DEFAULT_LOCALE, type Locale } from '@marea-baja/shared';

/**
 * Rutas por idioma (§4.2): es-CR sin prefijo, inglés con prefijo /en.
 * Los segmentos fijos se traducen con SEGMENTS (en M4 se agregan carta → menu, etc.).
 */
const SEGMENTS: Record<string, string> = {
  _design: '_design',
};
const REVERSE_SEGMENTS = Object.fromEntries(Object.entries(SEGMENTS).map(([es, en]) => [en, es]));

export const EN_PREFIX = '/en';

export function localeFromPathname(pathname: string): Locale {
  return pathname === EN_PREFIX || pathname.startsWith(`${EN_PREFIX}/`) ? 'en' : DEFAULT_LOCALE;
}

function splitPath(pathname: string): string[] {
  return pathname.split('/').filter(Boolean);
}

/** Convierte una ruta de cualquier idioma en la misma página del idioma pedido. */
export function pathForLocale(pathname: string, target: Locale): string {
  const current = localeFromPathname(pathname);
  let segments = splitPath(pathname);
  if (current === 'en') {
    segments = segments.slice(1).map((s) => REVERSE_SEGMENTS[s] ?? s);
  }
  if (target === 'en') {
    const translated = segments.map((s) => SEGMENTS[s] ?? s);
    return [EN_PREFIX, ...translated].join('/');
  }
  return `/${segments.join('/')}`;
}
