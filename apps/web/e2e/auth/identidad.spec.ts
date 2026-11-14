/**
 * E2E de identidad (M3): escenario 1 del documento original en su parte de autenticación
 * (§11, §12): registrarse, recibir el correo (Mailpit), confirmarlo, iniciar sesión, editar el
 * perfil y cerrar sesión, en los dos idiomas (D2). Más recuperación, Turnstile condicional (D8)
 * y accesibilidad (axe) de las pantallas de la cuenta.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { E2E_TURNSTILE_THRESHOLD } from '../../playwright.auth.config.ts';
import {
  MAILPIT,
  PASSWORD,
  register,
  signIn,
  uniqueEmail,
  waitForEmail,
  type MailpitSummary,
} from './helpers.ts';

async function expectNoSeriousA11yViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test('escenario 1 (identidad, es-CR): registro → correo → confirmación → login → perfil → logout', async ({
  page,
}) => {
  const email = uniqueEmail('escenario1');
  await register(page, '/cuenta/registro', { name: 'Valeria Prueba', email });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Revisá tu correo');
  await expect(page.getByRole('status')).toContainText(email);

  const mail = await waitForEmail(page, email);
  expect(mail.subject).toBe('Confirmá tu correo · Marea Baja');
  expect(mail.text).toContain('Hola, Valeria Prueba:');
  expect(mail.text).toContain('restaurante ficticio de demostración');
  expect(new URL(mail.link).pathname).toBe('/cuenta/verificar');

  await page.goto(mail.link);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Correo confirmado');
  // El token sale de la barra de direcciones apenas se usa.
  await expect(page).toHaveURL(/\/cuenta\/verificar$/);

  // El mismo enlace no sirve dos veces. (Se sale de la página antes: si solo cambiara el
  // fragmento `#token=…`, el navegador no recargaría, a diferencia de abrir el enlace del correo.)
  await page.goto('about:blank');
  await page.goto(mail.link);
  await expect(page.getByRole('alert')).toContainText('El enlace venció o ya se usó.');

  await signIn(page, '/cuenta/ingresar', email);
  await expect(page).toHaveURL(/\/cuenta$/);
  await expect(page.getByText(`Sesión iniciada como ${email}`)).toBeVisible();
  await expect(page.getByText('Correo confirmado')).toBeVisible();

  // La cookie de sesión no es accesible desde JavaScript (HttpOnly).
  expect(await page.evaluate(() => document.cookie)).not.toContain('mb_session');
  const cookie = (await page.context().cookies()).find((c) => c.name === 'mb_session');
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });

  await page.locator('#profile-phone').fill('+506 8888-1234');
  await page.getByLabel('English').check();
  await page.getByRole('button', { name: 'Guardar los cambios' }).click();
  // El idioma guardado se aplica en el acto: la cuenta pasa a inglés y conserva el aviso.
  await expect(page).toHaveURL(/\/en\/account$/);
  await expect(page.getByRole('status').filter({ hasText: 'We saved your details.' })).toBeVisible();

  await page.reload();
  await expect(page.locator('#profile-phone')).toHaveValue('+506 8888-1234');
  await expect(page.getByLabel('English')).toBeChecked();

  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/en\/account\/sign-in$/);
  await page.goto('/cuenta');
  await expect(page).toHaveURL(/\/cuenta\/ingresar$/);
});

test('en inglés: correo y enlaces en inglés, y el perfil exige sesión', async ({ page }) => {
  const email = uniqueEmail('english');
  await register(page, '/en/account/register', { name: 'Sam Test', email });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Check your email');
  const mail = await waitForEmail(page, email);
  expect(mail.subject).toBe('Confirm your email · Marea Baja');
  expect(mail.text).toContain('fictional demo restaurant');
  expect(new URL(mail.link).pathname).toBe('/en/account/verify');
  await page.goto(mail.link);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Email confirmed');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  await signIn(page, '/en/account/sign-in', email);
  await expect(page).toHaveURL(/\/en\/account$/);
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();
  // El selector de idioma lleva a la misma página en el otro idioma.
  await page.getByRole('link', { name: /^ES/ }).click();
  await expect(page).toHaveURL(/\/cuenta$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tu cuenta');
});

test('recuperación: misma respuesta siempre, enlace de un solo uso y contraseña nueva', async ({ page }) => {
  const email = uniqueEmail('recupero');
  await register(page, '/cuenta/registro', { name: 'Ana Recupero', email });
  await waitForEmail(page, email);

  await page.goto('/cuenta/recuperar');
  await page.locator('#forgot-email').fill(email);
  await page.locator('#forgot-form button[type=submit]').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Revisá tu correo');

  let reset: { subject: string; link: string } | undefined;
  await expect
    .poll(async () => {
      const res = await page.request.get(`${MAILPIT}/api/v1/search`, {
        params: { query: `to:"${email}" subject:"Restablecé"` },
      });
      const body = (await res.json()) as { messages: MailpitSummary[] };
      const id = body.messages[0]?.ID;
      if (!id) return null;
      const full = (await (await page.request.get(`${MAILPIT}/api/v1/message/${id}`)).json()) as {
        Subject: string;
        Text: string;
      };
      const link = /https?:\/\/\S+#token=[A-Za-z0-9_-]{43}/.exec(full.Text)?.[0];
      reset = link ? { subject: full.Subject, link } : undefined;
      return reset?.link ?? null;
    })
    .toBeTruthy();

  const newPassword = 'otra frase larga y nueva';
  await page.goto(reset?.link ?? '');
  await page.locator('#reset-password').fill(newPassword);
  await page.locator('#reset-form button[type=submit]').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Contraseña actualizada');

  await signIn(page, '/cuenta/ingresar', email, PASSWORD);
  await expect(page.getByRole('alert')).toContainText('El correo o la contraseña no son correctos.');
  await signIn(page, '/cuenta/ingresar', email, newPassword);
  await expect(page).toHaveURL(/\/cuenta$/);
});

test('Turnstile aparece solo al superar el umbral y el servidor valida el token (D8)', async ({ page }) => {
  // Sin llamadas externas: el script de Cloudflare se reemplaza por un widget de prueba que
  // entrega el token ficticio de las claves de prueba. El servidor usa el proveedor falso.
  let scriptRequests = 0;
  await page.route('https://challenges.cloudflare.com/**', async (route) => {
    scriptRequests += 1;
    await route.fulfill({
      contentType: 'text/javascript',
      body: `window.turnstile = {
        render(el, opts) {
          const b = document.createElement('button');
          b.type = 'button'; b.textContent = 'turnstile-stub';
          b.onclick = () => opts.callback('XXXX.DUMMY.TOKEN.XXXX');
          el.appendChild(b); return 'w1';
        },
        remove() {}
      };`,
    });
  });
  const email = uniqueEmail('turnstile');
  await register(page, '/cuenta/registro', { name: 'Turnstile Prueba', email });
  await page.goto((await waitForEmail(page, email)).link);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Correo confirmado');

  for (let i = 1; i < E2E_TURNSTILE_THRESHOLD; i += 1) {
    await signIn(page, '/cuenta/ingresar', email, `equivocada numero ${String(i)}`);
    await expect(page.getByRole('alert')).toContainText('no son correctos');
    await expect(page.getByTestId('turnstile')).toHaveCount(0);
  }
  expect(scriptRequests).toBe(0);

  await signIn(page, '/cuenta/ingresar', email, 'equivocada otra vez');
  await expect(page.getByTestId('turnstile')).toBeVisible();
  expect(scriptRequests).toBe(1);

  // Sin resolver el desafío, la contraseña correcta no alcanza.
  await page.locator('#login-password').fill(PASSWORD);
  await page.locator('#login-form button[type=submit]').click();
  await expect(page.getByRole('alert')).toContainText('completá la verificación');
  await expect(page).toHaveURL(/\/cuenta\/ingresar$/);

  await page.getByRole('button', { name: 'turnstile-stub' }).click();
  await page.locator('#login-form button[type=submit]').click();
  await expect(page).toHaveURL(/\/cuenta$/);
});

test('el resumen de errores recibe el foco y enlaza cada campo (§3.4)', async ({ page }) => {
  await page.goto('/cuenta/registro');
  await page.locator('#register-form button[type=submit]').click();
  const summary = page.getByRole('alert');
  await expect(summary).toBeFocused();
  await expect(summary.getByRole('link')).toHaveText([
    'Nombre: Completá este dato.',
    'Correo electrónico: Completá este dato.',
    'Contraseña: Completá este dato.',
  ]);
  await summary.getByRole('link', { name: /^Correo/ }).click();
  await expect(page.locator('#register-email')).toBeFocused();
  await expect(page.locator('#register-email')).toHaveAttribute('aria-invalid', 'true');
});

test('accesibilidad: 0 violaciones serias o críticas en las pantallas de la cuenta, en los dos idiomas', async ({
  page,
}) => {
  const guestPages = [
    '/cuenta/ingresar',
    '/cuenta/registro',
    '/cuenta/recuperar',
    '/cuenta/verificar',
    '/cuenta/restablecer',
    '/en/account/sign-in',
    '/en/account/register',
    '/en/account/forgot-password',
    '/en/account/verify',
    '/en/account/reset-password',
  ];
  for (const path of guestPages) {
    await page.goto(path);
    await page.locator('main h1').waitFor();
    await expectNoSeriousA11yViolations(page);
  }
  // Estados de error y el perfil con sesión.
  await page.goto('/cuenta/registro');
  await page.locator('#register-form button[type=submit]').click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expectNoSeriousA11yViolations(page);

  const email = uniqueEmail('a11y');
  await register(page, '/en/account/register', { name: 'A11y Test', email });
  await signIn(page, '/en/account/sign-in', email);
  await expect(page).toHaveURL(/\/en\/account$/);
  await expectNoSeriousA11yViolations(page);
});
