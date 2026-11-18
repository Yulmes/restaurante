import enAccount from './locales/en/account.json';
import enCommon from './locales/en/common.json';
import enDesign from './locales/en/design.json';
import enSite from './locales/en/site.json';
import esAccount from './locales/es-CR/account.json';
import esCommon from './locales/es-CR/common.json';
import esDesign from './locales/es-CR/design.json';
import esSite from './locales/es-CR/site.json';

/**
 * Todos los textos (D2), cargados de forma síncrona. Solo los usan el prerender (build en Node)
 * y las pruebas. El navegador no importa este módulo: pide cada idioma y espacio por separado
 * (`loadNamespaces` en `config.ts`).
 */
export const resources = {
  'es-CR': { common: esCommon, design: esDesign, account: esAccount, site: esSite },
  en: { common: enCommon, design: enDesign, account: enAccount, site: enSite },
} as const;
