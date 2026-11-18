import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

/**
 * E2E sobre el BUILD DE PRODUCCIÓN (no el servidor de desarrollo): el build de M4 con prerender
 * (`npm run build`), servido por `scripts/serve-build.ts` (`npm run preview`) como el hosting
 * estático. Las páginas públicas reciben su HTML prerenderizado; el resto (cuenta, `/_design`,
 * 404), el fallback real `__spa-fallback.html`, renderizado desde `/` con `lang="es-CR"`.
 *
 * `vite preview` no sirve para esto: entrega `index.html` (la portada prerenderizada en español)
 * para cualquier ruta, incluso las que tienen HTML propio.
 *
 * Levanta su propia API (puerto 3300) sobre `<base>_e2e` (recreada en cada corrida); el build la
 * usa para prerenderizar el catálogo. Requiere `npm run services:up`.
 */
const API_PORT = 3300;
const WEB_PORT = 5177;
export const WEB_URL = `http://127.0.0.1:${String(WEB_PORT)}`;
const API = `http://127.0.0.1:${String(API_PORT)}`;

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
      url: `${API}/api/health`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      // El build lee la API (prerender del catálogo); por eso va después de que la API responde.
      command: 'npm run build -w @marea-baja/web && npm run preview -w @marea-baja/web',
      cwd: '../..',
      env: {
        CATALOG_API_URL: API,
        VITE_SITE_URL: WEB_URL,
        API_PROXY_TARGET: API,
        PORT: String(WEB_PORT),
      },
      url: `${WEB_URL}/sitemap.xml`,
      reuseExistingServer: false,
      timeout: 600_000,
    },
  ],
});
