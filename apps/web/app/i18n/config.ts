import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale } from '@marea-baja/shared';
import i18next from 'i18next';
import { use } from 'react';
import { initReactI18next } from 'react-i18next';
import { pathForLocale } from './locale.ts';
import { resources } from './resources.ts';

/**
 * Textos centralizados (D2).
 *
 * - **Prerender y pruebas** (Node): todos los idiomas y espacios, síncronos, para generar el
 *   HTML de cada idioma sin esperas.
 * - **Navegador:** solo el idioma de la página y los espacios que usa (`namespacesForPath`).
 *   Cada archivo de `locales/` es un fragmento propio que se pide al hidratar y al navegar,
 *   así el otro idioma y los espacios de otras secciones no compiten con la carga inicial (M4).
 */
export type Namespace = 'common' | 'design' | 'account' | 'site' | 'order';

// En el build del navegador esta condición es falsa y `resources` queda fuera del paquete.
const BUNDLED = import.meta.env.SSR || import.meta.env.MODE === 'test';

export const i18n = i18next.createInstance();

void i18n.use(initReactI18next).init({
  ...(BUNDLED ? { resources } : {}),
  lng: DEFAULT_LOCALE,
  fallbackLng: DEFAULT_LOCALE,
  supportedLngs: [...SUPPORTED_LOCALES],
  ns: ['common', 'design', 'account', 'site', 'order'],
  defaultNS: 'common',
  interpolation: { escapeValue: false },
  initAsync: false,
  returnNull: false,
});

// Un fragmento por idioma y espacio. En el prerender no hace falta: ya están todos en `resources`.
const loaders: Record<string, () => Promise<Record<string, unknown>>> = BUNDLED
  ? {}
  : import.meta.glob<Record<string, unknown>>('./locales/*/*.json', { import: 'default' });
const pending = new Map<string, Promise<void>>();

/** Espacios que necesita una ruta: `common` y `site` (marco público) siempre; los demás por sección. */
export function namespacesForPath(pathname: string): Namespace[] {
  const [section] = pathForLocale(pathname, DEFAULT_LOCALE).split('/').filter(Boolean);
  // M5: la cuenta incluye las direcciones (textos del pedido); el pedido, también los de la cuenta.
  if (section === 'cuenta') return ['common', 'site', 'account', 'order'];
  if (section === 'pedido') return ['common', 'site', 'order'];
  // M7: el Pase usa los textos del pedido (estados, pagos y el propio Pase).
  if (section === 'admin') return ['common', 'site', 'order'];
  if (section === '_design') return ['common', 'site', 'design'];
  return ['common', 'site'];
}

function missingNamespaces(locale: Locale, namespaces: readonly Namespace[]): Namespace[] {
  return namespaces.filter((ns) => !i18n.hasResourceBundle(locale, ns));
}

/** Carga (una sola vez) los espacios que falten de un idioma. Si una carga falla, se reintenta la próxima vez. */
export function loadNamespaces(locale: Locale, namespaces: readonly Namespace[]): Promise<void> {
  const missing = missingNamespaces(locale, namespaces);
  if (missing.length === 0) return Promise.resolve();
  const key = `${locale}:${missing.join(',')}`;
  const cached = pending.get(key);
  if (cached) return cached;
  const promise = Promise.all(
    missing.map(async (ns) => {
      const load = loaders[`./locales/${locale}/${ns}.json`];
      if (!load) throw new Error(`No existen los textos "${ns}" para ${locale}.`);
      i18n.addResourceBundle(locale, ns, await load(), true, true);
    }),
  )
    .then(() => undefined)
    .finally(() => pending.delete(key));
  pending.set(key, promise);
  return promise;
}

/**
 * Suspende el render hasta que estén los textos de la ruta. Al hidratar ya están (los carga
 * `entry.client.tsx`). Al navegar a otro idioma o sección, React Router navega dentro de una
 * transición y mantiene la página anterior hasta que llegan, sin mostrar claves sueltas.
 */
export function useNamespaces(locale: Locale, namespaces: readonly Namespace[]): void {
  if (missingNamespaces(locale, namespaces).length > 0) use(loadNamespaces(locale, namespaces));
}
