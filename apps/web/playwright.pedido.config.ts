import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

/**
 * E2E del pedido (M5): carrito de invitado, hoja de producto, fusión al iniciar sesión, checkout de
 * 3 pasos, direcciones, cambio de precio y confirmación (desde M6, con la tarjeta demo "Aprobado"),
 * en Chromium de escritorio y en WebKit con el perfil de un iPhone (`Mobile Safari`). Los
 * escenarios de pago tienen su propia suite: `playwright.pagos.config.ts`.
 *
 * ⚠️ `Mobile Safari` es el motor WebKit de Playwright con viewport y user agent de iPhone, en
 * Windows o Linux: **no** es Safari de iOS en un dispositivo real.
 *
 * API propia (3400) sobre la base `<base>_e2e` (recreada) y web de desarrollo en el 5178. La API
 * corre con `ORDERS_ALLOW_OUTSIDE_HOURS=true` (modo de demostración, D-M5-3) para que las pruebas
 * no dependan de la hora; el bloqueo fuera de horario se prueba en integración. Sin correo real:
 * las cuentas se crean ya verificadas en la base E2E (`scripts/e2e-user.ts`).
 */
const API_PORT = 3400;
const WEB_PORT = 5178;
export const ORDER_WEB_URL = `http://127.0.0.1:${String(WEB_PORT)}`;

const rootEnvFile = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile);

function e2eDatabase(url: string | undefined): string {
  if (!url) throw new Error('Faltan DATABASE_URL y MIGRATION_DATABASE_URL (copiá .env.example a .env).');
  const parsed = new URL(url);
  parsed.pathname = `${parsed.pathname}_e2e`;
  return parsed.toString();
}

/** Base de la API de estas E2E (rol de la aplicación). */
export const ORDER_E2E_DATABASE_URL = e2eDatabase(process.env['DATABASE_URL']);

export default defineConfig({
  testDir: './e2e/pedido',
  // Comparten la base E2E y cambian precios: de a una prueba por vez.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  timeout: 90_000,
  reporter: process.env['CI']
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-pedido' }]]
    : 'list',
  use: { baseURL: ORDER_WEB_URL, trace: 'retain-on-failure' },
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
        DATABASE_URL: ORDER_E2E_DATABASE_URL,
        API_PORT: String(API_PORT),
        PUBLIC_WEB_URL: ORDER_WEB_URL,
        EMAIL_PROVIDER: 'memory',
        BOT_CHECK_PROVIDER: 'fake',
        ORDERS_ALLOW_OUTSIDE_HOURS: 'true',
        // M6: tarjeta demo con el selector de escenarios (§7.4).
        DEMO_PAYMENTS_ENABLED: 'true',
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
      url: `${ORDER_WEB_URL}/pedido`,
      reuseExistingServer: false,
      timeout: 300_000,
    },
  ],
});
