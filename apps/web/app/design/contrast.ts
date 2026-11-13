/** Contraste WCAG 2.x entre dos colores HEX (#rrggbb). */
function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) throw new Error(`Color inválido: ${hex}`);
  const [r, g, b] = [match[1], match[2], match[3]].map((h) => channel(parseInt(h ?? '0', 16)));
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** AA: 4,5:1 para texto normal y 3:1 para texto grande (≥ 24 px, o ≥ 18,66 px en negrita). */
export function wcagLevel(ratio: number): 'AA' | 'AA-large' | 'fail' {
  if (ratio >= 4.5) return 'AA';
  if (ratio >= 3) return 'AA-large';
  return 'fail';
}
