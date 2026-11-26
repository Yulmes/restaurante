// Manifiesto del backup y verificaciones de la restauración (ADR 0010, D-M10-8). Solo conteos.
//
//   node manifest.js write <ts> <motivo> <sha256> <bytes> <pg_dump> <entradas> <conteos>
//   node manifest.js age <manifest.json> <días_máximos>
//   node manifest.js compare <manifest.json> <conteos>
import { readFileSync } from 'node:fs';

const [command, ...args] = process.argv.slice(2);

/** `tabla=n,tabla=n` → { tabla: n } */
export function parseCounts(text) {
  if (!text) return {};
  return Object.fromEntries(
    text.split(',').map((pair) => {
      const [name, value] = pair.split('=');
      return [name, Number(value)];
    }),
  );
}

/** `20261126T150000Z` → milisegundos. */
export function parseStamp(stamp) {
  const iso = stamp.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z');
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error(`fecha inválida: ${stamp}`);
  return ms;
}

if (command === 'write') {
  const [ts, reason, sha256, bytes, pgDump, entries, counts] = args;
  const manifest = {
    version: 1,
    createdAt: ts,
    reason,
    file: `${ts}/dump.age`,
    sha256,
    bytes: Number(bytes),
    pgDump,
    entries: Number(entries),
    tables: parseCounts(counts),
  };
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
} else if (command === 'age') {
  const [file, maxDays] = args;
  const { createdAt } = JSON.parse(readFileSync(file, 'utf8'));
  const days = (Date.now() - parseStamp(createdAt)) / 86_400_000;
  if (!(days <= Number(maxDays))) {
    console.error(`el último backup tiene ${days.toFixed(1)} días (máximo ${maxDays})`);
    process.exit(1);
  }
} else if (command === 'compare') {
  const [file, counts] = args;
  const expected = JSON.parse(readFileSync(file, 'utf8')).tables;
  const actual = parseCounts(counts);
  const names = Object.keys({ ...expected, ...actual });
  const diff = names.filter((name) => expected[name] !== actual[name]);
  if (diff.length > 0) {
    console.error(`tablas con conteos distintos: ${diff.join(', ')}`);
    process.exit(1);
  }
  const rows = Object.values(expected).reduce((sum, n) => sum + n, 0);
  console.log(`${String(names.length)} tablas, ${String(rows)} filas`);
} else if (command !== undefined) {
  console.error(`comando desconocido: ${command}`);
  process.exit(2);
}
