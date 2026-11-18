# ADR 0002 · Fuente de respaldo exclusiva para el símbolo ₡

- **Estado:** aceptado. **Decisión del propietario** el 10/11/2026, durante M1, al resolver la validación V3.
- **Hito:** M1

## Contexto

La validación V3 leyó la tabla `cmap` de cada archivo de fuente autoalojado (`apps/web/scripts/check-glyphs.ts`). **Ni Shippori Mincho B1 ni Zen Kaku Gothic New incluyen ₡ (U+20A1)**, en ningún peso ni subconjunto. Todos los demás caracteres requeridos están presentes: tildes, ñ, ü, ¿¡, comillas, rayas, ·, … y $. La propuesta pedía documentar la solución sin cambiar las tipografías aprobadas (V3, R17).

Opciones presentadas al propietario:

1. Fuente de respaldo solo para ₡ (recomendada).
2. Glifo ₡ dibujado a medida en SVG.
3. Código "CRC" en lugar del símbolo.
4. Fuente del sistema.

## Decisión

**Opción 1:** Noto Sans (SIL OFL 1.1), autoalojada y declarada como la familia `Marea Colon` con `unicode-range: U+20A1`, en segundo lugar de las pilas `--font-display` y `--font-sans`.

## Detalles

- Verificado con el mismo lector de `cmap`: Noto Sans latin-ext contiene ₡ en todos los pesos.
- Solo se declaran los pesos 400 y 700. El navegador usa el más cercano (500 → 400; 600 y 800 → 700).
- El precio sigue siendo texto real: se puede copiar y los lectores de pantalla lo leen.
- Pruebas:
  - `check-glyphs.test.ts`: solo falta ₡ y el respaldo lo cubre.
  - `responsive.spec.ts`: `document.fonts.check('700 17px "Marea Colon"', '₡')`.

## Consecuencias y deuda

- ~~⚠️ **Peso:** cada archivo de Noto Sans latin-ext pesa unos 54 KB solo para un glifo. Mejora prevista en M9: recortar la fuente a ese único carácter (~2 KB).~~ **Resuelto en M4** (ver la sección siguiente).
- El ₡ tiene un diseño ligeramente distinto al de Zen Kaku Gothic New. Revisado visualmente a 375 px en las líneas de carta y aceptable.

## Actualización M4 (17/11/2026): recorte al glifo ₡

Autorizada por el propietario para bajar el LCP móvil de M4. Era la única modificación de M1 permitida en esa tarea.

- **Por qué:** en el celular simulado, los 59 KB de Noto Sans 700 se pedían con prioridad máxima en la portada, la carta y los platos, y competían con la foto LCP.
- **Herramienta:**
  - `subset-font` 2.9.0 (HarfBuzz compilado a WebAssembly), como dependencia de desarrollo de `@marea-baja/web`;
  - el script `npm run fonts:colon -w @marea-baja/web` (`apps/web/scripts/subset-colon-font.ts`).
- **Origen:** `@fontsource/noto-sans` 5.3.0, latin-ext 400 y 700 en WOFF2. Siguen en `node_modules` sin cambios.
- **Contenido del recorte:**
  - solo `.notdef` y ₡ (U+20A1);
  - contornos, avance y métricas verticales iguales al original;
  - tablas de nombre 0–6 (copyright, familia, versión) y 13–14 (licencia).
- **Licencia:** Noto Sans no tiene nombres de fuente reservados, así que la versión recortada se puede distribuir con la OFL 1.1. La familia CSS sigue siendo `Marea Colon`.
- **Archivos:**
  - `apps/web/app/styles/fonts/marea-colon-400.woff2`: 848 B (antes 55 640 B);
  - `apps/web/app/styles/fonts/marea-colon-700.woff2`: 852 B (antes 59 144 B);
  - están versionados, así que el build no depende de la herramienta;
  - la salida es reproducible: el mismo hash en dos corridas.
- **Integración:**
  - `app/styles/fonts.ts` declara las mismas dos `@font-face`, con `unicode-range: U+20A1` y `font-display: swap`;
  - por su tamaño (menos de 4 KB), Vite incrusta cada archivo como `data:` en el `<style>` del documento;
  - el ₡ ya no hace ninguna petición y se pinta desde el primer render, sin cambiar de fuente.
  - **Costo:** el HTML de cada página lleva unos 2,3 KB más, también las páginas sin precios (Nosotros, Ubicación y horario, cuenta). En ellas la fuente nunca se activa: `document.fonts` la deja en `unloaded`.
  - **Alternativa:** importar con `?url&no-inline` (un archivo aparte de 850 B, que se pide solo si aparece ₡), a cambio de una petición más en las páginas con precios.
- **Igualdad visual verificada:**
  - en Chromium, el original y el recorte se dibujaron en un canvas en 400 y 700, a 14, 17, 24, 48, 96 y 200 px;
  - **0 píxeles distintos** en los 12 casos, con el mismo avance y las mismas métricas de ascenso y descenso.
- **Pruebas:**
  - `check-glyphs.test.ts` lee la `cmap` de los WOFF2 servidos: deben tener solo U+20A1 y pesar menos de 2 KB;
  - `responsive.spec.ts` sigue confirmando con `document.fonts.check` que `Marea Colon` carga el ₡.
- **CSP futura (M10):** las fuentes en `data:` necesitan `font-src 'self' data:`. Ya hacía falta, porque el CSS de M1 incrusta cinco subconjuntos latin-ext pequeños.
