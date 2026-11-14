/**
 * Solo para las E2E del catálogo: cambia el precio o la disponibilidad de un plato en la base
 * `<base>_e2e`, para comprobar que la web los actualiza en vivo sobre el HTML prerenderizado
 * (D10). Se niega a correr contra cualquier base que no termine en `_e2e`.
 *
 *   node scripts/e2e-catalog.ts --slug ceviche-nikkei --price 9900 --available false
 */
import { parseArgs } from 'node:util';
import { createPrismaClient } from '../src/db/client.ts';

const { values } = parseArgs({
  options: { slug: { type: 'string' }, price: { type: 'string' }, available: { type: 'string' } },
});
const url = process.env['DATABASE_URL'] ?? '';
if (!/\/[a-z0-9_]+_e2e(\?|$)/.test(url)) {
  console.error('e2e-catalog solo corre contra una base <base>_e2e.');
  process.exit(1);
}
if (!values.slug) {
  console.error('Uso: --slug <plato> [--price <colones>] [--available true|false]');
  process.exit(1);
}

const data: { basePriceMinor?: number; isAvailable?: boolean } = {};
if (values.price !== undefined) data.basePriceMinor = Math.round(Number(values.price) * 100);
if (values.available !== undefined) data.isAvailable = values.available === 'true';

const db = createPrismaClient(url);
try {
  await db.product.update({ where: { slug: values.slug }, data });
} finally {
  await db.$disconnect();
}
