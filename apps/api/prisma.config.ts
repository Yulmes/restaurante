/**
 * Configuración de la CLI de Prisma 7 (migraciones y semilla).
 *
 * La CLI se conecta con el rol PROPIETARIO del esquema (`MIGRATION_DATABASE_URL`), porque crea
 * tablas, triggers y grants. La API, en cambio, usa `DATABASE_URL` con el rol de la aplicación,
 * que no puede modificar el esquema ni editar el AuditLog (ADR 0003).
 *
 * `prisma generate` no necesita base de datos, así que la URL puede faltar al generar el cliente.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'prisma/config';

const rootEnvFile = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(rootEnvFile)) {
  process.loadEnvFile(rootEnvFile);
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'node prisma/seed.ts',
  },
  datasource: {
    url: process.env['MIGRATION_DATABASE_URL'] ?? '',
  },
});
