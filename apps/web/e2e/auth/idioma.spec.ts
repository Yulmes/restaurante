/**
 * E2E del idioma de la cuenta (D2, M3). Regla documentada en docs/I18N.md:
 * - antes de iniciar sesión manda la selección manual (la URL);
 * - al iniciar sesión manda la preferencia guardada (`User.locale`);
 * - guardar otro idioma en el perfil cambia la página en el acto;
 * - con sesión, el selector ES · EN sigue funcionando para navegar, sin cambiar la preferencia;
 * - un valor inválido o ausente se lee como es-CR.
 */
import { expect, test, type Page } from '@playwright/test';
import { createVerifiedAccount, signIn } from './helpers.ts';

async function expectAccountIn(page: Page, locale: 'es-CR' | 'en'): Promise<void> {
  await expect(page).toHaveURL(locale === 'en' ? /\/en\/account$/ : /\/cuenta$/);
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    locale === 'en' ? 'Your account' : 'Tu cuenta',
  );
  // Selector de idioma y radio del perfil coinciden con la página.
  await expect(page.getByRole('link', { name: locale === 'en' ? /^EN/ : /^ES/ })).toHaveAttribute(
    'aria-current',
    'true',
  );
  await expect(page.getByLabel(locale === 'en' ? 'English' : 'Español (Costa Rica)')).toBeChecked();
}

async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^(Cerrar sesión|Sign out)$/ }).click();
  await expect(page).toHaveURL(/\/(cuenta\/ingresar|en\/account\/sign-in)$/);
}

for (const viewport of [
  { name: 'escritorio', width: 1280, height: 800 },
  { name: '375 px', width: 375, height: 812 },
]) {
  test.describe(`idioma de la cuenta (${viewport.name})`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('cuenta en inglés: al iniciar sesión desde la página en español, la cuenta se abre en inglés', async ({
      page,
    }) => {
      const email = createVerifiedAccount('en');
      await signIn(page, '/cuenta/ingresar', email);
      await expectAccountIn(page, 'en');
    });

    test('cuenta en español; el cambio desde el perfil se aplica y persiste tras cerrar sesión', async ({
      page,
    }) => {
      const email = createVerifiedAccount('es-CR');
      await signIn(page, '/en/account/sign-in', email);
      await expectAccountIn(page, 'es-CR');

      await page.getByLabel('English').check();
      await page.getByRole('button', { name: 'Guardar los cambios' }).click();
      await expectAccountIn(page, 'en');
      await expect(page.getByRole('status').filter({ hasText: 'We saved your details.' })).toBeVisible();

      await signOut(page);
      await signIn(page, '/cuenta/ingresar', email);
      await expectAccountIn(page, 'en');

      await page.getByLabel('Español (Costa Rica)').check();
      await page.getByRole('button', { name: 'Save changes' }).click();
      await expectAccountIn(page, 'es-CR');
      await expect(page.getByRole('status').filter({ hasText: 'Guardamos tus datos.' })).toBeVisible();

      await signOut(page);
      await signIn(page, '/en/account/sign-in', email);
      await expectAccountIn(page, 'es-CR');
    });

    test('con sesión, el selector manual cambia la página sin cambiar la preferencia guardada', async ({
      page,
    }) => {
      const email = createVerifiedAccount('en');
      await signIn(page, '/en/account/sign-in', email);
      await expectAccountIn(page, 'en');

      await page.getByRole('link', { name: /^ES/ }).click();
      await expect(page).toHaveURL(/\/cuenta$/);
      await expect(page.locator('html')).toHaveAttribute('lang', 'es-CR');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tu cuenta');
      // La preferencia sigue siendo inglés: el formulario lo muestra y el próximo login lo aplica.
      await expect(page.getByLabel('English')).toBeChecked();
      await signOut(page);
      await signIn(page, '/cuenta/ingresar', email);
      await expectAccountIn(page, 'en');
    });
  });
}

test('antes de iniciar sesión, la selección manual de idioma sigue igual que en M1', async ({ page }) => {
  await page.goto('/cuenta/ingresar');
  await page.getByRole('link', { name: /^EN/ }).click();
  await expect(page).toHaveURL(/\/en\/account\/sign-in$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.getByRole('link', { name: /^ES/ }).click();
  await expect(page).toHaveURL(/\/cuenta\/ingresar$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'es-CR');
});

test('si la API devolviera un idioma inválido, la cuenta se abre en es-CR sin errores', async ({ page }) => {
  const email = createVerifiedAccount('en');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // Simula una preferencia corrupta en las respuestas de la API (la base no la permite).
  const corrupt = async (route: Parameters<Parameters<Page['route']>[1]>[0]) => {
    const response = await route.fetch();
    const body = (await response.json()) as { user?: { locale?: string } };
    if (body.user) body.user.locale = 'fr';
    await route.fulfill({ response, json: body });
  };
  await page.route('**/api/auth/login', corrupt);
  await page.route('**/api/auth/me', corrupt);

  await signIn(page, '/en/account/sign-in', email);
  await expect(page).toHaveURL(/\/cuenta$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'es-CR');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tu cuenta');
  await expect(page.getByLabel('Español (Costa Rica)')).toBeChecked();
  expect(errors).toEqual([]);
});
