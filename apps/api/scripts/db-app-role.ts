/**
 * Crea o actualiza el usuario con login de la API y lo agrega al rol `marea_app_rw` (ADR 0003).
 *
 * Uso: `npm run db:app-role -w @marea-baja/api` (desarrollo local y CI).
 * - Se conecta con `MIGRATION_DATABASE_URL` (propietario del esquema).
 * - Toma el usuario y la contraseña de `DATABASE_URL`.
 * - Es idempotente: si el usuario ya existe, solo actualiza la contraseña y la pertenencia.
 * - No imprime contraseñas ni URLs.
 *
 * En producción (M10) el rol lo crea el propietario siguiendo DEPLOYMENT.md; este script es solo
 * para entornos locales y de CI.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const APP_GROUP_ROLE = 'marea_app_rw';
const ROLE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

const rootEnvFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile);

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable ${name}.`);
  return value;
}

const ownerUrl = required('MIGRATION_DATABASE_URL');
const appUrl = new URL(required('DATABASE_URL'));
const appUser = decodeURIComponent(appUrl.username);
const appPassword = decodeURIComponent(appUrl.password);
const database = appUrl.pathname.slice(1);

if (!ROLE_NAME.test(appUser)) throw new Error('El usuario de DATABASE_URL no es un nombre de rol válido.');
if (appPassword.length < 12)
  throw new Error('La contraseña de DATABASE_URL debe tener al menos 12 caracteres.');
if (appUser === new URL(ownerUrl).username) {
  throw new Error('DATABASE_URL debe usar un rol distinto del propietario (MIGRATION_DATABASE_URL).');
}

const client = new pg.Client({ connectionString: ownerUrl });
await client.connect();
try {
  const group = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [APP_GROUP_ROLE]);
  if (group.rowCount === 0) {
    throw new Error(`No existe el rol ${APP_GROUP_ROLE}: aplicá antes las migraciones (npm run db:migrate).`);
  }

  // CREATE/ALTER ROLE no admiten parámetros: se escapan identificador y literal con pg.
  const user = client.escapeIdentifier(appUser);
  const password = client.escapeLiteral(appPassword);
  const exists = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [appUser]);
  const verb = exists.rowCount === 0 ? 'CREATE' : 'ALTER';
  // Sin SUPERUSER, CREATEDB ni CREATEROLE (valores por defecto): hereda solo los permisos del grupo.
  await client.query(`${verb} ROLE ${user} WITH LOGIN INHERIT PASSWORD ${password}`);
  await client.query(`GRANT ${client.escapeIdentifier(APP_GROUP_ROLE)} TO ${user}`);
  await client.query(`GRANT CONNECT ON DATABASE ${client.escapeIdentifier(database)} TO ${user}`);

  console.log(`Rol de la aplicación listo (${verb === 'CREATE' ? 'creado' : 'actualizado'}).`);
} finally {
  await client.end();
}
