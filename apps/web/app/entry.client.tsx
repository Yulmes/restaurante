import { startTransition, StrictMode } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { HydratedRouter } from 'react-router/dom';
import { loadNamespaces, namespacesForPath } from './i18n/config.ts';
import { localeFromPathname } from './i18n/locale.ts';

/**
 * Igual que la entrada por defecto de React Router, con dos pasos antes de hidratar:
 *
 * 1. Idioma del documento (M3). El hosting sirve el fallback SPA (renderizado desde `/`, con
 *    `lang="es-CR"`) para toda ruta sin HTML propio, también a `/en/...`. React 19 no corrige
 *    atributos distintos al hidratar y después da el valor por bueno, así que el documento
 *    anunciaba español al navegar en inglés. El atributo toma el idioma de la URL con la misma
 *    regla que usa `Layout` (`localeFromPathname`), antes de cualquier espera.
 * 2. Textos del idioma y la sección de la página (M4): el HTML prerenderizado y el primer render
 *    del navegador usan los mismos textos, sin errores de hidratación. Si la carga falla, se
 *    hidrata igual y `useNamespaces` reintenta.
 */
const { pathname } = window.location;
const locale = localeFromPathname(pathname);

document.documentElement.lang = locale;

void loadNamespaces(locale, namespacesForPath(pathname))
  .catch(() => undefined)
  .then(() => {
    startTransition(() => {
      hydrateRoot(
        document,
        <StrictMode>
          <HydratedRouter />
        </StrictMode>,
      );
    });
  });
