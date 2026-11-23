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

/**
 * Destino después de iniciar sesión (`?next=`), solo si es una página del pedido de este sitio
 * (M5: volver al checkout). Cualquier otro valor se ignora: nunca redirige a otro origen.
 */
export function safeNextPath(value: string | null): string | null {
  if (!value) return null;
  // Solo rutas propias del pedido: sin `//`, sin barras invertidas ni otro esquema u origen.
  return /^\/(?:en\/order|pedido)(?:\/[\w-]+)*$/.test(value) ? value : null;
}
