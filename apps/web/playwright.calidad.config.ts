import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

/**
 * Auditoría de calidad de M9 (§12: accesibilidad en pantallas reales y en los dos idiomas, D1;
 * revisión responsive y *finish gate*, §2.4). Recorre las pantallas reales de M1–M8 con sus
 * roles (visitante, cliente con un pedido, admin) y, en cada una:
 * - axe con las etiquetas WCAG 2.2 AA (todas las violaciones quedan en el informe; la prueba
 *   falla con las serias o críticas, el mismo criterio de M1–M8);
 * - desbordamiento horizontal a 375, 768, 1024 y 1280 px;
 * - captura real de cada ancho (evidencia del *finish gate*);
 * - foco visible en los primeros elementos de la tabulación y movimiento reducido.
 *
 * Usa su propia API y su propia web (3440 y 5218), como las suites de pagos, operación y admin, y
 * recrea `<base>_e2e` al empezar. Un proyecto por idioma (`es-CR`, `en`), cada uno en su propia
 * invocación por el freno global de ráfagas (§8.4). Corre en Chromium: la revisión por motor está en las suites de
 * cada hito (WebKit con perfil de iPhone).
 */
const API_PORT = 3440;
const WEB_PORT = 5218;
export const QUALITY_WEB_URL = `http://127.0.0.1:${String(WEB_PORT)}`;

const rootEnvFile = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile);

function e2eDatabase(url: string | undefined): string {
  if (!url) throw new Error('Faltan DATABASE_URL y MIGRATION_DATABASE_URL (copiá .env.example a .env).');
  const parsed = new URL(url);
  parsed.pathname = `${parsed.pathname}_e2e`;
  return parsed.toString();
}

/** Base de la API de estas E2E (rol de la aplicación). */
export const QUALITY_E2E_DATABASE_URL = e2eDatabase(process.env['DATABASE_URL']);

export default defineConfig({
  testDir: './e2e/calidad',
  // Comparten la base E2E: de a una prueba por vez.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  timeout: 600_000,
  reporter: process.env['CI']
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-calidad' }]]
    : 'list',
  use: { baseURL: QUALITY_WEB_URL, trace: 'retain-on-failure' },
  // Un proyecto por idioma, cada uno en su propia invocación (`npm run test:calidad`).
  projects: [
    { name: 'es-CR', use: { ...devices['Desktop Chrome'] } },
    { name: 'en', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: [
    {
      command: 'npm run db:e2e -w @marea-baja/api && npm run start -w @marea-baja/api',
      cwd: '../..',
      env: {
        NODE_ENV: 'development',
        DATABASE_URL: QUALITY_E2E_DATABASE_URL,
        API_PORT: String(API_PORT),
        PUBLIC_WEB_URL: QUALITY_WEB_URL,
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
      url: `${QUALITY_WEB_URL}/pedido`,
      reuseExistingServer: false,
      timeout: 300_000,
    },
  ],
});
