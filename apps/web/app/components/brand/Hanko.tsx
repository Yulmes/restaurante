import { useT } from '../../i18n/use-locale.ts';
import { HANKO_GLYPHS } from './hanko-glyphs.ts';

/**
 * Sello 引潮 (§1.4). Gráfico SVG con los contornos de Shippori Mincho B1
 * ExtraBold extraídos por scripts/extract-hanko.ts (C3): no se carga la fuente japonesa.
 * ⚠️ V2: requiere revisión de un hablante nativo antes de producción.
 */
export function Hanko({ size = 48 }: { size?: number }) {
  const { t } = useT();
  const { unitsPerEm: cell, glyphs } = HANKO_GLYPHS;
  const pad = cell * 0.16;
  const gap = cell * 0.04;
  const width = cell + pad * 2;
  const height = cell * glyphs.length + gap * (glyphs.length - 1) + pad * 2;
  return (
    <svg
      role="img"
      aria-label={t('hanko.label')}
      width={size}
      height={Math.round((size * height) / width)}
      viewBox={`0 0 ${String(width)} ${String(height)}`}
      className="shrink-0"
    >
      <rect width={width} height={height} rx={width * 0.04} className="fill-coral" />
      {glyphs.map((glyph, i) => {
        // Centra cada carácter en su celda cuadrada, en columna vertical.
        const x = pad + (cell - glyph.box.width) / 2 - glyph.box.minX;
        const y = pad + i * (cell + gap) + (cell - glyph.box.height) / 2 - glyph.box.minY;
        return (
          <path
            key={glyph.char}
            d={glyph.d}
            className="fill-espuma"
            transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`}
          />
        );
      })}
    </svg>
  );
}
