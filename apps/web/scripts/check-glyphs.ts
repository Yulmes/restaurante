/**
 * Validación V3 (D1/D2): comprueba en la tabla `cmap` de cada archivo de fuente
 * autoalojado si contiene los caracteres que necesita la interfaz en es-CR y en.
 *
 * Lee los archivos .woff de @fontsource (cada tabla va comprimida con zlib) y
 * reporta, por fuente, peso y subconjunto, qué caracteres faltan.
 * Uso: `npm run glyphs -w @marea-baja/web` (sale con código 1 si falta alguno
 * en la unión de subconjuntos latinos de un peso).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync, inflateSync } from 'node:zlib';

export const REQUIRED_CHARS = [
  'á',
  'é',
  'í',
  'ó',
  'ú',
  'Á',
  'É',
  'Í',
  'Ó',
  'Ú',
  'ñ',
  'Ñ',
  'ü',
  'Ü',
  '¿',
  '¡',
  '«',
  '»',
  '“',
  '”',
  '‘',
  '’',
  '—',
  '–',
  '·',
  '…',
  '₡',
  '$',
  '.',
  ',',
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
] as const;

/** Fuentes y pesos usados por el sistema de diseño (§3.1 de la propuesta). */
export const FONT_WEIGHTS = {
  'shippori-mincho-b1': [600, 800],
  'zen-kaku-gothic-new': [400, 500, 700],
} as const;

const LATIN_SUBSETS = ['latin', 'latin-ext'] as const;

function readCmap(woff: Buffer): Set<number> {
  if (woff.toString('ascii', 0, 4) !== 'wOFF') throw new Error('No es un archivo WOFF');
  const numTables = woff.readUInt16BE(12);
  for (let i = 0; i < numTables; i++) {
    const entry = 44 + i * 20;
    if (woff.toString('ascii', entry, entry + 4) !== 'cmap') continue;
    const offset = woff.readUInt32BE(entry + 4);
    const compLength = woff.readUInt32BE(entry + 8);
    const origLength = woff.readUInt32BE(entry + 12);
    const raw = woff.subarray(offset, offset + compLength);
    const table = compLength < origLength ? inflateSync(raw) : raw;
    return parseCmap(table);
  }
  throw new Error('La fuente no tiene tabla cmap');
}

// Etiquetas conocidas de WOFF2 (índices 0–62 de la especificación); solo hace falta ubicar `cmap`.
const WOFF2_TAGS =
  'cmap head hhea hmtx maxp name OS/2 post cvt  fpgm glyf loca prep CFF VORG EBDT EBLC gasp hdmx kern LTSH PCLT VDMX vhea vmtx BASE GDEF GPOS GSUB EBSC JSTF MATH CBDT CBLC COLR CPAL SVG  sbix acnt avar bdat bloc bsln cvar fdsc feat fmtx fvar gvar hsty just lcar mort morx opbd prop trak Zapf Silf Glat Gloc Feat Sill'
    .match(/.{4}\s?/g)
    ?.map((t) => t.slice(0, 4)) ?? [];

function readBase128(buf: Buffer, pos: number): [number, number] {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    const byte = buf.readUInt8(pos + i);
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) return [value, pos + i + 1];
  }
  throw new Error('UIntBase128 inválido');
}

/** `cmap` de un archivo WOFF2 (como los recortes servidos de `Marea Colon`). */
export function readWoff2Cmap(woff2: Buffer): Set<number> {
  if (woff2.toString('ascii', 0, 4) !== 'wOF2') throw new Error('No es un archivo WOFF2');
  const numTables = woff2.readUInt16BE(12);
  const compressedLength = woff2.readUInt32BE(20);
  let pos = 48;
  const entries: { tag: string; length: number }[] = [];
  for (let i = 0; i < numTables; i++) {
    const flags = woff2.readUInt8(pos);
    pos += 1;
    let tag = WOFF2_TAGS[flags & 0x3f] ?? '';
    if ((flags & 0x3f) === 63) {
      tag = woff2.toString('ascii', pos, pos + 4);
      pos += 4;
    }
    const version = (flags >> 6) & 0x03;
    let length: number;
    [length, pos] = readBase128(woff2, pos);
    const transformed = tag === 'glyf' || tag === 'loca' ? version === 0 : version !== 0;
    if (transformed) [length, pos] = readBase128(woff2, pos);
    entries.push({ tag, length });
  }
  const data = brotliDecompressSync(woff2.subarray(pos, pos + compressedLength));
  let offset = 0;
  for (const { tag, length } of entries) {
    if (tag === 'cmap') return parseCmap(data.subarray(offset, offset + length));
    offset += length;
  }
  throw new Error('La fuente no tiene tabla cmap');
}

function parseCmap(table: Buffer): Set<number> {
  const codepoints = new Set<number>();
  const numSubtables = table.readUInt16BE(2);
  for (let i = 0; i < numSubtables; i++) {
    const subOffset = table.readUInt32BE(4 + i * 8 + 4);
    const format = table.readUInt16BE(subOffset);
    if (format === 4) {
      const segX2 = table.readUInt16BE(subOffset + 6);
      const ends = subOffset + 14;
      const starts = ends + segX2 + 2;
      const deltas = starts + segX2;
      const rangeOffsets = deltas + segX2;
      for (let s = 0; s < segX2 / 2; s++) {
        const end = table.readUInt16BE(ends + s * 2);
        const start = table.readUInt16BE(starts + s * 2);
        const delta = table.readUInt16BE(deltas + s * 2);
        const rangeOffsetPos = rangeOffsets + s * 2;
        const rangeOffset = table.readUInt16BE(rangeOffsetPos);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          let glyph: number;
          if (rangeOffset === 0) {
            glyph = (c + delta) & 0xffff;
          } else {
            const glyphPos = rangeOffsetPos + rangeOffset + (c - start) * 2;
            const g = table.readUInt16BE(glyphPos);
            glyph = g === 0 ? 0 : (g + delta) & 0xffff;
          }
          if (glyph !== 0) codepoints.add(c);
        }
      }
    } else if (format === 12) {
      const groups = table.readUInt32BE(subOffset + 12);
      for (let g = 0; g < groups; g++) {
        const base = subOffset + 16 + g * 12;
        const start = table.readUInt32BE(base);
        const end = table.readUInt32BE(base + 4);
        for (let c = start; c <= end; c++) codepoints.add(c);
      }
    }
  }
  return codepoints;
}

function fontDir(family: string): string {
  const require = createRequire(import.meta.url);
  return join(dirname(require.resolve(`@fontsource/${family}/package.json`)), 'files');
}

/**
 * Respaldo aprobado por el propietario en M1: Noto Sans aporta SOLO el carácter ₡
 * (ver app/styles/fonts.ts). Cada peso de las tipografías aprobadas cae en el más
 * cercano de los dos pesos declarados. Desde M4 se sirve recortada a ese glifo
 * (`scripts/subset-colon-font.ts`): se revisan los archivos que llegan al navegador.
 */
export const FALLBACK = {
  family: 'noto-sans',
  weights: [400, 700],
  chars: ['₡'],
} as const;

/** Archivo servido de `Marea Colon` para un peso. */
export function fallbackFile(weight: number): string {
  return fileURLToPath(new URL(`../app/styles/fonts/marea-colon-${String(weight)}.woff2`, import.meta.url));
}

export function fallbackCovers(char: string): boolean {
  if (!(FALLBACK.chars as readonly string[]).includes(char)) return false;
  return FALLBACK.weights.every((weight) =>
    readWoff2Cmap(readFileSync(fallbackFile(weight))).has(char.codePointAt(0) ?? -1),
  );
}

export interface GlyphReport {
  family: string;
  weight: number;
  missing: string[];
  bySubset: Record<string, string[]>;
}

export function checkGlyphs(chars: readonly string[] = REQUIRED_CHARS): GlyphReport[] {
  const reports: GlyphReport[] = [];
  for (const [family, weights] of Object.entries(FONT_WEIGHTS)) {
    const dir = fontDir(family);
    const files = readdirSync(dir);
    for (const weight of weights) {
      const covered = new Set<number>();
      const bySubset: Record<string, string[]> = {};
      for (const subset of LATIN_SUBSETS) {
        const file = files.find((f) => f === `${family}-${subset}-${String(weight)}-normal.woff`);
        if (!file) continue;
        const cmap = readCmap(readFileSync(join(dir, file)));
        bySubset[subset] = chars.filter((ch) => cmap.has(ch.codePointAt(0) ?? -1));
        for (const cp of cmap) covered.add(cp);
      }
      const missing = chars.filter((ch) => !covered.has(ch.codePointAt(0) ?? -1));
      reports.push({ family, weight, missing, bySubset });
    }
  }
  return reports;
}

if (import.meta.url === `file:///${process.argv[1]?.replaceAll('\\', '/') ?? ''}`) {
  const reports = checkGlyphs();
  let failed = false;
  for (const r of reports) {
    const viaFallback = r.missing.filter((ch) => fallbackCovers(ch));
    const uncovered = r.missing.filter((ch) => !viaFallback.includes(ch));
    if (uncovered.length > 0) failed = true;
    const status =
      uncovered.length > 0
        ? `FALTAN: ${uncovered.join(' ')}`
        : viaFallback.length > 0
          ? `OK (${viaFallback.join(' ')} vía respaldo Noto Sans)`
          : 'OK';
    console.log(`${r.family} ${String(r.weight)}: ${status}`);
    for (const [subset, present] of Object.entries(r.bySubset)) {
      const hasColon = present.includes('₡') ? ' (incluye ₡)' : '';
      console.log(`   ${subset}: ${String(present.length)}/${String(REQUIRED_CHARS.length)}${hasColon}`);
    }
  }
  process.exitCode = failed ? 1 : 0;
}
