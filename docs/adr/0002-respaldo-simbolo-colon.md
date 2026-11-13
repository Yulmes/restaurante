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

- ⚠️ **Peso:** cada archivo de Noto Sans latin-ext pesa unos 54 KB solo para un glifo. Mejora prevista en M9: recortar la fuente a ese único carácter (~2 KB), lo que requiere una herramienta de recorte que hoy no está instalada.
- El ₡ tiene un diseño ligeramente distinto al de Zen Kaku Gothic New. Revisado visualmente a 375 px en las líneas de carta y aceptable.
