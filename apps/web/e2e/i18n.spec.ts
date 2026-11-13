import { expect, test } from '@playwright/test';
import { openPage } from './helpers.ts';

// D2: es-CR por defecto, inglés desde la v1, selector accesible a la misma página.
test('es-CR por defecto y cambio a inglés en la misma página', async ({ page }) => {
  await openPage(page, '/_design');
  await expect(page.locator('html')).toHaveAttribute('lang', 'es-CR');
  await expect(page.locator('main h1')).toHaveText('Sistema de diseño');
  await expect(page).toHaveTitle('Sistema de diseño · Marea Baja');

  const nav = page.getByRole('navigation', { name: 'Idioma' });
  await expect(nav.getByRole('link', { name: 'ES · Español (Costa Rica)', exact: true })).toHaveAttribute(
    'aria-current',
    'true',
  );
  await nav.getByRole('link', { name: /^EN · English$/ }).click();

  await expect(page).toHaveURL(/\/en\/_design$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('main h1')).toHaveText('Design system');
  await expect(page).toHaveTitle('Design system · Marea Baja');
  const navEn = page.getByRole('navigation', { name: 'Language' });
  await expect(navEn.getByRole('link', { name: /^EN · English$/ })).toHaveAttribute('aria-current', 'true');
  await expect(navEn.getByRole('link', { name: /^EN · English$/ })).toHaveAttribute('hreflang', 'en');

  await navEn.getByRole('link', { name: 'ES · Español (Costa Rica)', exact: true }).click();
  await expect(page).toHaveURL(/\/_design$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'es-CR');
});

test('los precios usan el formato de cada idioma y conservan el nombre original del plato', async ({
  page,
}) => {
  await openPage(page, '/_design');
  const line = page.locator('article').filter({ hasText: 'Ceviche clásico de corvina' });
  await expect(line).toContainText('₡8 900');
  await openPage(page, '/en/_design');
  const lineEn = page.locator('article').filter({ hasText: 'Ceviche clásico de corvina' });
  await expect(lineEn).toContainText('₡8,900');
  await expect(lineEn).toContainText('Mesino lime');
});

test('las páginas internas no se indexan', async ({ page }) => {
  await openPage(page, '/_design');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
});
