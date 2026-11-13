# ADR 0004 · Plantillas de correo con MJML compilado

- **Estado:** aceptado (decisión técnica que la propuesta deja para M3: §8.5, "React Email o MJML; se decide en M3, con un ADR").
- **Hito:** M3 · Identidad
- **Relacionado:** propuesta §8.5 (correos, D6), §4.5 (i18n, D2), ADR 0003 (la API corre `.ts` sin compilar).

## Contexto

Las plantillas deben estar en es-CR y en, ser compatibles con Gmail y Outlook (tablas), tener versión de texto plano y llevar la marca (wordmark, línea de marea, paleta Tinta/Espuma y el pie de demostración).

La API se ejecuta con `node archivo.ts`, sin paso de compilación (ADR 0003). Node quita los tipos de los `.ts`, pero no transforma JSX.

## Opciones evaluadas

| Opción | A favor | En contra |
|---|---|---|
| React Email | Componentes en TSX, el mismo lenguaje que la web | Necesita JSX en la API: obliga a sumar un paso de compilación o un cargador (`tsx`) solo para los correos. Suma React y sus paquetes a las dependencias de producción de la API |
| **MJML** | Lenguaje de marcado pensado para correos; genera tablas compatibles con Outlook y Gmail | El paquete `mjml` arrastra dependencias con avisos de seguridad moderados (`glob`/`minimatch` vía `js-beautify`, 13/11/2026) |

## Decisión

**MJML, usado solo como herramienta de desarrollo.**

- La plantilla vive en `apps/api/src/modules/notifications/templates/layout.mjml`.
- `npm run emails:build -w @marea-baja/api` la compila a `layout.html`, que **se versiona**.
- En ejecución, la API solo reemplaza `{{textos}}` en el HTML compilado. Todo valor pasa por `escapeHtml` y los enlaces deben ser `http(s)`.
- `mjml` es `devDependency`: no llega a producción. `npm audit --omit=dev` sigue en 0 vulnerabilidades.
- Una prueba (`notifications.test.ts`) compila la plantilla y falla si el HTML versionado quedó desactualizado.
- Ambos archivos están en `.prettierignore`: MJML es sensible a los espacios y el HTML es generado.
- Los textos de cada correo y de cada idioma están en `templates/messages.ts`. El texto plano se arma con los mismos textos.

### Envío en desarrollo

`MailpitProvider` usa la **API HTTP de envío de Mailpit** (`POST /api/v1/send`) en lugar de SMTP. El correo llega igual a la bandeja de Mailpit, y así no hace falta una biblioteca SMTP en la API. La propuesta lo llamaba "SMTP local" (§8.5). El cambio es solo de transporte: la interfaz `EmailProvider`, el outbox y los estados no cambian.

## Consecuencias

- Un solo layout sirve a los correos de M3 (verificación y recuperación). Los de pedidos (M7) reutilizan el layout o agregan otro `.mjml` con el mismo procedimiento.
- Cambiar el diseño exige recompilar y versionar el HTML. La prueba lo recuerda.
- La línea de marea de los correos es una línea recta (`mj-divider`). Gmail y Outlook no muestran SVG, y una imagen PNG necesita un alojamiento público que llega en M10.
- Mailpit evalúa la compatibilidad del HTML compilado en 84 % "soportado", 11,6 % "parcial" y 4,4 % "no soportado" (prueba manual del 13/11/2026). Lo no soportado son propiedades de estilo que MJML agrega como mejora progresiva.
