/**
 * Genera los trazos SVG del sello 引潮 (C3: el hanko es un gráfico, no texto
 * con la fuente japonesa completa de 1,9 MB).
 *
 * Lee los contornos TrueType (`glyf`) de Shippori Mincho B1 ExtraBold desde el
 * archivo WOFF de @fontsource y escribe app/components/brand/hanko-glyphs.ts.
 * Uso: `npm run hanko -w @marea-baja/web`. Licencia de la fuente: SIL OFL 1.1.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const CHARS = ['引', '潮'] as const;
const FONT_FILE = 'shippori-mincho-b1-japanese-800-normal.woff';

function readTables(woff: Buffer): Map<string, Buffer> {
  if (woff.toString('ascii', 0, 4) !== 'wOFF') throw new Error('No es un archivo WOFF');
  const tables = new Map<string, Buffer>();
  const numTables = woff.readUInt16BE(12);
  for (let i = 0; i < numTables; i++) {
    const entry = 44 + i * 20;
    const tag = woff.toString('ascii', entry, entry + 4);
    const offset = woff.readUInt32BE(entry + 4);
    const compLength = woff.readUInt32BE(entry + 8);
    const origLength = woff.readUInt32BE(entry + 12);
    const raw = woff.subarray(offset, offset + compLength);
    tables.set(tag, compLength < origLength ? inflateSync(raw) : Buffer.from(raw));
  }
  return tables;
}

function table(tables: Map<string, Buffer>, tag: string): Buffer {
  const t = tables.get(tag);
  if (!t) throw new Error(`Falta la tabla ${tag}`);
  return t;
}

function glyphIndex(cmap: Buffer, codepoint: number): number {
  const numSubtables = cmap.readUInt16BE(2);
  for (let i = 0; i < numSubtables; i++) {
    const off = cmap.readUInt32BE(4 + i * 8 + 4);
    const format = cmap.readUInt16BE(off);
    if (format === 12) {
      const groups = cmap.readUInt32BE(off + 12);
      for (let g = 0; g < groups; g++) {
        const base = off + 16 + g * 12;
        const start = cmap.readUInt32BE(base);
        const end = cmap.readUInt32BE(base + 4);
        if (codepoint >= start && codepoint <= end) return cmap.readUInt32BE(base + 8) + (codepoint - start);
      }
    } else if (format === 4) {
      const segX2 = cmap.readUInt16BE(off + 6);
      const ends = off + 14;
      const starts = ends + segX2 + 2;
      const deltas = starts + segX2;
      const ranges = deltas + segX2;
      for (let s = 0; s < segX2 / 2; s++) {
        const end = cmap.readUInt16BE(ends + s * 2);
        const start = cmap.readUInt16BE(starts + s * 2);
        if (codepoint < start || codepoint > end) continue;
        const delta = cmap.readUInt16BE(deltas + s * 2);
        const rangePos = ranges + s * 2;
        const range = cmap.readUInt16BE(rangePos);
        if (range === 0) return (codepoint + delta) & 0xffff;
        const g = cmap.readUInt16BE(rangePos + range + (codepoint - start) * 2);
        return g === 0 ? 0 : (g + delta) & 0xffff;
      }
    }
  }
  return 0;
}

interface Point {
  x: number;
  y: number;
  on: boolean;
}

function glyphOffset(loca: Buffer, longFormat: boolean, index: number): [number, number] {
  return longFormat
    ? [loca.readUInt32BE(index * 4), loca.readUInt32BE(index * 4 + 4)]
    : [loca.readUInt16BE(index * 2) * 2, loca.readUInt16BE(index * 2 + 2) * 2];
}

function readContours(glyf: Buffer, loca: Buffer, longFormat: boolean, index: number): Point[][] {
  const [start, end] = glyphOffset(loca, longFormat, index);
  if (end <= start) return [];
  const g = glyf.subarray(start, end);
  const numContours = g.readInt16BE(0);
  if (numContours >= 0) return readSimple(g, numContours);
  return readComposite(g, glyf, loca, longFormat);
}

function readSimple(g: Buffer, numContours: number): Point[][] {
  let p = 10;
  const endPts: number[] = [];
  for (let i = 0; i < numContours; i++, p += 2) endPts.push(g.readUInt16BE(p));
  const numPoints = (endPts.at(-1) ?? -1) + 1;
  p += 2 + g.readUInt16BE(p);
  const flags: number[] = [];
  while (flags.length < numPoints) {
    const flag = g.readUInt8(p++);
    flags.push(flag);
    if (flag & 8) {
      const repeat = g.readUInt8(p++);
      for (let r = 0; r < repeat; r++) flags.push(flag);
    }
  }
  const readCoords = (shortBit: number, sameBit: number): number[] => {
    const values: number[] = [];
    let v = 0;
    for (const flag of flags) {
      if (flag & shortBit) {
        const d = g.readUInt8(p++);
        v += flag & sameBit ? d : -d;
      } else if (!(flag & sameBit)) {
        v += g.readInt16BE(p);
        p += 2;
      }
      values.push(v);
    }
    return values;
  };
  const xs = readCoords(2, 16);
  const ys = readCoords(4, 32);
  const contours: Point[][] = [];
  let first = 0;
  for (const last of endPts) {
    const contour: Point[] = [];
    for (let i = first; i <= last; i++) {
      contour.push({ x: xs[i] ?? 0, y: ys[i] ?? 0, on: ((flags[i] ?? 0) & 1) === 1 });
    }
    contours.push(contour);
    first = last + 1;
  }
  return contours;
}

function readComposite(g: Buffer, glyf: Buffer, loca: Buffer, longFormat: boolean): Point[][] {
  const contours: Point[][] = [];
  let p = 10;
  let more = true;
  while (more) {
    const flags = g.readUInt16BE(p);
    const component = g.readUInt16BE(p + 2);
    p += 4;
    let dx: number;
    let dy: number;
    if (flags & 1) {
      dx = g.readInt16BE(p);
      dy = g.readInt16BE(p + 2);
      p += 4;
    } else {
      dx = g.readInt8(p);
      dy = g.readInt8(p + 1);
      p += 2;
    }
    if (!(flags & 2)) throw new Error('Componentes con puntos de anclaje no soportados');
    let a = 1;
    let b = 0;
    let c = 0;
    let d = 1;
    const f2dot14 = (o: number): number => g.readInt16BE(o) / 16384;
    if (flags & 8) {
      a = d = f2dot14(p);
      p += 2;
    } else if (flags & 0x40) {
      a = f2dot14(p);
      d = f2dot14(p + 2);
      p += 4;
    } else if (flags & 0x80) {
      a = f2dot14(p);
      b = f2dot14(p + 2);
      c = f2dot14(p + 4);
      d = f2dot14(p + 6);
      p += 8;
    }
    for (const contour of readContours(glyf, loca, longFormat, component)) {
      contours.push(
        contour.map((pt) => ({ x: a * pt.x + c * pt.y + dx, y: b * pt.x + d * pt.y + dy, on: pt.on })),
      );
    }
    more = (flags & 0x20) !== 0;
  }
  return contours;
}

const fmt = (n: number): string => String(Math.round(n));

/** Convierte contornos cuadráticos de TrueType en un `d` de SVG (eje y invertido). */
function toPath(contours: Point[][], ascent: number): string {
  const parts: string[] = [];
  const flip = (pt: Point): { x: number; y: number } => ({ x: pt.x, y: ascent - pt.y });
  for (const contour of contours) {
    if (contour.length === 0) continue;
    const pts = contour.map((pt) => ({ ...flip(pt), on: pt.on }));
    const startIndex = pts.findIndex((pt) => pt.on);
    let start: { x: number; y: number };
    let ordered: typeof pts;
    if (startIndex === -1) {
      const p0 = pts[0];
      const p1 = pts[1] ?? p0;
      if (!p0 || !p1) continue;
      start = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
      ordered = pts;
    } else {
      ordered = [...pts.slice(startIndex + 1), ...pts.slice(0, startIndex + 1)];
      const s = pts[startIndex];
      if (!s) continue;
      start = s;
    }
    parts.push(`M${fmt(start.x)} ${fmt(start.y)}`);
    let control: { x: number; y: number } | null = null;
    for (const pt of ordered) {
      if (pt.on) {
        parts.push(
          control
            ? `Q${fmt(control.x)} ${fmt(control.y)} ${fmt(pt.x)} ${fmt(pt.y)}`
            : `L${fmt(pt.x)} ${fmt(pt.y)}`,
        );
        control = null;
      } else {
        if (control) {
          const mid = { x: (control.x + pt.x) / 2, y: (control.y + pt.y) / 2 };
          parts.push(`Q${fmt(control.x)} ${fmt(control.y)} ${fmt(mid.x)} ${fmt(mid.y)}`);
        }
        control = pt;
      }
    }
    if (control) parts.push(`Q${fmt(control.x)} ${fmt(control.y)} ${fmt(start.x)} ${fmt(start.y)}`);
    parts.push('Z');
  }
  return parts.join('');
}

const require = createRequire(import.meta.url);
const fontPath = join(
  dirname(require.resolve('@fontsource/shippori-mincho-b1/package.json')),
  'files',
  FONT_FILE,
);
const tables = readTables(readFileSync(fontPath));
const head = table(tables, 'head');
const unitsPerEm = head.readUInt16BE(18);
const longFormat = head.readInt16BE(50) === 1;
const ascent = table(tables, 'hhea').readInt16BE(4);
const descent = table(tables, 'hhea').readInt16BE(6);
const numHMetrics = table(tables, 'hhea').readUInt16BE(34);
const hmtx = table(tables, 'hmtx');

const glyphs = CHARS.map((char) => {
  const index = glyphIndex(table(tables, 'cmap'), char.codePointAt(0) ?? 0);
  if (index === 0) throw new Error(`La fuente no tiene el carácter ${char}`);
  const advance = hmtx.readUInt16BE(Math.min(index, numHMetrics - 1) * 4);
  const contours = readContours(table(tables, 'glyf'), table(tables, 'loca'), longFormat, index);
  const all = contours.flat();
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => ascent - p.y);
  const box = {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
  return { char, advance, box, d: toPath(contours, ascent) };
});

const out = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'app',
  'components',
  'brand',
  'hanko-glyphs.ts',
);
const body = `// Generado por scripts/extract-hanko.ts. No editar a mano.
// Contornos de Shippori Mincho B1 ExtraBold (SIL OFL 1.1, © The Shippori Mincho Project Authors).
export const HANKO_GLYPHS = ${JSON.stringify({ unitsPerEm, ascent, descent, glyphs }, null, 2)} as const;
`;
writeFileSync(out, body);
console.log(
  `Escrito ${out}: ${glyphs.map((g) => `${g.char} (${String(g.d.length)} caracteres de trazo)`).join(', ')}`,
);
