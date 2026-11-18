/**
 * Idioma del documento (`<html lang>`) en el build de producción (D2, accesibilidad).
 *
 * El hosting sirve HTML prerenderizado a las páginas públicas y el fallback SPA
 * (`__spa-fallback.html`, renderizado desde `/`, con `lang="es-CR"`) al resto: cuenta,
 * `/_design` y rutas inexistentes, también en inglés. Antes de la corrección, una carga directa
 * en inglés de esas rutas quedaba con `lang="es-CR"` aunque la interfaz estuviera en inglés, y
 * seguía así al navegar dentro del inglés.
 */
import { expect, test, type Page } from '@playwright/test';

interface LangChange {
  lang: string;
  hydrated: boolean;
}

/** Registra cada cambio de `lang` y si React ya había hidratado en ese momento. */
async function watchLang(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const changes: { lang: string; hydrated: boolean }[] = [];
    (window as unknown as { __langChanges: typeof changes }).__langChanges = changes;
    const hydrated = () =>
      [...document.querySelectorAll('a, button')].some((el) =>
        Object.keys(el).some((k) => k.startsWith('__reactProps')),
      );
    // El script corre antes de que exista <html>: se observa el documento y se filtra la raíz.
    new MutationObserver((records) => {
      if (records.some((r) => r.target === document.documentElement))
        changes.push({ lang: document.documentElement.lang, hydrated: hydrated() });
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['lang'] });
  });
}

const langChanges = (page: Page) =>
  page.evaluate(() => (window as unknown as { __langChanges: LangChange[] }).__langChanges);

/**
 * El primer cambio de `lang` ocurre antes de hidratar y ya es el idioma de la página; ninguno
 * posterior lo cambia a otro idioma.
 */
async function expectLangSetBeforeHydration(page: Page, lang: 'es-CR' | 'en'): Promise<void> {
  const changes = await langChanges(page);
  expect(changes[0]).toEqual({ lang, hydrated: false });
  expect(changes.every((c) => c.lang === lang)).toBe(true);
}

async function expectDocument(page: Page, lang: 'es-CR' | 'en', heading: string): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('lang', lang);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
}

/**
 * El servidor entrega exactamente `__spa-fallback.html`, en español: así se reproduce el caso real
 * (no la portada prerenderizada ni otro HTML).
 */
async function expectServedFallback(page: Page, path: string): Promise<void> {
  const html = await (await page.request.get(path)).text();
  const fallback = await (await page.request.get('/__spa-fallback.html')).text();
  expect(html).toBe(fallback);
  expect(html).toContain('<html lang="es-CR">');
}

test.describe('carga directa', () => {
  test('/en/account/sign-in: el documento es inglés antes de hidratar', async ({ page }) => {
    await expectServedFallback(page, '/en/account/sign-in');
    await watchLang(page);
    await page.goto('/en/account/sign-in');
    await expectDocument(page, 'en', 'Sign in');
    await expect(page).toHaveTitle('Sign in · Marea Baja');
    // Un solo cambio, de es-CR (fallback) a en, y antes de que React hidrate.
    expect(await langChanges(page)).toEqual([{ lang: 'en', hydrated: false }]);
  });

  test('/cuenta/ingresar: sigue en es-CR y nunca pasa por otro idioma', async ({ page }) => {
    await expectServedFallback(page, '/cuenta/ingresar');
    await watchLang(page);
    await page.goto('/cuenta/ingresar');
    await expectDocument(page, 'es-CR', 'Iniciar sesión');
    await expect(page).toHaveTitle('Iniciar sesión · Marea Baja');
    // Se reafirma el mismo valor antes de hidratar; nunca pasa por otro idioma.
    expect(await langChanges(page)).toEqual([{ lang: 'es-CR', hydrated: false }]);
  });

  test('/en/account/register (fallback): inglés antes de hidratar', async ({ page }) => {
    await expectServedFallback(page, '/en/account/register');
    await watchLang(page);
    await page.goto('/en/account/register');
    await expectDocument(page, 'en', 'Create an account');
    await expectLangSetBeforeHydration(page, 'en');
  });

  test('/en/_design (fallback): inglés antes de hidratar', async ({ page }) => {
    await expectServedFallback(page, '/en/_design');
    await watchLang(page);
    await page.goto('/en/_design');
    await expectDocument(page, 'en', 'Design system');
    await expectLangSetBeforeHydration(page, 'en');
  });

  test('/en prerenderizada: el HTML ya trae lang="en" y la hidratación no lo cambia', async ({ page }) => {
    const html = await (await page.request.get('/en')).text();
    expect(html).toContain('<html lang="en">');
    expect(html).not.toBe(await (await page.request.get('/__spa-fallback.html')).text());
    await watchLang(page);
    await page.goto('/en');
    await expectDocument(page, 'en', 'What the sea brought in today');
    // Solo se reafirma el mismo valor antes de hidratar; nunca pasa por es-CR.
    expect(await langChanges(page)).toEqual([{ lang: 'en', hydrated: false }]);
  });

  test('ruta inexistente en inglés: 404 en inglés con lang="en"', async ({ page }) => {
    await expectServedFallback(page, '/en/no-existe');
    await watchLang(page);
    await page.goto('/en/no-existe');
    await expectDocument(page, 'en', 'We couldn’t find this page');
    await expectLangSetBeforeHydration(page, 'en');
  });

  test('ruta inexistente en español: 404 en español con lang="es-CR"', async ({ page }) => {
    await expectServedFallback(page, '/no-existe');
    await watchLang(page);
    await page.goto('/no-existe');
    await expectDocument(page, 'es-CR', 'No encontramos esta página');
    await expectLangSetBeforeHydration(page, 'es-CR');
  });

  test('recargar una ruta de cuenta en inglés (fallback) conserva lang="en"', async ({ page }) => {
    await watchLang(page);
    await page.goto('/en/account/sign-in');
    await expectDocument(page, 'en', 'Sign in');
    await page.reload();
    await expectDocument(page, 'en', 'Sign in');
    // El registro se reinicia con la recarga: vale para la página recargada.
    expect(await langChanges(page)).toEqual([{ lang: 'en', hydrated: false }]);
  });
});

test('navegación interna entre idiomas, sin recargar', async ({ page }) => {
  await test.step('de español a inglés y de vuelta, con el selector de idioma', async () => {
    await page.goto('/cuenta/ingresar');
    await expectDocument(page, 'es-CR', 'Iniciar sesión');
    await page
      .getByRole('navigation', { name: 'Idioma' })
      .getByRole('link', { name: /^EN · English$/ })
      .click();
    await expect(page).toHaveURL(/\/en\/account\/sign-in$/);
    await expectDocument(page, 'en', 'Sign in');

    await page
      .getByRole('navigation', { name: 'Language' })
      .getByRole('link', { name: 'ES · Español (Costa Rica)', exact: true })
      .click();
    await expect(page).toHaveURL(/\/cuenta\/ingresar$/);
    await expectDocument(page, 'es-CR', 'Iniciar sesión');
  });

  await test.step('entrando en inglés, sigue en inglés al navegar dentro del inglés y pasa a español', async () => {
    await page.goto('/en/account/sign-in');
    await expectDocument(page, 'en', 'Sign in');
    // Antes de la corrección, este caso seguía en es-CR hasta cambiar de idioma dos veces.
    await page.getByRole('link', { name: 'Create one here' }).click();
    await expect(page).toHaveURL(/\/en\/account\/register$/);
    await expectDocument(page, 'en', 'Create an account');

    await page
      .getByRole('navigation', { name: 'Language' })
      .getByRole('link', { name: 'ES · Español (Costa Rica)', exact: true })
      .click();
    await expect(page).toHaveURL(/\/cuenta\/registro$/);
    await expectDocument(page, 'es-CR', 'Crear cuenta');
  });
});
