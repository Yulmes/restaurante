import { startTransition, StrictMode } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { HydratedRouter } from 'react-router/dom';
import { localeFromPathname } from './i18n/locale.ts';

/**
 * Igual que la entrada por defecto de React Router, más el idioma del documento.
 *
 * El hosting sirve el mismo HTML para todas las rutas que no se generan aparte (fallback SPA).
 * Ese HTML se renderizó desde `/`, así que trae `lang="es-CR"` aunque la URL sea `/en/...`.
 * React 19 no corrige atributos distintos al hidratar, y después da el valor por bueno, así que
 * el documento seguía anunciando español al navegar en inglés.
 *
 * Por eso, antes de hidratar, el atributo toma el idioma de la URL con la misma regla que usa
 * `Layout` (`localeFromPathname`). Así el DOM ya coincide con lo que React va a renderizar, y los
 * cambios de idioma posteriores los aplica React al navegar.
 */
document.documentElement.lang = localeFromPathname(window.location.pathname);

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter />
    </StrictMode>,
  );
});
