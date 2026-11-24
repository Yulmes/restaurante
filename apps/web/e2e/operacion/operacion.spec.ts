/**
 * E2E de la operación (M7, escenario 2 de §11) sobre web + API + PostgreSQL + Mailpit reales, en
 * Chromium y en `Mobile Safari` (WebKit de Playwright con perfil de iPhone; no es un iPhone real).
 *
 * El staff trabaja el Pase en su propio navegador; el cliente sigue el pedido en el suyo. Nada se
 * simula en la web: los estados, los cobros y los correos los decide la API.
 */
import AxeBuilder from '@axe-core/playwright';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test, type Browser, type Page } from '@playwright/test';
import pg from 'pg';
import { OPERATION_E2E_DATABASE_URL, OPERATION_WEB_URL } from '../../playwright.operacion.config.ts';

const PASSWORD = 'una frase larga para la demo';
const API_DIR = fileURLToPath(new URL('../../../api/', import.meta.url));
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const MAILPIT = process.env['MAILPIT_URL'] ?? 'http://127.0.0.1:8025';

function account(locale: 'es-CR' | 'en', role?: 'STAFF' | 'ADMIN'): string {
  const email = `op.${String(Date.now())}.${String(Math.floor(Math.random() * 1e6))}@example.com`;
  execFileSync(
    'node',
    [
      'scripts/e2e-user.ts',
      '--email',
      email,
      '--password',
      PASSWORD,
      '--locale',
      locale,
      ...(role ? ['--role', role] : []),
    ],
    { cwd: API_DIR, env: { ...process.env, DATABASE_URL: OPERATION_E2E_DATABASE_URL }, stdio: 'pipe' },
  );
  return email;
}

async function codeOf(email: string): Promise<string> {
  const client = new pg.Client({ connectionString: OPERATION_E2E_DATABASE_URL });
  await client.connect();
  try {
    const res = await client.query(
      `SELECT o."code" FROM "Order" o JOIN "User" u ON u."id" = o."userId" WHERE u."email" = $1`,
      [email],
    );
    return (res.rows[0] as { code: string }).code;
  } finally {
    await client.end();
  }
}

async function orderRow(code: string): Promise<{ status: string; payment: string }> {
  const client = new pg.Client({ connectionString: OPERATION_E2E_DATABASE_URL });
  await client.connect();
  try {
    const res = await client.query(
      `SELECT o."status", p."status" AS "payment" FROM "Order" o JOIN "Payment" p ON p."orderId" = o."id"
        WHERE o."code" = $1`,
      [code],
    );
    return res.rows[0] as { status: string; payment: string };
  } finally {
    await client.end();
  }
}

async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

/** Espera a que React hidrate: antes, un clic en un control se pierde. */
async function hydrated(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const button = document.querySelector('main button');
    return button !== null && Object.keys(button).some((key) => key.startsWith('__reactProps'));
  });
}

async function signIn(page: Page, email: string, en = false): Promise<void> {
  await page.goto(en ? '/en/account/sign-in' : '/cuenta/ingresar');
  await page.locator('#login-email').fill(email);
  await page.locator('#login-password').fill(PASSWORD);
  await page.locator('#login-form button[type=submit]').click();
  await expect(page).toHaveURL(en ? /\/en\/account$/ : /\/cuenta$/);
}

/** El cliente pide un ceviche (retiro) y paga: tarjeta demo aprobada o contra entrega. */
async function placePaidOrder(
  page: Page,
  options: { en?: boolean; method?: 'card' | 'cash' } = {},
): Promise<{ email: string; code: string; url: string }> {
  const en = options.en ?? false;
  const email = account(en ? 'en' : 'es-CR');
  await signIn(page, email, en);
  await page.goto(en ? '/en/menu/ceviches/ceviche-clasico' : '/carta/ceviches/ceviche-clasico');
  await hydrated(page);
  await page.getByRole('button', { name: en ? /^Add · / : /^Agregar · / }).click();
  await expect(page.getByText(en ? 'Added to your order.' : 'Agregado a tu pedido.')).toBeVisible();
  await page.goto(en ? '/en/order/checkout' : '/pedido/finalizar');
  const next = page.getByRole('button', { name: en ? 'Continue' : 'Continuar' });
  await next.click();
  await next.click();
  if (options.method === 'cash') {
    await page
      .getByRole('radio', { name: en ? /Pay on delivery or pickup/ : /Pagar al recibir o al retirar/ })
      .check();
  } else {
    await page.getByRole('radio', { name: en ? /^Approved/ : /^Aprobado/ }).check();
  }
  await page.getByRole('button', { name: en ? /^Place order/ : /Confirmar pedido/ }).click();
  await expect(page).toHaveURL(
    en ? /\/en\/order\/confirmation\/[0-9a-f-]{36}$/ : /\/pedido\/confirmacion\/[0-9a-f-]{36}$/,
  );
  // El código sale de la base: el pedido es el único de esta cuenta nueva.
  const code = await codeOf(email);
  return { email, code, url: page.url() };
}

async function staffPage(browser: Browser, role: 'STAFF' | 'ADMIN' = 'STAFF'): Promise<Page> {
  const context = await browser.newContext({ baseURL: OPERATION_WEB_URL });
  const page = await context.newPage();
  await signIn(page, account('es-CR', role));
  await page.goto('/admin/pase');
  await expect(page.getByRole('heading', { level: 1, name: 'Pase' })).toBeVisible();
  return page;
}

const card = (page: Page, code: string) => page.locator(`article[data-order-code="${code}"]`);

async function mailpitSubjects(to: string): Promise<string[]> {
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`);
  const body = (await res.json()) as { messages: { Subject: string }[] };
  return body.messages.map((m) => m.Subject);
}

test('escenario 2: el staff confirma y avanza en el Pase; el cliente lo sigue en la línea de marea', async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000);
  const { email, code, url } = await placePaidOrder(page);
  // El seguimiento ya empezó: recibido y esperando al local.
  await expect(page.locator('[data-tracking-status]')).toHaveText('Ahora: Recibido');
  await expect(page.locator('li[data-step="PENDING_CONFIRMATION"]')).toHaveAttribute('aria-current', 'step');

  const pass = await staffPage(browser);
  const pending = pass.locator('section[data-column="PENDING_CONFIRMATION"]');
  await expect(pending.locator(`article[data-order-code="${code}"]`)).toBeVisible();
  await expect(card(pass, code)).toContainText('Ceviche clásico de corvina');
  await expect(card(pass, code)).toContainText(/recién|hace \d+ min/);
  await expectNoAxeViolations(pass);

  // Confirmar captura la tarjeta demo.
  await card(pass, code).getByRole('button', { name: 'Confirmar y cobrar' }).click();
  await expect(pass.getByRole('status').filter({ hasText: `Pedido ${code}: Confirmado.` })).toBeVisible();
  await expect(
    pass.locator(`section[data-column="CONFIRMED"] article[data-order-code="${code}"]`),
  ).toBeVisible();
  expect(await orderRow(code)).toEqual({ status: 'CONFIRMED', payment: 'CAPTURED' });

  // Atajo de teclado: con el pedido enfocado, A lo avanza.
  await hydrated(pass);
  await card(pass, code).focus();
  await pass.keyboard.press('a');
  await expect(
    pass.locator(`section[data-column="PREPARING"] article[data-order-code="${code}"]`),
  ).toBeVisible();

  await card(pass, code).getByRole('button', { name: 'Marcar listo' }).click();
  await expect(pass.locator(`section[data-column="READY"] article[data-order-code="${code}"]`)).toBeVisible();
  await card(pass, code).getByRole('button', { name: 'Marcar entregado' }).click();
  await expect(card(pass, code)).toHaveCount(0);
  expect(await orderRow(code)).toEqual({ status: 'DELIVERED', payment: 'CAPTURED' });

  // El cliente lo ve en su seguimiento, con la hora de cada marca.
  await page.goto(url.replace('/pedido/confirmacion/', '/cuenta/pedidos/'));
  await expect(page.getByRole('heading', { level: 1, name: 'Seguimiento del pedido' })).toBeVisible();
  await expect(page.locator('[data-tracking-status]')).toHaveText('Ahora: Entregado');
  for (const step of ['PENDING_CONFIRMATION', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP']) {
    await expect(page.locator(`li[data-step="${step}"]`)).toHaveAttribute('data-state', 'done');
  }
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await expectNoAxeViolations(page);

  // Historial (D3) y bandeja de demostración con los correos de cada paso.
  await page.goto('/cuenta/pedidos');
  await expect(page.getByRole('link', { name: new RegExp(`Pedido ${code}`) })).toContainText('Entregado');
  await expectNoAxeViolations(page);
  await page.goto('/cuenta/bandeja');
  await expect(
    page.getByRole('heading', { name: `Entregamos tu pedido ${code} · Marea Baja` }),
  ).toBeVisible();
  await expect(page.getByText(`Enviado a ${email} · aceptado por el proveedor`).first()).toBeVisible();
  await expectNoAxeViolations(page);
  await expect
    .poll(() => mailpitSubjects(email), { timeout: 30_000 })
    .toEqual(
      expect.arrayContaining([
        `Recibimos tu pedido ${code} · Marea Baja`,
        `Confirmamos tu pedido ${code} · Marea Baja`,
        `Tu pedido ${code} está en preparación · Marea Baja`,
        `Tu pedido ${code} está listo para retirar · Marea Baja`,
        `Entregamos tu pedido ${code} · Marea Baja`,
      ]),
    );
  await pass.context().close();
});

test('cancelaciones: el staff con motivo antes de confirmar; el admin después, con reembolso', async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000);
  const first = await placePaidOrder(page);
  const pass = await staffPage(browser, 'STAFF');
  await card(pass, first.code).getByRole('button', { name: 'Cancelar', exact: true }).click();
  await card(pass, first.code).getByRole('button', { name: 'Cancelar el pedido' }).click();
  // El motivo es obligatorio: el error se ve y se anuncia junto al campo.
  await expect(card(pass, first.code).getByText('Escribí el motivo de la cancelación.')).toBeVisible();
  await card(pass, first.code).getByLabel('Motivo de la cancelación').fill('Se agotó la corvina');
  await card(pass, first.code).getByRole('button', { name: 'Cancelar el pedido' }).click();
  await expect(card(pass, first.code)).toHaveCount(0);
  expect(await orderRow(first.code)).toEqual({ status: 'CANCELLED', payment: 'VOIDED' });
  await page.goto(first.url.replace('/pedido/confirmacion/', '/cuenta/pedidos/'));
  await expect(page.locator('[data-tracking-status="CANCELLED"]')).toContainText('Pedido cancelado · ');

  // Staff no ve "Cancelar" en un pedido confirmado; el admin sí, y devuelve lo cobrado.
  const customer = await browser.newContext({ baseURL: OPERATION_WEB_URL });
  const second = await placePaidOrder(await customer.newPage());
  await card(pass, second.code).getByRole('button', { name: 'Confirmar y cobrar' }).click();
  await expect(
    pass.locator(`section[data-column="CONFIRMED"] article[data-order-code="${second.code}"]`),
  ).toBeVisible();
  await expect(card(pass, second.code).getByRole('button', { name: 'Cancelar', exact: true })).toHaveCount(0);
  const admin = await staffPage(browser, 'ADMIN');
  await card(admin, second.code).getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(
    card(admin, second.code).getByText('Se devuelve lo cobrado con la tarjeta demo.'),
  ).toBeVisible();
  await card(admin, second.code).getByLabel('Motivo de la cancelación').fill('Cocina cerrada por lluvia');
  await card(admin, second.code).getByRole('button', { name: 'Cancelar el pedido' }).click();
  await expect(card(admin, second.code)).toHaveCount(0);
  expect(await orderRow(second.code)).toEqual({ status: 'CANCELLED', payment: 'REFUNDED' });
  await Promise.all([pass.context().close(), admin.context().close(), customer.close()]);
});

test('el cliente cancela su pedido contra entrega antes de que el local lo confirme', async ({ page }) => {
  const { code } = await placePaidOrder(page, { method: 'cash' });
  await page.getByRole('button', { name: 'Cancelar el pedido' }).click();
  await page.getByLabel('Motivo (opcional)').fill('Me equivoqué de plato');
  await expectNoAxeViolations(page);
  await page.getByRole('button', { name: 'Sí, cancelar el pedido' }).click();
  await expect(page.getByText('Cancelaste el pedido.')).toBeVisible();
  await expect(page.locator('[data-tracking-status="CANCELLED"]')).toBeVisible();
  expect(await orderRow(code)).toEqual({ status: 'CANCELLED', payment: 'VOIDED' });
});

test('in English: tracking, history and the status emails follow the account language', async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000);
  const { email, code, url } = await placePaidOrder(page, { en: true });
  await expect(page.locator('[data-tracking-status]')).toHaveText('Now: Received');
  const pass = await staffPage(browser);
  await card(pass, code).getByRole('button', { name: 'Confirmar y cobrar' }).click();
  await expect(
    pass.locator(`section[data-column="CONFIRMED"] article[data-order-code="${code}"]`),
  ).toBeVisible();
  await page.goto(url.replace('/en/order/confirmation/', '/en/account/orders/'));
  await expect(page.getByRole('heading', { level: 1, name: 'Order tracking' })).toBeVisible();
  await expect(page.locator('[data-tracking-status]')).toHaveText('Now: Confirmed');
  await page.goto('/en/account/orders');
  await expect(page.getByRole('link', { name: new RegExp(`Order ${code}`) })).toContainText('Confirmed');
  await expect
    .poll(() => mailpitSubjects(email), { timeout: 30_000 })
    .toEqual(
      expect.arrayContaining([
        `We received your order ${code} · Marea Baja`,
        `Your order ${code} is confirmed · Marea Baja`,
      ]),
    );
  await pass.context().close();
});

test('el Pase es solo para el personal: un cliente ve el aviso y la API responde 403', async ({ page }) => {
  await signIn(page, account('es-CR'));
  await page.goto('/admin/pase');
  await expect(page.getByRole('alert')).toHaveText('El Pase es solo para el personal del local.');
  const res = await page.request.get('/api/admin/pass');
  expect(res.status()).toBe(403);
});
