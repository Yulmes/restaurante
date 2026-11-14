import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

/**
 * E2E del catálogo y SEO (M4) sobre el **build de producción** prerenderizado, servido como lo
 * hará el hosting estático (`scripts/serve-build.ts`): así se prueban el HTML crudo, los
 * metadatos, el sitemap y la actualización en vivo al hidratar (D10), no el servidor de
 * desarrollo. Base aparte (`<base>_e2e`), API en el 3200 y sitio en el 5175.
 */
const API_PORT = 3200;
const WEB_PORT = 5175;
export const SITE = `http://127.0.0.1:${String(WEB_PORT)}`;

const rootEnvFile = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile);

function e2eDatabase(url: string | undefined): string {
  if (!url) throw new Error('Faltan DATABASE_URL y MIGRATION_DATABASE_URL (copiá .env.example a .env).');
  const parsed = new URL(url);
  parsed.pathname = `${parsed.pathname}_e2e`;
  return parsed.toString();
}

export const CATALOG_E2E_DATABASE_URL = e2eDatabase(process.env['DATABASE_URL']);
const API = `http://127.0.0.1:${String(API_PORT)}`;

export default defineConfig({
  testDir: './e2e/catalogo',
  // Algunas pruebas cambian datos de la base E2E: de a una por vez.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI']
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-catalog' }]]
    : 'list',
  use: { baseURL: SITE, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run db:e2e -w @marea-baja/api && npm run start -w @marea-baja/api',
      cwd: '../..',
      env: {
        NODE_ENV: 'development',
        DATABASE_URL: CATALOG_E2E_DATABASE_URL,
        API_PORT: String(API_PORT),
        PUBLIC_WEB_URL: SITE,
        EMAIL_PROVIDER: 'memory',
        BOT_CHECK_PROVIDER: 'fake',
        LOG_LEVEL: 'warn',
      },
      url: `${API}/api/health`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      // El build lee la API (prerender); por eso espera a que responda el catálogo.
      command: 'npm run build -w @marea-baja/web && npm run preview -w @marea-baja/web',
      cwd: '../..',
      env: {
        CATALOG_API_URL: API,
        VITE_SITE_URL: SITE,
        API_PROXY_TARGET: API,
        PORT: String(WEB_PORT),
      },
      url: `${SITE}/sitemap.xml`,
      reuseExistingServer: false,
      timeout: 600_000,
    },
  ],
});
