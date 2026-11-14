import type { Locale } from '@marea-baja/shared';
import { useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { localeFromPathname } from './locale.ts';

/** El idioma sale de la URL (§4.2), no de un estado global. */
export function useLocale(): Locale {
  return localeFromPathname(useLocation().pathname);
}

/** Traducciones fijadas al idioma de la ruta actual. */
export function useT<N extends 'common' | 'design' | 'account' = 'common'>(ns?: N) {
  const locale = useLocale();
  return useTranslation(ns ?? 'common', { lng: locale });
}
