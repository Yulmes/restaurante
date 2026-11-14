import { z } from 'zod';

/**
 * Idiomas soportados (decisión D2): español de Costa Rica por defecto e inglés desde la v1.
 * Los textos traducidos no viven aquí: cada app tiene sus propios archivos de mensajes.
 */
export const SUPPORTED_LOCALES = ['es-CR', 'en'] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'es-CR';

export const localeSchema = z.enum(SUPPORTED_LOCALES);

export function isLocale(value: unknown): value is Locale {
  return localeSchema.safeParse(value).success;
}

/**
 * Idioma válido a partir de cualquier valor: si no es uno de los soportados, el predeterminado.
 * Una preferencia guardada mal (o ausente) nunca deja la aplicación sin idioma (M3).
 */
export function resolveLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}
