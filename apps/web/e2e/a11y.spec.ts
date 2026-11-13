import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { PAGES, openPage } from './helpers.ts';

// Validación V1 (D1): axe-core sobre cada componente en cada estado visible en /_design.
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

for (const path of PAGES) {
  test(`axe sin violaciones WCAG 2.2 AA en ${path}`, async ({ page }) => {
    await openPage(page, path);
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    const summary = results.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 5),
    }));
    expect(summary).toEqual([]);
    expect(results.passes.length).toBeGreaterThan(0);
  });
}

test('axe también pasa después de interactuar con opciones y cantidad', async ({ page }) => {
  await openPage(page, '/_design');
  await page.getByRole('checkbox', { name: /Camote/ }).check();
  await page.getByRole('button', { name: 'Agregar uno' }).click();
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
});
