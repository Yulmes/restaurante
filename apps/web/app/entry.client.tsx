import { startTransition, StrictMode } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { HydratedRouter } from 'react-router/dom';
import { loadNamespaces, namespacesForPath } from './i18n/config.ts';
import { localeFromPathname } from './i18n/locale.ts';

/**
 * Igual que la entrada por defecto de React Router, pero antes de hidratar carga los textos del
 * idioma y la sección de la página (M4): el HTML prerenderizado y el primer render del navegador
 * usan los mismos textos, sin errores de hidratación. Si la carga falla, se hidrata igual y
 * `useNamespaces` reintenta.
 */
const { pathname } = window.location;

void loadNamespaces(localeFromPathname(pathname), namespacesForPath(pathname))
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
