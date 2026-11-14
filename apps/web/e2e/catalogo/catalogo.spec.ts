/**
 * E2E del catálogo y SEO (M4) sobre el build de producción prerenderizado.
 * - HTML crudo (lo que leen los buscadores): idioma, canónica, hreflang, Open Graph, JSON-LD.
 * - sitemap, robots, catalog-version y noindex del fallback SPA.
 * - Precio y disponibilidad en vivo al hidratar (D10).
 * - Carta: búsqueda, filtros, índice; navegación, teclado, idioma y móvil; accesibilidad (axe).
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { CATALOG_E2E_DATABASE_URL, SITE } from '../../playwright.catalog.config.ts';

const API_DIR = fileURLToPath(new URL('../../../api/', import.meta.url));

function setProduct(slug: string, changes: { price?: number; available?: boolean }): void {
  const args = ['scripts/e2e-catalog.ts', '--slug', slug];
  if (changes.price !== undefined) args.push('--price', String(changes.price));
  if (changes.available !== undefined) args.push('--available', String(changes.available));
  execFileSync('node', args, {
    cwd: API_DIR,
    env: { ...process.env, DATABASE_URL: CATALOG_E2E_DATABASE_URL },
  });
}

/**
 * Espera a que React hidrate el HTML prerenderizado: antes, los botones existen pero todavía no
 * responden. Una persona en una red lenta también lo nota (ver VALIDACIONES_M4).
 */
async function hydrated(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const button = document.querySelector('main button, header button');
    return button !== null && Object.keys(button).some((key) => key.startsWith('__reactProps'));
  });
}

async function rawHtml(page: Page, path: string): Promise<string> {
  const res = await page.request.get(path);
  expect(res.status()).toBe(200);
  return res.text();
}

const attr = (html: string, pattern: RegExp): string[] => [...html.matchAll(pattern)].map((m) => m[1] ?? '');

async function expectNoSeriousA11yViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

const PAGES = [
  ['/', '/en'],
  ['/carta', '/en/menu'],
  ['/carta/tiraditos', '/en/menu/tiraditos'],
  ['/carta/calientes/pulpo-anticuchero', '/en/menu/calientes/pulpo-anticuchero'],
  ['/nosotros', '/en/about'],
  ['/visitanos', '/en/visit'],
] as const;

test.describe('HTML prerenderizado (§4.2)', () => {
  for (const [es, en] of PAGES) {
    test(`${es} y ${en}: idioma, canónica, hreflang, Open Graph y JSON-LD en el HTML crudo`, async ({
      page,
    }) => {
      for (const [path, lang, other] of [
        [es, 'es-CR', en],
        [en, 'en', es],
      ] as const) {
        const html = await rawHtml(page, path);
        expect(html).toContain(`<html lang="${lang}">`);
        expect(attr(html, /<link rel="canonical" href="([^"]+)"/g)).toEqual([`${SITE}${path}`]);
        expect(attr(html, /<link rel="alternate" hrefLang="([^"]+)"/g)).toEqual(['es-CR', 'en', 'x-default']);
        expect(html).toContain(`hrefLang="${lang === 'en' ? 'es-CR' : 'en'}" href="${SITE}${other}"`);
        expect(html).toMatch(/<meta property="og:image" content="[^"]+\/og-1200\.jpg"\/>/);
        expect(html).toMatch(/<meta name="description" content="[^"]{40,}"\/>/);
        expect(html).not.toContain('name="robots"');
        // El contenido está en el HTML, no solo después de hidratar.
        expect(html).toMatch(/<h1[^>]*>/);
      }
    });
  }

  test('JSON-LD válido: restaurante, carta con precios en CRC y plato agotado', async ({ page }) => {
    const ld = async (path: string) => {
      const html = await rawHtml(page, path);
      return attr(html, /<script type="application\/ld\+json">([^<]+)<\/script>/g).map(
        (json) => JSON.parse(json) as Record<string, unknown>,
      );
    };
    expect(await ld('/')).toEqual([expect.objectContaining({ '@type': 'Restaurant', name: 'Marea Baja' })]);
    const [menu] = await ld('/en/menu');
    expect(menu).toMatchObject({ '@type': 'Menu', inLanguage: 'en' });
    expect(JSON.stringify(menu)).toContain('"priceCurrency":"CRC"');
    const [item] = await ld('/carta/calientes/pulpo-anticuchero');
    expect(item).toMatchObject({
      '@type': 'MenuItem',
      name: 'Pulpo anticuchero',
      offers: { price: '12900.00', availability: 'https://schema.org/SoldOut' },
    });
  });

  test('sitemap con alternativas, robots, catalog-version y noindex en el fallback SPA', async ({ page }) => {
    const sitemap = await rawHtml(page, '/sitemap.xml');
    expect(sitemap.match(/<loc>/g)).toHaveLength(56);
    expect(sitemap).toContain(`<loc>${SITE}/en/menu/ceviches/ceviche-clasico</loc>`);
    expect(sitemap.match(/hreflang="x-default"/g)).toHaveLength(56);
    expect(sitemap).not.toContain('/cuenta');

    const robots = await rawHtml(page, '/robots.txt');
    expect(robots).toContain('Disallow: /cuenta');
    expect(robots).toContain(`Sitemap: ${SITE}/sitemap.xml`);

    const published = JSON.parse(await rawHtml(page, '/catalog-version.json')) as { version: string };
    const current = (await (await page.request.get('/api/public/catalog-version')).json()) as {
      version: string;
    };
    expect(published.version).toBe(current.version);

    expect(await rawHtml(page, '/cuenta/ingresar')).toContain('<meta name="robots" content="noindex"/>');
  });
});

test.describe('datos en vivo al hidratar (D10)', () => {
  test('el precio y "Agotado hoy" se actualizan sobre el HTML prerenderizado', async ({ page }) => {
    setProduct('ceviche-nikkei', { price: 9950, available: false });
    try {
      // El HTML publicado conserva el precio del build...
      const html = await rawHtml(page, '/carta/ceviches/ceviche-nikkei');
      // Intl separa los miles con un espacio no separable: se compara con \s.
      expect(html).toMatch(/₡9\s600/);
      // ...y la página muestra el dato vivo.
      await page.goto('/carta/ceviches/ceviche-nikkei');
      const price = page.locator('[aria-live="polite"] .t-price');
      await expect(price).toHaveText(/₡9\s950/);
      await expect(page.getByText('Agotado hoy')).toBeVisible();
      await page.goto('/carta');
      const line = page.locator('article', { has: page.getByRole('link', { name: 'Ceviche nikkei' }) });
      await expect(line.locator('.t-price')).toHaveText(/₡9\s950/);
      await expect(line.getByText('Agotado hoy', { exact: true })).toBeVisible();
    } finally {
      setProduct('ceviche-nikkei', { price: 9600, available: true });
    }
  });

  test('la pizarra de pesca del día se carga en vivo', async ({ page }) => {
    await page.goto('/');
    const board = page.locator('#pesca-del-dia');
    await expect(board.getByRole('table')).toBeVisible();
    await expect(board.getByRole('cell', { name: 'Corvina' })).toBeVisible();
    await expect(board.getByRole('cell', { name: 'Puntarenas' })).toBeVisible();
    await expect(board.getByRole('img', { name: /引潮/ })).toBeVisible();
  });
});

test.describe('carta: búsqueda y filtros (sin tapar la lista)', () => {
  test('filtrar por "Sin gluten" deja solo las bebidas y se anuncia; quitar filtros restaura todo', async ({
    page,
  }) => {
    await page.goto('/carta');
    await hydrated(page);
    await page.getByRole('button', { name: 'Sin gluten' }).click();
    await expect(page.getByRole('button', { name: 'Sin gluten' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('article h3')).toHaveText([
      'Chicha morada',
      'Limonada de hierbabuena',
      'Agua de pipa',
    ]);
    await expect(page.getByRole('status').filter({ hasText: 'coinciden' })).toHaveText('3 platos coinciden.');
    // El índice solo lista las categorías visibles.
    await expect(page.getByRole('navigation', { name: 'Categorías' }).getByRole('link')).toHaveText([
      'Bebidas',
    ]);
    await page.getByRole('button', { name: 'Quitar los filtros' }).click();
    await expect(page.locator('article h3')).toHaveCount(17);
  });

  test('la búsqueda ignora tildes y mayúsculas, en los dos idiomas', async ({ page }) => {
    await page.goto('/carta');
    await hydrated(page);
    await page.getByRole('searchbox', { name: 'Buscar en la carta' }).fill('ATUN');
    await expect(page.locator('article h3')).toHaveText([
      'Ceviche nikkei',
      'Tiradito nikkei de atún y salmón',
      'Tártara de atún nikkei',
      'Bowl nikkei de atún',
    ]);
    await page.goto('/en/menu');
    await hydrated(page);
    await page.getByRole('searchbox', { name: 'Search the menu' }).fill('octopus');
    await expect(page.locator('article h3')).toHaveText([
      'Ceviche mixto con chicharrón de calamar',
      'Pulpo a la parrilla',
      'Pulpo anticuchero',
    ]);
    await page.getByRole('searchbox', { name: 'Search the menu' }).fill('zzz');
    await expect(page.getByRole('heading', { name: 'No dishes with those filters' })).toBeVisible();
  });

  test('a 375 px la carta empieza arriba: búsqueda y filtros plegados detrás de un botón', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/carta');
    await hydrated(page);
    const first = page.locator('article').first();
    expect((await first.boundingBox())?.y ?? 9999).toBeLessThan(812);
    const toggle = page.getByRole('button', { name: 'Buscar y filtrar' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('searchbox')).toBeHidden();
    await toggle.click();
    await expect(page.getByRole('searchbox', { name: 'Buscar en la carta' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  });
});

test.describe('navegación, idioma y accesibilidad', () => {
  test('el selector de idioma conserva la página (categoría y plato)', async ({ page }) => {
    await page.goto('/carta/makis/maki-acevichado');
    await hydrated(page);
    await page.getByRole('navigation', { name: 'Principal' }).first().waitFor();
    await page.locator('header').getByRole('link', { name: /^EN/ }).click();
    await expect(page).toHaveURL(/\/en\/menu\/makis\/maki-acevichado$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Maki acevichado');
  });

  test('menú del celular: hoja modal que se cierra con Escape y lleva a las secciones', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await hydrated(page);
    await page.getByRole('button', { name: 'Menú' }).click();
    const dialog = page.getByRole('dialog', { name: 'Menú del sitio' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await page.getByRole('button', { name: 'Menú' }).click();
    await dialog.getByRole('link', { name: 'Visítanos' }).click();
    await expect(page).toHaveURL(/\/visitanos$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Visítanos');
  });

  test('enlace "Saltar al contenido" y foco visible con teclado', async ({ page }) => {
    await page.goto('/carta');
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Saltar al contenido' });
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('main')).toBeFocused();
  });

  test('un plato inexistente muestra "No encontramos esta página"', async ({ page }) => {
    await page.goto('/carta/ceviches/no-existe');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      /No encontramos esta página|Algo salió mal/,
    );
  });

  for (const width of [1280, 375]) {
    test(`axe: 0 violaciones serias o críticas en las páginas públicas (${String(width)} px, es y en)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      for (const [es, en] of PAGES) {
        for (const path of [es, en]) {
          await page.goto(path);
          await page.locator('main h1').waitFor();
          await expectNoSeriousA11yViolations(page);
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
            path,
          ).toBe(false);
        }
      }
    });
  }
});
