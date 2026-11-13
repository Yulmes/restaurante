import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '@marea-baja/shared';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import enAccount from './locales/en/account.json';
import enCommon from './locales/en/common.json';
import enDesign from './locales/en/design.json';
import esAccount from './locales/es-CR/account.json';
import esCommon from './locales/es-CR/common.json';
import esDesign from './locales/es-CR/design.json';

/**
 * Textos centralizados (D2). Los recursos se cargan de forma síncrona para que
 * el prerender de M4 pueda generar el HTML de cada idioma sin esperas.
 */
export const resources = {
  'es-CR': { common: esCommon, design: esDesign, account: esAccount },
  en: { common: enCommon, design: enDesign, account: enAccount },
} as const;

export const i18n = i18next.createInstance();

void i18n.use(initReactI18next).init({
  resources,
  lng: DEFAULT_LOCALE,
  fallbackLng: DEFAULT_LOCALE,
  supportedLngs: [...SUPPORTED_LOCALES],
  ns: ['common', 'design', 'account'],
  defaultNS: 'common',
  interpolation: { escapeValue: false },
  initAsync: false,
  returnNull: false,
});
