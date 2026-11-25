import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

/**
 * E2E del admin (M8, escenarios 3 y 4 de §11: seguridad y errores, sobre el admin de §12). El
 * admin edita la carta, publica la pesca del día, cambia la configuración, bloquea una cuenta,
 * cancela y reembolsa pedidos; el staff y el cliente no entran; los conflictos y las validaciones
 * se ven en la interfaz. Chromium de escritorio y WebKit con perfil de iPhone.
 *
 * Usa su propia API y su propia web (3430 y 5208), como las suites de pagos y operación. Comparte
 * la base `<base>_e2e`, que recrea al empezar: las suites corren una después de la otra.
 *
 * `npm run test:e2e:admin` corre cada motor en una invocación aparte (API nueva cada vez), por el
 * freno global de ráfagas por IP (300 / 5 min, §8.4). La política no se relaja para las pruebas.
 *
 * ⚠️ `Mobile Safari` es el motor WebKit de Playwright con viewport y user agent de iPhone, en
 * Windows o Linux: **no** es Safari de iOS en un dispositivo real.
 */
const API_PORT = 3430;
const WEB_PORT = 5208;
export const ADMIN_WEB_URL = `http://127.0.0.1:${String(WEB_PORT)}`;

const rootEnvFile = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile);

function e2eDatabase(url: string | undefined): string {
  if (!url) throw new Error('Faltan DATABASE_URL y MIGRATION_DATABASE_URL (copiá .env.example a .env).');
  const parsed = new URL(url);
  parsed.pathname = `${parsed.pathname}_e2e`;
  return parsed.toString();
}

/** Base de la API de estas E2E (rol de la aplicación). */
export const ADMIN_E2E_DATABASE_URL = e2eDatabase(process.env['DATABASE_URL']);

export default defineConfig({
  testDir: './e2e/admin',
  // Comparten la base E2E: de a una prueba por vez.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  timeout: 120_000,
  reporter: process.env['CI']
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-admin' }]]
    : 'list',
  use: { baseURL: ADMIN_WEB_URL, trace: 'retain-on-failure' },
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
        DATABASE_URL: ADMIN_E2E_DATABASE_URL,
        API_PORT: String(API_PORT),
        PUBLIC_WEB_URL: ADMIN_WEB_URL,
        // Los correos de estado no son el objeto de esta suite: quedan en la bandeja demo, sin Mailpit.
        EMAIL_PROVIDER: 'demo',
        BOT_CHECK_PROVIDER: 'fake',
        ORDERS_ALLOW_OUTSIDE_HOURS: 'true',
        DEMO_PAYMENTS_ENABLED: 'true',
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
      url: `${ADMIN_WEB_URL}/pedido`,
      reuseExistingServer: false,
      timeout: 300_000,
    },
  ],
});
