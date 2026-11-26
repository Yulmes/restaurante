/**
 * CSP del build de producción (ADR 0010, D-M10-5; R-M9-2).
 *
 * Sirve el build como lo hará Cloudflare (`npm run preview` aplica la regla `/*` de `_headers`) y
 * recorre cada URL del sitemap (las páginas prerenderizadas en es-CR y en), las rutas de la SPA en
 * los dos idiomas y los flujos principales (hoja de producto, carrito, navegación del lado del
 * cliente, inicio de sesión). Falla con **cualquier** `securitypolicyviolation` o error de CSP en la
 * consola, con un HTML sin su `<meta>` o con la cabecera sin `frame-ancestors`.
 *
 * La variante Report-Only no existe en `<meta>`: esta prueba la reemplaza (ver la ADR 0010).
 */
import { expect, test, type Page } from '@playwright/test';
import { WEB_URL } from '../../playwright.produccion.config.ts';

interface Violation {
  directive: string;
  blocked: string;
  page: string;
  /** Archivo, línea y columna del código que la provocó (para ubicarla). */
  source?: string;
}

async function watchCsp(page: Page): Promise<() => Promise<Violation[]>> {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && /content security policy/i.test(message.text())) {
      consoleErrors.push(message.text());
    }
  });
  await page.addInitScript(() => {
    const list: { directive: string; blocked: string; page: string; source: string }[] = [];
    (window as unknown as { __csp: typeof list }).__csp = list;
    document.addEventListener('securitypolicyviolation', (event) => {
      list.push({
        directive: event.violatedDirective,
        blocked: event.blockedURI,
        page: location.pathname,
        source: `${event.sourceFile}:${String(event.lineNumber)}:${String(event.columnNumber)}`,
      });
    });
  });
  return async () => {
    const fromPage = await page.evaluate(() => (window as unknown as { __csp?: Violation[] }).__csp ?? []);
    return [
      ...fromPage,
      ...consoleErrors.map((text) => ({ directive: 'console', blocked: text, page: page.url() })),
    ];
  };
}

function cspMetaCount(html: string): number {
  return html.match(/<meta http-equiv="Content-Security-Policy"/g)?.length ?? 0;
}

async function sitemapUrls(page: Page): Promise<string[]> {
  const xml = await (await page.request.get(`${WEB_URL}/sitemap.xml`)).text();
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1] ?? '');
  return [...new Set(urls)].filter(Boolean);
}

const SPA_ROUTES = [
  '/cuenta/ingresar',
  '/en/account/sign-in',
  '/cuenta/registro',
  '/en/account/register',
  '/pedido',
  '/en/order',
  '/cuenta/bandeja',
  '/en/account/inbox',
  '/admin',
  '/en/admin',
  '/_design',
  '/ruta-que-no-existe',
];

test.describe('CSP por página (D-M10-5)', () => {
  test('cada página del sitemap tiene su <meta>, la cabecera y ninguna violación', async ({ page }) => {
    test.setTimeout(300_000);
    const urls = await sitemapUrls(page);
    expect(urls.length).toBeGreaterThanOrEqual(50);
    const violations = await watchCsp(page);
    for (const url of urls) {
      const response = await page.goto(url, { waitUntil: 'networkidle' });
      expect(response?.status(), url).toBe(200);
      const header = response?.headers()['content-security-policy'] ?? '';
      expect(header, url).toContain("frame-ancestors 'none'");
      // En el HTML recibido (el navegador la aplica al leerlo; si React vuelve a pintar el documento
      // después, la política sigue vigente).
      expect(cspMetaCount((await response?.text()) ?? ''), url).toBe(1);
      expect(await violations(), url).toEqual([]);
    }
  });

  test('las rutas de la SPA (fallback) en los dos idiomas, sin violaciones', async ({ page }) => {
    const violations = await watchCsp(page);
    for (const path of SPA_ROUTES) {
      const response = await page.goto(path, { waitUntil: 'networkidle' });
      expect(response?.status(), path).toBe(200);
      expect(cspMetaCount((await response?.text()) ?? ''), path).toBe(1);
      expect(await violations(), path).toEqual([]);
    }
  });

  test('flujos: navegación del cliente, hoja de producto, carrito e inicio de sesión', async ({ page }) => {
    const violations = await watchCsp(page);
    await page.goto('/', { waitUntil: 'networkidle' });
    // Navegación del lado del cliente hacia la carta (sin recargar).
    await page.getByRole('navigation').first().getByRole('link', { name: 'Carta', exact: true }).click();
    await expect(page).toHaveURL(/\/carta$/);
    await page.waitForLoadState('networkidle');
    // Hoja de producto y carrito.
    await page.getByRole('button', { name: 'Agregar Ceviche clásico de corvina' }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: /^Agregar · / }).click();
    await page.goto('/pedido', { waitUntil: 'networkidle' });
    // Inicio de sesión (formulario de la SPA) en inglés.
    await page.goto('/en/account/sign-in', { waitUntil: 'networkidle' });
    await page.getByLabel('Email').fill('nadie@example.com');
    await page.getByLabel('Password', { exact: true }).fill('una contraseña larga de prueba');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert').first()).toBeVisible();
    expect(await violations()).toEqual([]);
  });
});
