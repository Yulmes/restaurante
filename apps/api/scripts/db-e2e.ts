/**
 * Recrea la base de las pruebas E2E de identidad (`<base>_e2e`): `npm run db:e2e -w @marea-baja/api`.
 * La API de las E2E usa esa base, así nunca toca la de desarrollo.
 *
 * `--turnstile-threshold <n>` baja el umbral global de Turnstile (D8) **solo en esa base**, para
 * probar el desafío con pocos fallos.
 */
import { parseArgs } from 'node:util';
import pg from 'pg';
import { createTestDatabase } from '../test/test-database.ts';

const { values } = parseArgs({ options: { 'turnstile-threshold': { type: 'string' } } });
const { ownerUrl } = await createTestDatabase('e2e');

const threshold = values['turnstile-threshold'];
if (threshold !== undefined) {
  const n = Number(threshold);
  if (!Number.isInteger(n) || n < 1) throw new Error('--turnstile-threshold debe ser un entero positivo.');
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    await client.query('UPDATE "RestaurantSettings" SET "turnstileGlobalThreshold" = $1 WHERE id = 1', [n]);
  } finally {
    await client.end();
  }
}
console.log('Base E2E lista.');
