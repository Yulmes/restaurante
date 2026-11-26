/**
 * E2E del admin (M8, escenarios 3 y 4 de §11 sobre el admin de §12) con web + API + PostgreSQL
 * reales, en Chromium y en `Mobile Safari` (WebKit de Playwright con perfil de iPhone; no es un
 * iPhone real). Nada se simula en la web: permisos, montos, estados y auditoría los decide la API.
 *
 * Cada prueba usa cuentas nuevas (el límite de §8.4 de 30 cambios / 10 min es por usuario) y deja
 * la carta y la configuración como las encontró.
 */
import AxeBuilder from '@axe-core/playwright';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test, type Browser, type Page } from '@playwright/test';
import pg from 'pg';
import { ADMIN_E2E_DATABASE_URL, ADMIN_WEB_URL } from '../../playwright.admin.config.ts';

const PASSWORD = 'una frase larga para la demo';
const API_DIR = fileURLToPath(new URL('../../../api/', import.meta.url));
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

function account(role?: 'STAFF' | 'ADMIN', locale: 'es-CR' | 'en' = 'es-CR'): string {
  const email = `adm.${String(Date.now())}.${String(Math.floor(Math.random() * 1e6))}@example.com`;
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
    { cwd: API_DIR, env: { ...process.env, DATABASE_URL: ADMIN_E2E_DATABASE_URL }, stdio: 'pipe' },
  );
  return email;
}

async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: ADMIN_E2E_DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(sql, params)).rows as T[];
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

async function newSignedInPage(browser: Browser, email: string, en = false): Promise<Page> {
  const context = await browser.newContext({ baseURL: ADMIN_WEB_URL });
  const page = await context.newPage();
  await signIn(page, email, en);
  return page;
}

/** Un cliente pide un ceviche (retiro) y lo paga con la tarjeta demo aprobada. Devuelve el código. */
async function placePaidOrder(browser: Browser): Promise<string> {
  const email = account();
  const page = await newSignedInPage(browser, email);
  await page.goto('/carta/ceviches/ceviche-clasico');
  await hydrated(page);
  await page.getByRole('button', { name: /^Agregar · / }).click();
  await expect(page.getByText('Agregado a tu pedido.')).toBeVisible();
  await page.goto('/pedido/finalizar');
  const next = page.getByRole('button', { name: 'Continuar' });
  await next.click();
  await next.click();
  await page.getByRole('radio', { name: /^Aprobado/ }).check();
  await page.getByRole('button', { name: /Confirmar pedido/ }).click();
  await expect(page).toHaveURL(/\/pedido\/confirmacion\/[0-9a-f-]{36}$/);
  await page.context().close();
  const [row] = await query<{ code: string }>(
    `SELECT o."code" FROM "Order" o JOIN "User" u ON u."id" = o."userId" WHERE u."email" = $1`,
    [email],
  );
  if (!row) throw new Error('sin pedido');
  return row.code;
}

test.describe('admin de M8', () => {
  test('carta: agotado hoy, precio con vista previa y traducción; la carta pública lo refleja', async ({
    page,
  }) => {
    await signIn(page, account('ADMIN'));
    await page.goto('/admin');
    await expect(page.getByRole('heading', { level: 1, name: 'Resumen' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Ahora mismo' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Ir al Pase' })).toBeVisible();
    await expectNoAxeViolations(page);

    await page
      .getByRole('navigation', { name: 'Secciones del admin' })
      .getByRole('link', { name: 'Carta' })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'Carta' })).toBeVisible();
    await hydrated(page);
    await expectNoAxeViolations(page);
    await page.getByRole('button', { name: 'Marcar agotado hoy · Ceviche clásico de corvina' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Ceviche clásico de corvina quedó como agotado hoy.' }),
    ).toBeVisible();

    const visitor = await page.context().browser()?.newContext({ baseURL: ADMIN_WEB_URL });
    if (!visitor) throw new Error('sin navegador');
    const publicPage = await visitor.newPage();
    await publicPage.goto('/carta/ceviches/ceviche-clasico');
    await expect(
      publicPage.getByText('Hoy no lo estamos preparando', { exact: false }).first(),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Marcar disponible · Ceviche clásico de corvina' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Ceviche clásico de corvina vuelve a estar disponible.' }),
    ).toBeVisible();

    // Editor: el precio y el inglés, con la vista previa en vivo.
    await page.getByRole('link', { name: 'Ceviche clásico de corvina', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Editar plato' })).toBeVisible();
    await hydrated(page);
    const price = page.getByLabel('Precio (CRC)');
    const original = await price.inputValue();
    await price.fill('9500');
    await expect(
      page
        .getByRole('complementary', { name: 'Vista previa' })
        .getByText(/9\s?500/)
        .first(),
    ).toBeVisible();
    await expectNoAxeViolations(page);
    await page.getByRole('button', { name: 'Guardar cambios' }).first().click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Ceviche clásico de corvina guardado.' }),
    ).toBeVisible();

    await publicPage.goto('/carta/ceviches/ceviche-clasico');
    await expect(
      publicPage
        .locator('main')
        .getByText(/9\s?500/)
        .first(),
    ).toBeVisible();

    // Se restaura el precio de la semilla.
    await page.getByLabel('Precio (CRC)').fill(original);
    await page.getByRole('button', { name: 'Guardar cambios' }).first().click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Ceviche clásico de corvina guardado.' }),
    ).toBeVisible();
    await visitor.close();

    const entries = await query<{ action: string }>(
      `SELECT "action" FROM "AuditLog" WHERE "entityType" = 'product' ORDER BY "createdAt"`,
    );
    expect(entries.map((e) => e.action)).toEqual(
      expect.arrayContaining(['product.availability_changed', 'product.price_changed']),
    );
  });

  test('pesca del día, umbral de Turnstile y auditoría con filtros, en inglés', async ({ page }) => {
    await signIn(page, account('ADMIN', 'en'), true);
    await page.goto('/en/admin/catch');
    await expect(page.getByRole('heading', { level: 1, name: 'Catch of the day' })).toBeVisible();
    await hydrated(page);
    await page.getByLabel('Species 1').fill('Dorado');
    await page.getByLabel('Port 1').fill('Golfito');
    await page.getByLabel('Arrival time 1').fill('05:45');
    await expectNoAxeViolations(page);
    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Board published' })).toBeVisible();
    await page.goto('/en');
    await expect(page.getByText('Dorado').first()).toBeVisible();

    await page.goto('/en/admin/settings');
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    await hydrated(page);
    const threshold = page.getByLabel('Failures before asking for the check');
    const before = await threshold.inputValue();
    await threshold.fill('40');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Settings saved.' })).toBeVisible();
    await expectNoAxeViolations(page);

    await page.goto('/en/admin/audit');
    await hydrated(page);
    await page.getByLabel('Type').selectOption('settings');
    await page.getByRole('button', { name: 'Filter' }).click();
    await expect(page.getByText('settings.turnstile_threshold_changed').first()).toBeVisible();
    await page
      .getByText(/See the changes \(\d+\)/)
      .first()
      .click();
    await expect(page.getByText(`${before} → 40`)).toBeVisible();
    await expectNoAxeViolations(page);

    await page.goto('/en/admin/settings');
    await hydrated(page);
    await page.getByLabel('Failures before asking for the check').fill(before);
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Settings saved.' })).toBeVisible();
  });

  test('escenario 3 · seguridad: staff y clientes no entran; bloquear corta la sesión del cliente', async ({
    page,
    browser,
  }) => {
    // Sin sesión: al ingreso, con la vuelta al admin.
    await page.goto('/admin/carta');
    await expect(page).toHaveURL(/\/cuenta\/ingresar\?next=/);

    const staff = await newSignedInPage(browser, account('STAFF'));
    await staff.goto('/admin/carta');
    await expect(staff.getByRole('alert')).toContainText('solo para la administración');
    const nav = staff.getByRole('navigation', { name: 'Secciones del admin' });
    await expect(nav.getByRole('link')).toHaveCount(1);
    await expect(nav.getByRole('link', { name: 'Pase' })).toBeVisible();
    const denied = await staff.request.get('/api/admin/menu');
    expect(denied.status()).toBe(403);
    await staff.context().close();

    const customerEmail = account();
    const customer = await newSignedInPage(browser, customerEmail);
    await customer.goto('/admin');
    await expect(customer.getByRole('alert')).toContainText('solo para la administración');

    await signIn(page, account('ADMIN'));
    await page.goto('/admin/clientes');
    await hydrated(page);
    await page.getByLabel('Nombre o correo').fill(customerEmail);
    await page.getByRole('button', { name: 'Buscar' }).click();
    await page.getByRole('row').nth(1).getByRole('link').click();
    await expect(page.getByRole('heading', { level: 1, name: 'Cliente' })).toBeVisible();
    await hydrated(page);
    await expectNoAxeViolations(page);
    // Sin motivo no se bloquea.
    await page.getByRole('button', { name: 'Bloquear la cuenta' }).click();
    await expect(page.getByText('Escribí un motivo de al menos 3 caracteres.')).toBeVisible();
    await page.getByLabel('Motivo').fill('Prueba de seguridad E2E');
    await page.getByRole('button', { name: 'Bloquear la cuenta' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'quedó bloqueada' })).toBeVisible();

    // La sesión abierta del cliente ya no sirve.
    const me = await customer.request.get('/api/auth/me');
    expect(me.status()).toBe(401);
    await customer.context().close();

    await page.getByLabel('Motivo').fill('Fin de la prueba');
    await page.getByRole('button', { name: 'Desbloquear la cuenta' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'puede volver a ingresar' })).toBeVisible();
  });

  test('escenario 4 · errores: conflicto de edición, validaciones, moneda bloqueada, cancelar y reembolsar', async ({
    page,
    browser,
  }) => {
    const adminEmail = account('ADMIN');
    await signIn(page, adminEmail);

    // Dos pestañas editan el mismo plato: la segunda recibe el conflicto y no pisa el cambio.
    const other = await newSignedInPage(browser, adminEmail);
    await page.goto('/admin/carta');
    await page.getByRole('link', { name: 'Tiradito nikkei de atún y salmón' }).click();
    await expect(page).toHaveURL(/\/admin\/carta\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Editar plato' })).toBeVisible();
    await hydrated(page);
    const productUrl = page.url().replace(/^https?:\/\/[^/]+/, '');
    await other.goto(productUrl);
    await expect(other.getByRole('heading', { level: 1, name: 'Editar plato' })).toBeVisible();
    await hydrated(other);
    await other.getByLabel('Orden').fill('7');
    await other.getByRole('button', { name: 'Guardar cambios' }).first().click();
    await expect(other.getByRole('status').filter({ hasText: 'guardado' })).toBeVisible();
    await page.getByLabel('Orden').fill('8');
    await page.getByRole('button', { name: 'Guardar cambios' }).first().click();
    await expect(page.getByRole('alert')).toContainText('Otra persona cambió esto');
    await other.context().close();

    // Validaciones: precio con céntimos en CRC y slug repetido.
    await page.goto('/admin/carta/nuevo');
    await hydrated(page);
    await page.getByLabel('Identificador en la dirección').fill('ceviche-clasico');
    await page.getByLabel('Nombre original').fill('Repetido');
    await page.getByLabel('Descripción en español').fill('Prueba de validación.');
    await page.getByLabel('Descripción en inglés').fill('Validation test.');
    await page.getByLabel('Precio (CRC)').fill('8900.5');
    await page.getByRole('button', { name: 'Crear plato' }).click();
    await expect(page.getByText('Escribí el monto con números, sin símbolo de moneda.')).toBeVisible();
    await page.getByLabel('Precio (CRC)').fill('8900');
    await page.getByRole('button', { name: 'Crear plato' }).click();
    await expect(page.getByRole('alert')).toContainText(
      'Ese identificador ya lo usa otro elemento de la carta.',
    );
    await expect(page.getByText('Ya está en uso.')).toBeVisible();

    // Con un pedido activo, el asistente de moneda no se habilita.
    const toCancel = await placePaidOrder(browser);
    await page.goto('/admin/configuracion');
    await expect(page.getByText(/Pedidos activos: \d+/)).toBeVisible();

    // Cancelar antes de confirmar: anula la tarjeta demo.
    await page.goto('/admin/pedidos');
    await hydrated(page);
    await page.getByLabel('Buscar', { exact: true }).fill(toCancel);
    await page.getByRole('button', { name: 'Filtrar' }).click();
    await page.getByRole('link', { name: toCancel }).click();
    await hydrated(page);
    await expectNoAxeViolations(page);
    await page.getByRole('button', { name: 'Cancelar el pedido' }).click();
    await page.getByRole('button', { name: 'Sí, cancelar el pedido' }).click();
    await expect(page.getByText('Escribí un motivo de al menos 3 caracteres.')).toBeVisible();
    await page.getByLabel('Motivo').fill('El cliente llamó para cancelar');
    await page.getByRole('button', { name: 'Sí, cancelar el pedido' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Cancelación pedida' })).toBeVisible();
    await expect
      .poll(
        async () =>
          (await query<{ status: string }>(`SELECT "status" FROM "Order" WHERE "code" = $1`, [toCancel]))[0]
            ?.status,
      )
      .toBe('CANCELLED');

    // Reembolso parcial de un pedido confirmado.
    const toRefund = await placePaidOrder(browser);
    await page.goto('/admin/pase');
    await hydrated(page);
    const card = page.locator(`article[data-order-code="${toRefund}"]`);
    await card.getByRole('button', { name: 'Confirmar y cobrar' }).click();
    await expect
      .poll(
        async () =>
          (await query<{ status: string }>(`SELECT "status" FROM "Order" WHERE "code" = $1`, [toRefund]))[0]
            ?.status,
      )
      .toBe('CONFIRMED');
    await page.goto('/admin/pedidos');
    await hydrated(page);
    await page.getByLabel('Buscar', { exact: true }).fill(toRefund);
    await page.getByRole('button', { name: 'Filtrar' }).click();
    await page.getByRole('link', { name: toRefund }).click();
    await hydrated(page);
    await page.getByLabel('Monto a reembolsar (CRC)').fill('1000');
    await page.getByLabel('Motivo').first().fill('Faltó la cancha');
    await page.getByRole('button', { name: 'Reembolsar' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Reembolso registrado' })).toBeVisible();
    await expect(page.getByText('Faltó la cancha', { exact: false })).toBeVisible();
    const [payment] = await query<{ amountRefundedMinor: number }>(
      `SELECT p."amountRefundedMinor" FROM "Payment" p JOIN "Order" o ON o."id" = p."orderId" WHERE o."code" = $1`,
      [toRefund],
    );
    expect(payment?.amountRefundedMinor).toBe(100000);
  });
});
