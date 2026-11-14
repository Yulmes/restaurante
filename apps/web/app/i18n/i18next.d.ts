import 'i18next';
import type account from './locales/es-CR/account.json';
import type common from './locales/es-CR/common.json';
import type design from './locales/es-CR/design.json';
import type site from './locales/es-CR/site.json';

// Tipado de claves: usar una clave que no existe en es-CR es un error de TypeScript.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: { common: typeof common; design: typeof design; account: typeof account; site: typeof site };
  }
}
