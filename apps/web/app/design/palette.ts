/** Paleta aprobada (§1.2) y tokens derivados (D1). Fuente única para /_design y sus tests. */
export const PALETTE = {
  tinta: '#0F2E35',
  espuma: '#EEF2EF',
  aji: '#F4B223',
  coral: '#D9573B',
  lima: '#C7D63A',
  roca: '#5E6B6B',
} as const;

export const DERIVED = {
  coral700: '#B8432A',
  tinta800: '#173F48',
  sal: '#F8FAF8',
  linea: '#D5DDD9',
} as const;

export type ColorName = keyof typeof PALETTE | keyof typeof DERIVED;

export const COLORS: Record<ColorName, string> = { ...PALETTE, ...DERIVED };

/**
 * Combinaciones de texto y fondo que usa el sistema, con su uso permitido.
 * `large` = solo texto grande o elementos no textuales.
 */
export const CONTRAST_PAIRS = [
  { id: 'tintaOnEspuma', fg: 'tinta', bg: 'espuma', use: 'text' },
  { id: 'rocaOnEspuma', fg: 'roca', bg: 'espuma', use: 'text' },
  { id: 'coral700OnEspuma', fg: 'coral700', bg: 'espuma', use: 'text' },
  { id: 'tintaOnSal', fg: 'tinta', bg: 'sal', use: 'text' },
  { id: 'espumaOnTinta', fg: 'espuma', bg: 'tinta', use: 'text' },
  { id: 'ajiOnTinta', fg: 'aji', bg: 'tinta', use: 'text' },
  { id: 'tintaOnAji', fg: 'tinta', bg: 'aji', use: 'text' },
  { id: 'tintaOnLima', fg: 'tinta', bg: 'lima', use: 'text' },
  { id: 'espumaOnTinta800', fg: 'espuma', bg: 'tinta800', use: 'text' },
  { id: 'espumaOnCoral', fg: 'espuma', bg: 'coral', use: 'large' },
  { id: 'coralOnEspuma', fg: 'coral', bg: 'espuma', use: 'large' },
  { id: 'ajiOnEspuma', fg: 'aji', bg: 'espuma', use: 'never' },
] as const satisfies readonly { id: string; fg: ColorName; bg: ColorName; use: 'text' | 'large' | 'never' }[];
