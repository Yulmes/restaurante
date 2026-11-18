/**
 * Fuente de respaldo SOLO para el símbolo ₡ (U+20A1).
 * Decisión del propietario en M1: las tipografías aprobadas no tienen ₡ (validación V3),
 * así que se autoaloja Noto Sans (SIL OFL 1.1) limitada con unicode-range a ese carácter.
 *
 * Solo se declaran dos pesos y el navegador usa el más cercano (500 → 400; 600/800 → 700).
 *
 * Los archivos son Noto Sans recortada a ese único glifo (M4, ADR 0002): unos 850 B cada uno, en
 * lugar de los 55–59 KB del subconjunto latin-ext completo. Se generan con
 * `npm run fonts:colon -w @marea-baja/web`. Por su tamaño, Vite los incrusta como `data:` en este
 * `<style>`: el ₡ no necesita ninguna petición ni cambia de fuente después de pintarse.
 */
import colon400 from './fonts/marea-colon-400.woff2?url';
import colon700 from './fonts/marea-colon-700.woff2?url';

const FILES: Record<number, string> = { 400: colon400, 700: colon700 };

export const COLON_FONT_CSS = Object.entries(FILES)
  .map(
    ([weight, url]) =>
      `@font-face{font-family:'Marea Colon';font-style:normal;font-display:swap;font-weight:${weight};src:url(${url}) format('woff2');unicode-range:U+20A1;}`,
  )
  .join('');
