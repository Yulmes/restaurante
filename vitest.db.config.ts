import { defineConfig } from 'vitest/config';

/**
 * Pruebas contra PostgreSQL real (M2): restricciones, AuditLog, permisos y semilla.
 * Requieren la base de Docker Compose (`npm run services:up`). La configuración global crea
 * una base aparte (`<base>_test`), aplica las migraciones, crea el rol de la aplicación y carga
 * la semilla; la base de desarrollo no se toca.
 */
export default defineConfig({
  // Las rutas son relativas a la raíz del repositorio aunque se ejecute desde apps/api.
  root: import.meta.dirname,
  test: {
    include: ['apps/api/test/**/*.db.test.ts'],
    globalSetup: ['apps/api/test/global-setup.ts'],
    environment: 'node',
    // Todas las pruebas comparten la base de prueba: se ejecutan de a un archivo.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
