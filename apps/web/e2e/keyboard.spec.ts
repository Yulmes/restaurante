import { expect, test } from '@playwright/test';
import { openPage } from './helpers.ts';

// §3.10: foco siempre visible y no tapado; errores y deshabilitados accesibles.
test('el enlace "Saltar al contenido" es lo primero y lleva al contenido', async ({ page }) => {
  await openPage(page, '/_design');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Saltar al contenido' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
});

test('cada elemento enfocable muestra un foco visible y no queda tapado', async ({ page }) => {
  await openPage(page, '/_design');
  const problems: string[] = [];
  let visited = 0;
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      el.scrollIntoView({ block: 'center' });
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const topEl = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return {
        label: `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent).trim().slice(0, 30)}"`,
        outline: style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2,
        covered: !(topEl && (topEl === el || el.contains(topEl) || topEl.contains(el))),
      };
    });
    if (!info) continue;
    visited++;
    if (!info.outline) problems.push(`${info.label}: sin anillo de foco`);
    if (info.covered) problems.push(`${info.label}: tapado por otro elemento`);
  }
  expect(visited).toBeGreaterThan(15);
  expect(problems).toEqual([]);
});

test('el botón deshabilitado anuncia su motivo', async ({ page }) => {
  await openPage(page, '/_design');
  const disabled = page.locator('button[disabled]').first();
  await expect(disabled).toHaveAccessibleDescription('Elegí una salsa para continuar.');
});

test('el campo con error se marca como inválido y describe el error', async ({ page }) => {
  await openPage(page, '/_design');
  const phone = page.getByLabel('Teléfono');
  await expect(phone).toHaveAttribute('aria-invalid', 'true');
  await expect(phone).toHaveAccessibleDescription(/8 dígitos/);
  await expect(page.getByRole('alert')).toContainText('Revisá 2 datos para continuar');
});

test('el selector de cantidad no tiene tope de 20 (regla C5)', async ({ page }) => {
  await openPage(page, '/_design');
  const output = page.locator('output');
  await expect(output).toHaveText('Cantidad: 25');
  for (let i = 0; i < 5; i++) await page.getByRole('button', { name: 'Agregar uno' }).click();
  await expect(output).toHaveText('Cantidad: 30');
});

test('el botón no cambia de ancho al pasar a "procesando" (§3.3)', async ({ page }) => {
  await openPage(page, '/_design');
  const rest = await page.getByRole('button', { name: 'Agregar al pedido' }).first().boundingBox();
  const loading = page.locator('button[aria-busy="true"]');
  await expect(loading).toHaveAccessibleName('Procesando…');
  const box = await loading.boundingBox();
  expect(Math.round(box?.width ?? 0)).toBe(Math.round(rest?.width ?? -1));
});
