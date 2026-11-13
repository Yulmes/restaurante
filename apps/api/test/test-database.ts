/**
 * Crea una base de prueba desde cero: la borra y la vuelve a crear (`<base>_<sufijo>`, nunca la de
 * desarrollo), aplica las migraciones con el rol propietario, crea el rol de la aplicación y
 * carga la semilla. La usan las pruebas de base de datos (`_test`) y las E2E de identidad (`_e2e`).
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const API_DIR = fileURLToPath(new URL('..', import.meta.url));
const rootEnvFile = fileURLToPath(new URL('../../../.env', import.meta.url));

export function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

function run(command: string, args: readonly string[], env: Record<string, string>): void {
  const result = spawnSync(command, args, {
    cwd: API_DIR,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    throw new Error(`Falló "${[command, ...args].join(' ')}":\n${result.stdout}\n${result.stderr}`);
  }
}

/** URLs de la base `<base>_<sufijo>` a partir de las de `.env`, sin tocar nada. */
export function testDatabaseUrls(suffix: 'test' | 'e2e'): {
  ownerUrl: string;
  appUrl: string;
  database: string;
} {
  if (existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile);
  const ownerBase = process.env['MIGRATION_DATABASE_URL'];
  const appBase = process.env['DATABASE_URL'];
  if (!ownerBase || !appBase) {
    throw new Error('Faltan MIGRATION_DATABASE_URL y DATABASE_URL (copiá .env.example a .env).');
  }
  const database = `${new URL(ownerBase).pathname.slice(1)}_${suffix}`;
  if (!/^[a-z0-9_]+_(test|e2e)$/.test(database)) throw new Error('Nombre de base de prueba inesperado.');
  return { ownerUrl: withDatabase(ownerBase, database), appUrl: withDatabase(appBase, database), database };
}

export async function createTestDatabase(
  suffix: 'test' | 'e2e',
): Promise<{ ownerUrl: string; appUrl: string }> {
  const { ownerUrl, appUrl, database } = testDatabaseUrls(suffix);
  const admin = new pg.Client({ connectionString: withDatabase(ownerUrl, 'postgres') });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${admin.escapeIdentifier(database)} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${admin.escapeIdentifier(database)}`);
  } finally {
    await admin.end();
  }
  const env = { MIGRATION_DATABASE_URL: ownerUrl, DATABASE_URL: appUrl };
  run('npx', ['prisma', 'migrate', 'deploy'], env);
  run('node', ['scripts/db-app-role.ts'], env);
  run('node', ['prisma/seed.ts'], env);
  return { ownerUrl, appUrl };
}
