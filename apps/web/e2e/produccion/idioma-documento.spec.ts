/**
 * Idioma del documento (`<html lang>`) en el build de producción (D2, accesibilidad).
 *
 * El hosting sirve el mismo `index.html` (renderizado desde `/`, con `lang="es-CR"`) para todas
 * las rutas. Antes de la corrección, una carga directa en inglés quedaba con `lang="es-CR"`
 * aunque la interfaz estuviera en inglés, y seguía así al navegar dentro del inglés.
 */
import { expect, test, type Page } from '@playwright/test';

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
  page.evaluate(
    () => (window as unknown as { __langChanges: { lang: string; hydrated: boolean }[] }).__langChanges,
  );

async function expectDocument(page: Page, lang: 'es-CR' | 'en', heading: string): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('lang', lang);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
}

/** El HTML que entrega el servidor es el fallback, en español: así se reproduce el caso real. */
async function expectSpanishFallback(page: Page, path: string): Promise<void> {
  const html = await (await page.request.get(path)).text();
  expect(html).toContain('<html lang="es-CR">');
}

test.describe('carga directa', () => {
  test('/en/account/sign-in: el documento es inglés antes de hidratar', async ({ page }) => {
    await expectSpanishFallback(page, '/en/account/sign-in');
    await watchLang(page);
    await page.goto('/en/account/sign-in');
    await expectDocument(page, 'en', 'Sign in');
    await expect(page).toHaveTitle('Sign in · Marea Baja');
    // Un solo cambio, de es-CR (fallback) a en, y antes de que React hidrate.
    expect(await langChanges(page)).toEqual([{ lang: 'en', hydrated: false }]);
  });

  test('/cuenta/ingresar: sigue en es-CR y nunca pasa por otro idioma', async ({ page }) => {
    await watchLang(page);
    await page.goto('/cuenta/ingresar');
    await expectDocument(page, 'es-CR', 'Iniciar sesión');
    await expect(page).toHaveTitle('Iniciar sesión · Marea Baja');
    // Se reafirma el mismo valor antes de hidratar; nunca pasa por otro idioma.
    expect(await langChanges(page)).toEqual([{ lang: 'es-CR', hydrated: false }]);
  });

  test('otras rutas en inglés sin HTML propio: registro, portada y sistema de diseño', async ({ page }) => {
    for (const [path, heading] of [
      ['/en/account/register', 'Create an account'],
      ['/en', 'What the sea brought in today'],
      ['/en/_design', 'Design system'],
    ] as const) {
      await expectSpanishFallback(page, path);
      await page.goto(path);
      await expectDocument(page, 'en', heading);
    }
  });

  test('ruta inexistente en inglés: 404 en inglés con lang="en"', async ({ page }) => {
    await expectSpanishFallback(page, '/en/no-existe');
    await page.goto('/en/no-existe');
    await expectDocument(page, 'en', 'We couldn’t find this page');
  });

  test('ruta inexistente en español: 404 en español con lang="es-CR"', async ({ page }) => {
    await page.goto('/no-existe');
    await expectDocument(page, 'es-CR', 'No encontramos esta página');
  });

  test('recargar una ruta de cuenta en inglés conserva lang="en"', async ({ page }) => {
    await page.goto('/en/account/sign-in');
    await expectDocument(page, 'en', 'Sign in');
    await page.reload();
    await expectDocument(page, 'en', 'Sign in');
  });
});

test.describe('navegación interna, sin recargar', () => {
  test('de español a inglés y de vuelta, con el selector de idioma', async ({ page }) => {
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

  test('entrando en inglés, se mantiene en inglés al navegar dentro del inglés y pasa a español', async ({
    page,
  }) => {
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
