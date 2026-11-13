import { describe, expect, it } from 'vitest';
import { contrastRatio, wcagLevel } from './contrast.ts';
import { COLORS, CONTRAST_PAIRS } from './palette.ts';

describe('contrastRatio', () => {
  it('da 21:1 entre negro y blanco y 1:1 entre colores iguales', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#0F2E35', '#0F2E35')).toBeCloseTo(1, 5);
  });

  it('confirma los valores aproximados de la propuesta (§1.2), con margen de ±0,15', () => {
    const near = (value: number, documented: number) => Math.abs(value - documented) <= 0.15;
    expect(near(contrastRatio(COLORS.aji, COLORS.tinta), 7.6)).toBe(true);
    expect(near(contrastRatio(COLORS.roca, COLORS.espuma), 4.8)).toBe(true);
    expect(near(contrastRatio(COLORS.coral700, COLORS.espuma), 4.7)).toBe(true);
    expect(contrastRatio(COLORS.tinta, COLORS.lima)).toBeGreaterThan(8.5);
  });
});

describe('pares del sistema', () => {
  it.each(CONTRAST_PAIRS)('$id cumple el uso declarado ($use)', ({ fg, bg, use }) => {
    const level = wcagLevel(contrastRatio(COLORS[fg], COLORS[bg]));
    if (use === 'text') expect(level).toBe('AA');
    if (use === 'large') expect(level).not.toBe('fail');
    if (use === 'never') expect(level).toBe('fail');
  });
});
