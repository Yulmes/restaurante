import { defineConfig, devices } from '@playwright/test';

/**
 * Pruebas de navegador de M1: accesibilidad (axe), teclado, idiomas, responsive,
 * movimiento reducido y fuentes. Corren contra el servidor de desarrollo.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5173/_design',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
