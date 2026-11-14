import { defineConfig, devices } from '@playwright/test';

/**
 * Pruebas de navegador de M1: accesibilidad (axe), teclado, idiomas, responsive,
 * movimiento reducido y fuentes. Corren contra el servidor de desarrollo y la API.
 */
export default defineConfig({
  testDir: './e2e',
  // Las E2E de identidad necesitan API y base: corren con playwright.auth.config.ts.
  testIgnore: ['auth/**', 'catalogo/**'],
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Desde M4 las páginas públicas leen la API del catálogo: se levanta también la API
  // (base de desarrollo, preparada con `npm run db:setup`).
  webServer: [
    {
      command: 'npm run start -w @marea-baja/api',
      cwd: '../..',
      url: 'http://127.0.0.1:3000/api/health',
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
    },
    {
      command: 'npm run dev',
      url: 'http://127.0.0.1:5173/_design',
      reuseExistingServer: !process.env['CI'],
      timeout: 300_000,
    },
  ],
});
