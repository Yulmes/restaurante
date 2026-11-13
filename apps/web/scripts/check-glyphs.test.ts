import { describe, expect, it } from 'vitest';
import { REQUIRED_CHARS, checkGlyphs, fallbackCovers } from './check-glyphs.ts';

// Validación V3 (D1/D2), leída de la tabla cmap real de cada archivo de fuente.
describe('glifos de las tipografías aprobadas', () => {
  const reports = checkGlyphs();

  it('revisa las dos familias en todos los pesos usados', () => {
    expect(reports.map((r) => `${r.family}-${String(r.weight)}`)).toEqual([
      'shippori-mincho-b1-600',
      'shippori-mincho-b1-800',
      'zen-kaku-gothic-new-400',
      'zen-kaku-gothic-new-500',
      'zen-kaku-gothic-new-700',
    ]);
  });

  it.each(reports)('$family $weight: solo falta ₡ en las fuentes aprobadas', ({ missing }) => {
    expect(missing).toEqual(['₡']);
  });

  it('la fuente de respaldo aprobada aporta ₡ en los pesos declarados', () => {
    expect(fallbackCovers('₡')).toBe(true);
  });

  it('la lista cubre los caracteres de la sección 1.3', () => {
    for (const ch of ['á', 'Ñ', 'ü', '¿', '¡', '«', '»', '—', '₡', '$']) {
      expect(REQUIRED_CHARS).toContain(ch);
    }
  });
});
