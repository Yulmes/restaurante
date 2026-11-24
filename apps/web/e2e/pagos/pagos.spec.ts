/**
 * E2E del pago demo (M6, §7.4) sobre web + API + PostgreSQL reales, en Chromium y en `Mobile Safari`
 * (WebKit de Playwright con perfil de iPhone; no es un iPhone real). Nunca hay datos de tarjeta:
 * solo el selector de escenarios y la contra entrega.
 */
import AxeBuilder from '@axe-core/playwright';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import { PAYMENT_E2E_DATABASE_URL } from '../../playwright.pagos.config.ts';

const PASSWORD = 'una frase larga para la demo';
const API_DIR = fileURLToPath(new URL('../../../api/', import.meta.url));
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

function account(locale: 'es-CR' | 'en'): string {
  const email = `pago.${String(Date.now())}.${String(Math.floor(Math.random() * 1e6))}@example.com`;
  execFileSync(
    'node',
    ['scripts/e2e-user.ts', '--email', email, '--password', PASSWORD, '--locale', locale],
    { cwd: API_DIR, env: { ...process.env, DATABASE_URL: PAYMENT_E2E_DATABASE_URL }, stdio: 'pipe' },
  );
  return email;
}

interface PaymentRow {
  orderStatus: string;
  status: string;
  method: string;
  authorized: number;
  total: number;
  attempts: string[];
}

async function paymentOf(email: string): Promise<PaymentRow[]> {
  const client = new pg.Client({ connectionString: PAYMENT_E2E_DATABASE_URL });
  await client.connect();
  try {
    const res = await client.query(
      `SELECT o."status" AS "orderStatus", p."status", p."method", p."amountAuthorizedMinor" AS "authorized",
              o."totalMinor" AS "total",
              ARRAY(SELECT a."result"::text FROM "PaymentAttempt" a WHERE a."paymentId" = p."id"
                    ORDER BY a."createdAt") AS "attempts"
         FROM "Order" o JOIN "User" u ON u."id" = o."userId" JOIN "Payment" p ON p."orderId" = o."id"
        WHERE u."email" = $1`,
      [email],
    );
    return res.rows as PaymentRow[];
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

/** Inicia sesión, agrega un plato y llega al paso 3 del checkout (retiro). */
async function toPaymentStep(page: Page, locale: 'es-CR' | 'en'): Promise<string> {
  const email = account(locale);
  const en = locale === 'en';
  await page.goto(en ? '/en/account/sign-in' : '/cuenta/ingresar');
  await page.locator('#login-email').fill(email);
  await page.locator('#login-password').fill(PASSWORD);
  await page.locator('#login-form button[type=submit]').click();
  await expect(page).toHaveURL(en ? /\/en\/account$/ : /\/cuenta$/);
  await page.goto(en ? '/en/menu/ceviches/ceviche-clasico' : '/carta/ceviches/ceviche-clasico');
  await hydrated(page);
  await page.getByRole('button', { name: en ? /^Add · / : /^Agregar · / }).click();
  await expect(page.getByText(en ? 'Added to your order.' : 'Agregado a tu pedido.')).toBeVisible();
  await page.goto(en ? '/en/order/checkout' : '/pedido/finalizar');
  const next = page.getByRole('button', { name: en ? 'Continue' : 'Continuar' });
  await next.click();
  await next.click();
  await expect(
    page.getByText(en ? 'Choose how to simulate the payment' : 'Elegí cómo simular el pago'),
  ).toBeVisible();
  return email;
}

test('tarjeta demo rechazada: el pedido sigue reservado y se paga al reintentar con "Aprobado"', async ({
  page,
}) => {
  const email = await toPaymentStep(page, 'es-CR');
  // Sin campos de tarjeta: solo la ilustración y el selector de escenarios.
  await expect(page.getByRole('img', { name: /DEMO •••• 0000/ })).toBeVisible();
  await expect(page.locator('input[autocomplete^="cc-"], input[name*="card" i]')).toHaveCount(0);
  await page.getByRole('radio', { name: /Fondos insuficientes/ }).check();
  await expectNoAxeViolations(page);
  await page.getByRole('button', { name: /Confirmar pedido/ }).click();

  await expect(page).toHaveURL(/\/pedido\/confirmacion\/[0-9a-f-]{36}$/);
  await expect(page.getByText('rechazó el pago por fondos insuficientes')).toBeVisible();
  await expect(page.locator('[data-payment-status]')).toHaveText('Pendiente de pago');
  await expect(page.getByText(/sigue reservado hasta las/)).toBeVisible();
  await expectNoAxeViolations(page);
  expect((await paymentOf(email))[0]).toMatchObject({ status: 'REQUIRES_PAYMENT', attempts: ['FAILED'] });

  await page.getByRole('radio', { name: /^Aprobado/ }).check();
  await page.getByRole('button', { name: /Pagar con la tarjeta demo/ }).click();
  await expect(page.getByText('Pago demo autorizado')).toBeVisible();
  await expect(page.locator('[data-payment-status]')).toHaveText('Autorizado');
  await expect(page.locator('[data-status]')).toHaveText('Esperando la confirmación del local');
  const [row] = await paymentOf(email);
  expect(row).toMatchObject({
    orderStatus: 'PENDING_CONFIRMATION',
    status: 'AUTHORIZED',
    method: 'DEMO_CARD',
    attempts: ['FAILED', 'SUCCEEDED'],
  });
  expect(row?.authorized).toBe(row?.total);
});

test('in English: pay on delivery or pickup, without the processor', async ({ page }) => {
  const email = await toPaymentStep(page, 'en');
  await page.getByRole('radio', { name: /Pay on delivery or pickup/ }).check();
  // The scenario picker only belongs to the demo card.
  await expect(page.getByRole('radio', { name: /^Approved/ })).toHaveCount(0);
  await page.getByRole('button', { name: /^Place order/ }).click();
  await expect(page).toHaveURL(/\/en\/order\/confirmation\/[0-9a-f-]{36}$/);
  await expect(page.getByText('You chose to pay on delivery or pickup')).toBeVisible();
  await expect(page.locator('[data-payment-status]')).toHaveText('Awaiting collection');
  await expectNoAxeViolations(page);
  expect((await paymentOf(email))[0]).toMatchObject({
    orderStatus: 'PENDING_CONFIRMATION',
    status: 'PENDING_COLLECTION',
    method: 'CASH_ON_DELIVERY',
    authorized: 0,
    attempts: [],
  });
});

test('pendiente: la pantalla muestra "en proceso" y cambia sola a autorizado (~20 s, reconciliación)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const email = await toPaymentStep(page, 'es-CR');
  await page.getByRole('radio', { name: /^Pendiente/ }).check();
  await page.getByRole('button', { name: /Confirmar pedido/ }).click();
  await expect(page).toHaveURL(/\/pedido\/confirmacion\/[0-9a-f-]{36}$/);
  await expect(page.locator('[data-payment-status]')).toHaveText('En proceso');
  await expect(page.getByText('Esta pantalla se actualiza sola')).toBeVisible();
  await expect(page.locator('[data-payment-status]')).toHaveText('Autorizado', { timeout: 60_000 });
  await expect(page.getByText('Pago demo autorizado')).toBeVisible();
  expect((await paymentOf(email))[0]).toMatchObject({ status: 'AUTHORIZED', attempts: ['SUCCEEDED'] });
});
