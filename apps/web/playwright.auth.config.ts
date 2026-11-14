import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

/**
 * E2E de identidad (M3, §11 "escenario 1, parte de auth"): web + API + PostgreSQL + Mailpit.
 * Levanta una API propia (puerto 3100) sobre una base aparte (`<base>_e2e`, recreada en cada
 * corrida) y la web en el 5174 con el proxy apuntando a esa API. No toca la base de desarrollo
 * ni choca con los servidores de desarrollo. Requiere `npm run services:up`.
 */
const API_PORT = 3100;
const WEB_PORT = 5174;
export const WEB_URL = `http://127.0.0.1:${String(WEB_PORT)}`;
/** Umbral de Turnstile de la base E2E: el desafío se prueba con pocos fallos. */
export const E2E_TURNSTILE_THRESHOLD = 3;

const rootEnvFile = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile);

function e2eDatabase(url: string | undefined): string {
  if (!url) throw new Error('Faltan DATABASE_URL y MIGRATION_DATABASE_URL (copiá .env.example a .env).');
  const parsed = new URL(url);
  parsed.pathname = `${parsed.pathname}_e2e`;
  return parsed.toString();
}

/** Base de la API de las E2E (rol de la aplicación). */
export const E2E_DATABASE_URL = e2eDatabase(process.env['DATABASE_URL']);

const apiEnv = {
  NODE_ENV: 'development',
  DATABASE_URL: E2E_DATABASE_URL,
  API_PORT: String(API_PORT),
  PUBLIC_WEB_URL: WEB_URL,
  EMAIL_PROVIDER: 'mailpit',
  BOT_CHECK_PROVIDER: 'fake',
  LOG_LEVEL: 'warn',
};

export default defineConfig({
  testDir: './e2e/auth',
  // Comparten Mailpit y los límites por IP: de a una prueba por vez.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI']
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-auth' }]]
    : 'list',
  use: { baseURL: WEB_URL, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: `npm run db:e2e -w @marea-baja/api -- --turnstile-threshold ${String(E2E_TURNSTILE_THRESHOLD)} && npm run start -w @marea-baja/api`,
      cwd: '../..',
      env: apiEnv,
      url: `http://127.0.0.1:${String(API_PORT)}/api/health`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command: `npm run dev -w @marea-baja/web -- --port ${String(WEB_PORT)}`,
      cwd: '../..',
      env: { API_PROXY_TARGET: `http://127.0.0.1:${String(API_PORT)}` },
      url: `${WEB_URL}/cuenta/ingresar`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
