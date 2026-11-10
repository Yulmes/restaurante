/**
 * Comprueba las variables de entorno sin arrancar la API: `npm run env:check`.
 * Lee el archivo .env de la raíz del repositorio si existe; las variables ya
 * definidas en el proceso tienen prioridad. No imprime ningún valor.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EnvValidationError, loadEnv } from './env.ts';

const rootEnvFile = fileURLToPath(new URL('../../../../.env', import.meta.url));

if (existsSync(rootEnvFile)) {
  process.loadEnvFile(rootEnvFile);
}

try {
  const env = loadEnv();
  console.log(`Variables de entorno válidas (NODE_ENV=${env.NODE_ENV}).`);
} catch (error) {
  if (error instanceof EnvValidationError) {
    console.error(error.message);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
