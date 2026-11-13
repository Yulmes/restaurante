# ADR 0001 · Biblioteca de internacionalización: i18next + react-i18next

- **Estado:** aceptado (decisión técnica menor dentro de D2, propuesta §4.4)
- **Fecha:** 10/11/2026 · Hito M1

## Contexto

D2 exige es-CR y en desde la v1, textos centralizados, plurales y SEO por idioma con prerender (M4). La propuesta dejaba elegir entre opciones maduras, por ejemplo react-i18next o Lingui.

## Decisión

**i18next 26.5.11 + react-i18next 17.1.9.**

## Motivos

1. **Recursos síncronos** (`initAsync: false`): el prerender de M4 puede generar el HTML de cada idioma sin esperas ni carga diferida.
2. **Mensajes en JSON plano**, editables sin herramientas especiales. Encaja con una futura edición de traducciones del catálogo desde el admin (M8).
3. **Sin paso de compilación con macros:** Lingui necesita un plugin de Babel o SWC y un catálogo compilado, lo que suma complejidad al build de React Router.
4. **Tipado de claves** con `CustomTypeOptions`: una clave inexistente es un error de TypeScript.

## Consecuencias

- El idioma se pasa por ruta con `useTranslation(ns, { lng })` (hook `useT`). No se usa un idioma global mutable.
- La paridad de claves entre idiomas no la garantiza i18next: la cubren `messages.test.ts` y la regla de lint de textos literales.
