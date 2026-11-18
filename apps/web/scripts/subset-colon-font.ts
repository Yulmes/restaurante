/**
 * Recorta Noto Sans al único carácter que el sitio le pide: ₡ (U+20A1). Es la fuente de respaldo
 * `Marea Colon` (ADR 0002): las tipografías aprobadas no tienen ese glifo.
 *
 *   npm run fonts:colon -w @marea-baja/web
 *
 * - Origen: `@fontsource/noto-sans` (latin-ext, pesos 400 y 700), SIL OFL 1.1, sin nombres
 *   reservados.
 * - Recorte con HarfBuzz (`subset-font`): conserva el contorno, el avance, las métricas verticales
 *   y las tablas de nombre de copyright y licencia. Solo quedan `.notdef` y ₡.
 * - Salida: `app/styles/fonts/marea-colon-<peso>.woff2`, versionada (unos 2 KB cada una), así el
 *   build no depende de esta herramienta. Solo hay que volver a correrlo si se actualiza la fuente.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import subsetFont from 'subset-font';

export const COLON = '₡';
export const COLON_WEIGHTS = [400, 700] as const;

const require = createRequire(import.meta.url);
const OUT = fileURLToPath(new URL('../app/styles/fonts/', import.meta.url));

// 0–6: copyright, familia, estilo, id, nombre completo, versión, PostScript. 13–14: licencia y URL.
const NAME_IDS = [0, 1, 2, 3, 4, 5, 6, 13, 14];

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  for (const weight of COLON_WEIGHTS) {
    const source = require.resolve(
      `@fontsource/noto-sans/files/noto-sans-latin-ext-${String(weight)}-normal.woff2`,
    );
    const original = readFileSync(source);
    const subset = await subsetFont(original, COLON, { targetFormat: 'woff2', preserveNameIds: NAME_IDS });
    const target = `${OUT}marea-colon-${String(weight)}.woff2`;
    writeFileSync(target, subset);
    console.log(
      `Noto Sans ${String(weight)}: ${String(original.length)} B → ${String(subset.length)} B (${target})`,
    );
  }
}

await main();
