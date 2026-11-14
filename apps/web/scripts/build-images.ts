/**
 * Variantes de las fotos aprobadas (D13, §2.3, §9.4): `npm run images -w @marea-baja/web`.
 * Corre antes de `dev` y de `build`. Lee `photos/source/*.jpg` y escribe en `public/images/`
 * (ignorado por git; se regenera solo si la foto o este script cambiaron).
 *
 * - Recortes con nombre: `card` 4:5 (platos), `hero` 3:2 (ambiente), `thumb` 1:1 y `og` 1200×630.
 * - Formatos: AVIF y WebP para la web; JPEG para Open Graph (compatibilidad de las redes).
 * - Un único ajuste de color para todas (§2.3): apenas más frío y con las sombras levantadas hacia
 *   Tinta. Es sutil a propósito: no cambia el contenido de la foto aprobada.
 */
import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp, { type Sharp } from 'sharp';

const SOURCE = fileURLToPath(new URL('../photos/source/', import.meta.url));
const OUTPUT = fileURLToPath(new URL('../public/images/', import.meta.url));
const SELF = fileURLToPath(import.meta.url);

export const VARIANTS = {
  card: { ratio: [4, 5], widths: [480, 960] },
  hero: { ratio: [3, 2], widths: [1000, 2000] },
  thumb: { ratio: [1, 1], widths: [480] },
  og: { ratio: [1200, 630], widths: [1200] },
} as const;
export type Variant = keyof typeof VARIANTS;

/**
 * Encuadres que no deja bien el recorte automático (notas de licencia y composición de M1,
 * `CREDITS.md`): 21 tiene residuos arriba; 19 tiene tatuajes con texto en la parte superior.
 */
const POSITION: Record<string, string> = {
  '21-marea-baja-aerea': 'bottom',
  '19-oficio-emplatado': 'bottom',
};

/** Ajuste de color único (§2.3). */
function grade(image: Sharp): Sharp {
  return image
    .recomb([
      [0.97, 0.02, 0.01],
      [0.01, 0.98, 0.01],
      [0.0, 0.02, 0.98],
    ])
    .linear(0.96, 7)
    .modulate({ saturation: 0.96 });
}

function isFresh(target: string, sources: readonly string[]): boolean {
  try {
    const built = statSync(target).mtimeMs;
    return sources.every((source) => statSync(source).mtimeMs < built);
  } catch {
    return false;
  }
}

export async function buildImages(): Promise<{ written: number; skipped: number }> {
  let written = 0;
  let skipped = 0;
  const files = readdirSync(SOURCE).filter((f) => f.endsWith('.jpg'));
  for (const file of files) {
    const key = file.replace(/\.jpg$/, '');
    const input = `${SOURCE}${file}`;
    mkdirSync(`${OUTPUT}${key}`, { recursive: true });
    for (const [variant, spec] of Object.entries(VARIANTS) as [Variant, (typeof VARIANTS)[Variant]][]) {
      for (const width of spec.widths) {
        const height = Math.round((width * spec.ratio[1]) / spec.ratio[0]);
        const formats = variant === 'og' ? (['jpg'] as const) : (['avif', 'webp'] as const);
        for (const format of formats) {
          const target = `${OUTPUT}${key}/${variant}-${String(width)}.${format}`;
          if (isFresh(target, [input, SELF])) {
            skipped += 1;
            continue;
          }
          const base = grade(
            sharp(input)
              .rotate()
              .resize(width, height, {
                fit: 'cover',
                position: POSITION[key] ?? sharp.strategy.attention,
                withoutEnlargement: false,
              }),
          );
          const out =
            format === 'avif'
              ? base.avif({ quality: 55, effort: 4 })
              : format === 'webp'
                ? base.webp({ quality: 78 })
                : base.jpeg({ quality: 82, mozjpeg: true });
          writeFileSync(target, await out.toBuffer());
          written += 1;
        }
      }
    }
  }
  return { written, skipped };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { written, skipped } = await buildImages();
  console.log(`Variantes de imagen: ${String(written)} generadas, ${String(skipped)} al día.`);
}
