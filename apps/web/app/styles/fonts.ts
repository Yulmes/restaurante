/**
 * Fuente de respaldo SOLO para el símbolo ₡ (U+20A1).
 * Decisión del propietario en M1: las tipografías aprobadas no tienen ₡ (validación V3),
 * así que se autoaloja Noto Sans (SIL OFL 1.1) limitada con unicode-range a ese carácter.
 * El navegador la descarga solo cuando aparece un precio en colones.
 *
 * Solo se declaran dos pesos: cada archivo pesa ~54 KB y el navegador usa el más cercano
 * (500 → 400; 600/800 → 700). Los precios usan 700, así que lo habitual es un solo archivo.
 * Mejora pendiente (M9): recortar la fuente a ese único glifo (~2 KB).
 */
import noto400 from '@fontsource/noto-sans/files/noto-sans-latin-ext-400-normal.woff2?url';
import noto700 from '@fontsource/noto-sans/files/noto-sans-latin-ext-700-normal.woff2?url';

const FILES: Record<number, string> = { 400: noto400, 700: noto700 };

export const COLON_FONT_CSS = Object.entries(FILES)
  .map(
    ([weight, url]) =>
      `@font-face{font-family:'Marea Colon';font-style:normal;font-display:swap;font-weight:${weight};src:url(${url}) format('woff2');unicode-range:U+20A1;}`,
  )
  .join('');
