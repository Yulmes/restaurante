import { resolveLocale } from '@marea-baja/shared';
import { pathForLocale } from '../i18n/locale.ts';
import { useLocale } from '../i18n/use-locale.ts';

/** Convierte una ruta en español (`/cuenta/ingresar`) en la del idioma actual. */
export function useLocalizedPath(): (esPath: string) => string {
  const locale = useLocale();
  return (esPath) => pathForLocale(esPath, locale);
}

/** Página de la cuenta en el idioma preferido; un valor inválido abre la de es-CR. */
export function accountPathFor(locale: unknown): string {
  return pathForLocale('/cuenta', resolveLocale(locale));
}

/** Lee `#token=…` de la URL. El token va en el fragmento: nunca llega a un servidor (§8.7). */
export function tokenFromHash(hash: string): string | null {
  const token = new URLSearchParams(hash.replace(/^#/, '')).get('token');
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}
