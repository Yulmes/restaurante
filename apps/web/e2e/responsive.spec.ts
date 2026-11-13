import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { WIDTHS, openPage } from './helpers.ts';

const LOCALES = [
  { id: 'es-CR', path: '/_design' },
  { id: 'en', path: '/en/_design' },
] as const;

const EVIDENCE_DIR = fileURLToPath(new URL('../../../docs/evidencias/m1/', import.meta.url));

// §3.10 / V5: 375, 768, 1024 y 1440 px en los dos idiomas.
for (const locale of LOCALES) {
  for (const width of WIDTHS) {
    test(`${locale.id} a ${String(width)} px: sin desborde horizontal ni textos cortados`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await openPage(page, locale.path);
      const layout = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const overflowX = document.documentElement.scrollWidth - vw;
        const clipped = [...document.querySelectorAll<HTMLElement>('.t-price, h1, h2, h3, label, button, a')]
          .filter((el) => {
            if (el.closest('.overflow-x-auto')) return false;
            const r = el.getBoundingClientRect();
            return r.width > 0 && (r.right > vw + 1 || r.left < -1);
          })
          .map((el) => el.textContent.trim().slice(0, 30));
        return { overflowX, clipped };
      });
      expect(layout.overflowX).toBeLessThanOrEqual(0);
      expect(layout.clipped).toEqual([]);
    });
  }
}

test('a 375 px los precios son legibles: ≥ 17 px, en una línea y sin superponerse al nombre', async ({
  page,
}) => {
  for (const locale of LOCALES) {
    await page.setViewportSize({ width: 375, height: 900 });
    await openPage(page, locale.path);
    const prices = await page.locator('article .t-price').evaluateAll((els) =>
      els.map((el) => {
        const name = el.closest('article')?.querySelector('h3');
        const p = el.getBoundingClientRect();
        const n = name?.getBoundingClientRect();
        return {
          text: el.textContent,
          fontSize: parseFloat(getComputedStyle(el).fontSize),
          lines: el.getClientRects().length,
          overlapsName: n ? p.left < n.right && p.top < n.bottom && p.bottom > n.top : false,
        };
      }),
    );
    expect(prices.length).toBe(4);
    for (const price of prices) {
      expect(price.fontSize, `${locale.id} ${price.text}`).toBeGreaterThanOrEqual(17);
      expect(price.lines, `${locale.id} ${price.text}`).toBe(1);
      expect(price.overlapsName, `${locale.id} ${price.text}`).toBe(false);
    }
  }
});

test('el ₡ se dibuja con la fuente de respaldo aprobada', async ({ page }) => {
  await openPage(page, '/_design');
  const ok = await page.evaluate(() => document.fonts.check('700 17px "Marea Colon"', '₡'));
  const loaded = await page.evaluate(() =>
    [...document.fonts].some((f) => f.family.includes('Marea Colon') && f.status === 'loaded'),
  );
  expect(ok).toBe(true);
  expect(loaded).toBe(true);
});

test('con movimiento reducido el trazo del logotipo no se anima', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openPage(page, '/_design');
  const animation = await page
    .locator('.marea-draw')
    .first()
    .evaluate((el) => getComputedStyle(el).animationName);
  expect(animation).toBe('none');
});

test('capturas de evidencia en 4 anchos y 2 idiomas @capturas', async ({ page }) => {
  test.skip(!process.env['CAPTURAS'], 'Solo con CAPTURAS=1 (npm run capturas)');
  test.setTimeout(120_000);
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  for (const locale of LOCALES) {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await openPage(page, locale.path);
      await page.screenshot({
        path: `${EVIDENCE_DIR}design-${locale.id}-${String(width)}.png`,
        fullPage: true,
      });
    }
  }
});
