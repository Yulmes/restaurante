import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

/**
 * E2E sobre el BUILD DE PRODUCCIÓN (no el servidor de desarrollo): `react-router build` y
 * `vite preview`, que sirve `build/client/index.html` para toda ruta sin archivo propio, como el
 * hosting estático (fallback SPA). Ahí aparecen problemas que el servidor de desarrollo no muestra,
 * porque este genera el HTML de cada URL. Levanta su propia API (puerto 3300) sobre `<base>_e2e`
 * (recreada en cada corrida). Requiere `npm run services:up`.
 */
const API_PORT = 3300;
const WEB_PORT = 5177;
export const WEB_URL = `http://127.0.0.1:${String(WEB_PORT)}`;

const rootEnvFile = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile);

function e2eDatabase(url: string | undefined): string {
  if (!url) throw new Error('Faltan DATABASE_URL y MIGRATION_DATABASE_URL (copiá .env.example a .env).');
  const parsed = new URL(url);
  parsed.pathname = `${parsed.pathname}_e2e`;
  return parsed.toString();
}

export default defineConfig({
  testDir: './e2e/produccion',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI']
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-produccion' }]]
    : 'list',
  use: { baseURL: WEB_URL, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run db:e2e -w @marea-baja/api && npm run start -w @marea-baja/api',
      cwd: '../..',
      env: {
        NODE_ENV: 'development',
        DATABASE_URL: e2eDatabase(process.env['DATABASE_URL']),
        API_PORT: String(API_PORT),
        PUBLIC_WEB_URL: WEB_URL,
        EMAIL_PROVIDER: 'mailpit',
        BOT_CHECK_PROVIDER: 'fake',
        LOG_LEVEL: 'warn',
      },
      url: `http://127.0.0.1:${String(API_PORT)}/api/health`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      // `vite preview` usa el mismo proxy de /api que el servidor de desarrollo (preview.proxy).
      command: `npm run build -w @marea-baja/web && npm exec -w @marea-baja/web -- vite preview --host 127.0.0.1 --port ${String(WEB_PORT)} --strictPort`,
      cwd: '../..',
      env: { API_PROXY_TARGET: `http://127.0.0.1:${String(API_PORT)}` },
      url: `${WEB_URL}/`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
