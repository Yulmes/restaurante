import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

/**
 * E2E de la operación (M7, escenario 2 de §11): el staff mueve pedidos en el Pase (confirmar con
 * captura, preparar, listo / en camino, entregar, cancelar con motivo), el cliente los sigue en la
 * línea de marea y en su historial, y los correos de estado llegan a Mailpit en el idioma de cada
 * cuenta y a la bandeja de demostración. Chromium de escritorio y WebKit con perfil de iPhone.
 *
 * Usa su propia API y su propia web (3420 y 5198), como la suite de pagos, para no compartir el
 * freno global de ráfagas de la API. Comparte la base `<base>_e2e`, que recrea al empezar: las
 * suites corren una después de la otra, nunca a la vez. Necesita Mailpit (`docker compose up`).
 *
 * `npm run test:e2e:operacion` corre cada motor en una invocación aparte (API nueva cada vez): los
 * dos juntos superan el freno global de ráfagas por IP (300 / 5 min, §8.4), que vive en la memoria
 * de la API. La política no se relaja para las pruebas.
 *
 * ⚠️ `Mobile Safari` es el motor WebKit de Playwright con viewport y user agent de iPhone, en
 * Windows o Linux: **no** es Safari de iOS en un dispositivo real.
 *
 * API propia (3400) sobre la base `<base>_e2e` (recreada) y web de desarrollo en el 5178. La API
 * corre con `ORDERS_ALLOW_OUTSIDE_HOURS=true` (modo de demostración, D-M5-3) para que las pruebas
 * no dependan de la hora; el bloqueo fuera de horario se prueba en integración. Sin correo real:
 * las cuentas se crean ya verificadas en la base E2E (`scripts/e2e-user.ts`).
 */
const API_PORT = 3420;
const WEB_PORT = 5198;
export const OPERATION_WEB_URL = `http://127.0.0.1:${String(WEB_PORT)}`;

const rootEnvFile = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile);

function e2eDatabase(url: string | undefined): string {
  if (!url) throw new Error('Faltan DATABASE_URL y MIGRATION_DATABASE_URL (copiá .env.example a .env).');
  const parsed = new URL(url);
  parsed.pathname = `${parsed.pathname}_e2e`;
  return parsed.toString();
}

/** Base de la API de estas E2E (rol de la aplicación). */
export const OPERATION_E2E_DATABASE_URL = e2eDatabase(process.env['DATABASE_URL']);

export default defineConfig({
  testDir: './e2e/operacion',
  // Comparten la base E2E: de a una prueba por vez.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  timeout: 90_000,
  reporter: process.env['CI']
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-operacion' }]]
    : 'list',
  use: { baseURL: OPERATION_WEB_URL, trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'Mobile Safari', use: { ...devices['iPhone 13'] } },
  ],
  webServer: [
    {
      command: 'npm run db:e2e -w @marea-baja/api && npm run start -w @marea-baja/api',
      cwd: '../..',
      env: {
        NODE_ENV: 'development',
        DATABASE_URL: OPERATION_E2E_DATABASE_URL,
        API_PORT: String(API_PORT),
        PUBLIC_WEB_URL: OPERATION_WEB_URL,
        // Correos de estado reales en Mailpit (§11: correos en ambos idiomas).
        EMAIL_PROVIDER: 'mailpit',
        BOT_CHECK_PROVIDER: 'fake',
        ORDERS_ALLOW_OUTSIDE_HOURS: 'true',
        // M6: tarjeta demo con el selector de escenarios (§7.4).
        DEMO_PAYMENTS_ENABLED: 'true',
        // M7: el Pase con las mismas reglas de producción (20 min para confirmar).
        ORDER_CONFIRMATION_TIMEOUT_MINUTES: '20',
        LOG_LEVEL: 'warn',
      },
      url: `http://127.0.0.1:${String(API_PORT)}/api/health`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command: `npm run dev -w @marea-baja/web -- --port ${String(WEB_PORT)}`,
      cwd: '../..',
      env: { API_PROXY_TARGET: `http://127.0.0.1:${String(API_PORT)}` },
      url: `${OPERATION_WEB_URL}/pedido`,
      reuseExistingServer: false,
      timeout: 300_000,
    },
  ],
});
