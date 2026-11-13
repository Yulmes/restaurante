/**
 * Prepara la base de prueba antes de las pruebas *.db.test.ts:
 * 1. la borra y la vuelve a crear (`<base>_test`, nunca la de desarrollo);
 * 2. aplica las migraciones con el rol propietario;
 * 3. crea el rol de la aplicación;
 * 4. carga la semilla.
 * Las URLs se pasan a las pruebas con `provide` / `inject`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    ownerUrl: string;
    appUrl: string;
  }
}

const API_DIR = fileURLToPath(new URL('..', import.meta.url));
const rootEnvFile = fileURLToPath(new URL('../../../.env', import.meta.url));

function withDatabase(url: string, database: string): string {
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

export default async function setup(project: TestProject): Promise<void> {
  if (existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile);
  const ownerBase = process.env['MIGRATION_DATABASE_URL'];
  const appBase = process.env['DATABASE_URL'];
  if (!ownerBase || !appBase) {
    throw new Error('Faltan MIGRATION_DATABASE_URL y DATABASE_URL (copiá .env.example a .env).');
  }

  const testDatabase = `${new URL(ownerBase).pathname.slice(1)}_test`;
  if (!/^[a-z0-9_]+_test$/.test(testDatabase)) throw new Error('Nombre de base de prueba inesperado.');

  const admin = new pg.Client({ connectionString: withDatabase(ownerBase, 'postgres') });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${admin.escapeIdentifier(testDatabase)} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${admin.escapeIdentifier(testDatabase)}`);
  } finally {
    await admin.end();
  }

  const ownerUrl = withDatabase(ownerBase, testDatabase);
  const appUrl = withDatabase(appBase, testDatabase);
  const env = { MIGRATION_DATABASE_URL: ownerUrl, DATABASE_URL: appUrl };

  run('npx', ['prisma', 'migrate', 'deploy'], env);
  run('node', ['scripts/db-app-role.ts'], env);
  run('node', ['prisma/seed.ts'], env);

  project.provide('ownerUrl', ownerUrl);
  project.provide('appUrl', appUrl);
}
