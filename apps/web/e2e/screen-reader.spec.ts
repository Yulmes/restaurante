import { expect, test } from '@playwright/test';
import { PAGES, openPage } from './helpers.ts';

/**
 * Lo que un lector de pantalla (NVDA, JAWS, VoiceOver) obtiene del árbol de
 * accesibilidad del navegador: encabezados, regiones, nombres, estados y anuncios.
 * Complementa, no reemplaza, la prueba manual con NVDA (docs/m1/PRUEBA_NVDA.md).
 */
for (const path of PAGES) {
  test(`${path}: jerarquía de encabezados sin saltos y un único h1`, async ({ page }) => {
    await openPage(page, path);
    const levels = await page.evaluate(() =>
      [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')]
        .filter((h) => !h.closest('[aria-hidden="true"]'))
        .map((h) => Number(h.tagName.slice(1))),
    );
    expect(levels.filter((l) => l === 1)).toHaveLength(1);
    expect(levels[0]).toBe(1);
    const jumps = levels.flatMap((level, i) => (i > 0 && level > (levels[i - 1] ?? 0) + 1 ? [i] : []));
    expect(jumps).toEqual([]);
  });

  test(`${path}: regiones principales y enlace para saltar`, async ({ page }) => {
    await openPage(page, path);
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.getByRole('banner')).toHaveCount(1);
    await expect(page.getByRole('navigation')).toHaveAccessibleName(/^(Idioma|Language)$/);
    await expect(page.getByRole('link', { name: /^(Saltar al contenido|Skip to content)$/ })).toHaveCount(1);
  });

  test(`${path}: todo control e imagen tiene nombre; lo decorativo está oculto`, async ({ page }) => {
    await openPage(page, path);
    for (const role of ['button', 'link', 'textbox', 'radio', 'checkbox', 'img'] as const) {
      for (const element of await page.getByRole(role).all()) {
        await expect(element).toHaveAccessibleName(/\S/);
      }
    }
    const unlabeledSvgs = await page.evaluate(
      () =>
        [...document.querySelectorAll('svg')].filter(
          (svg) => svg.getAttribute('aria-hidden') !== 'true' && svg.getAttribute('role') !== 'img',
        ).length,
    );
    expect(unlabeledSvgs).toBe(0);
  });
}

test('el idioma de cada enlace del selector está declarado para cambiar la voz', async ({ page }) => {
  await openPage(page, '/_design');
  await expect(page.getByRole('link', { name: /English/ })).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('link', { name: /Español/ })).toHaveAttribute('lang', 'es-CR');
});

test('los cambios de cantidad se anuncian con contexto ("Cantidad: 26")', async ({ page }) => {
  await openPage(page, '/_design');
  const live = page.locator('output[aria-live="polite"]');
  await page.getByRole('button', { name: 'Agregar uno' }).click();
  await expect(live).toHaveText('Cantidad: 26');
  await expect(page.getByRole('group', { name: 'Cantidad' })).toBeVisible();
});

test('el contador de extras es una región en vivo descrita por el grupo', async ({ page }) => {
  await openPage(page, '/_design');
  const extras = page.getByRole('group', { name: 'Extras' });
  await expect(extras).toHaveAccessibleDescription(/Elegí hasta 2 · elegiste 1 de 2/);
  await page.getByRole('checkbox', { name: /Camote/ }).check();
  await expect(extras).toHaveAccessibleDescription(/elegiste 2 de 2/);
  await expect(page.getByRole('checkbox', { name: /Salsa chalaca/ })).toBeDisabled();
});

test('el plato agotado se anuncia como agotado, no solo con el tachado', async ({ page }) => {
  await openPage(page, '/_design');
  const soldOut = page.locator('article').filter({ hasText: 'Ceviche de pulpo al olivo' });
  await expect(soldOut).toContainText('Agotado hoy');
  // El precio y la etiqueta no deben leerse pegados ("₡10 200Agotado hoy").
  await expect(soldOut).toContainText(', Agotado hoy');
});
