import type { Page } from '@playwright/test';

export const PAGES = ['/', '/en', '/_design', '/en/_design'] as const;
export const WIDTHS = [375, 768, 1024, 1440] as const;

/** Espera a que la app hidrate y a que las fuentes terminen de cargar. */
export async function openPage(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.locator('main h1').waitFor();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}
