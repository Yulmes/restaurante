/**
 * E2E del pedido (M5) sobre web + API + PostgreSQL reales, en Chromium y en `Mobile Safari`
 * (WebKit de Playwright con perfil de iPhone; no es un iPhone real).
 */
import AxeBuilder from '@axe-core/playwright';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import { ORDER_E2E_DATABASE_URL } from '../../playwright.pedido.config.ts';

const PASSWORD = 'una frase larga para la demo';
const API_DIR = fileURLToPath(new URL('../../../api/', import.meta.url));
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
/** Los precios se formatean con espacios no separables (CLDR): `\s` los incluye. */
const money = (colones: string) => new RegExp(`₡\\s?${colones.replace(' ', '[\\s,.]')}`);

function account(locale: 'es-CR' | 'en', options: { unverified?: boolean } = {}): string {
  const email = `pedido.${String(Date.now())}.${String(Math.floor(Math.random() * 1e6))}@example.com`;
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
      ...(options.unverified ? ['--unverified'] : []),
    ],
    { cwd: API_DIR, env: { ...process.env, DATABASE_URL: ORDER_E2E_DATABASE_URL }, stdio: 'pipe' },
  );
  return email;
}

async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: ORDER_E2E_DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(sql, params)).rows as T[];
  } finally {
    await client.end();
  }
}

interface OrderRow {
  id: string;
  code: string;
  status: string;
  fulfillmentType: string;
  totalMinor: number;
  deliveryFeeMinor: number;
  payment: string;
  units: number;
}

function ordersOf(email: string): Promise<OrderRow[]> {
  return query<OrderRow>(
    `SELECT o."id", o."code", o."status", o."fulfillmentType", o."totalMinor", o."deliveryFeeMinor",
            p."status" AS "payment",
            (SELECT sum(i."quantity")::int FROM "OrderItem" i WHERE i."orderId" = o."id") AS "units"
       FROM "Order" o JOIN "User" u ON u."id" = o."userId" JOIN "Payment" p ON p."orderId" = o."id"
      WHERE u."email" = $1`,
    [email],
  );
}

async function cartUnits(email: string): Promise<number> {
  const rows = await query<{ units: number | null }>(
    `SELECT sum(ci."quantity")::int AS "units" FROM "CartItem" ci
       JOIN "Cart" c ON c."id" = ci."cartId" JOIN "User" u ON u."id" = c."userId" WHERE u."email" = $1`,
    [email],
  );
  return rows[0]?.units ?? 0;
}

async function signIn(page: Page, email: string): Promise<void> {
  await page.locator('#login-email').fill(email);
  await page.locator('#login-password').fill(PASSWORD);
  await page.locator('#login-form button[type=submit]').click();
}

async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

const cartLink = (page: Page) =>
  page.locator('header a[href="/pedido"]:visible, header a[href="/en/order"]:visible').first();

test('invitado: arma el pedido, inicia sesión, se fusiona, confirma el retiro y queda registrado una sola vez', async ({
  page,
}) => {
  const email = account('es-CR');

  // 1–4. Carta → hoja de producto → opciones → agregar.
  await page.goto('/carta');
  await page.getByRole('button', { name: 'Agregar Ceviche clásico de corvina' }).click();
  const sheet = page.getByRole('dialog', { name: 'Ceviche clásico de corvina' });
  await expect(sheet).toBeVisible();
  await sheet.getByText('Rocoto, para valientes').click();
  await sheet.getByRole('button', { name: money('9 500') }).click();
  await expect(sheet.getByText('Agregado a tu pedido.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(cartLink(page)).toHaveAccessibleName(/1 producto/);

  // Otro plato desde su página.
  await page.goto('/carta/bebidas/chicha-morada');
  await page.getByRole('button', { name: money('2 200') }).click();
  await expect(page.getByText('Agregado a tu pedido.')).toBeVisible();

  // 5–7. Cantidades, quitar y persistencia en el navegador.
  await page.goto('/pedido');
  const ceviche = page.getByRole('listitem').filter({ hasText: 'Ceviche clásico de corvina' });
  await ceviche.getByRole('button', { name: 'Agregar uno' }).click();
  await expect(ceviche.locator('output')).toHaveText(/2$/);
  await page.getByRole('button', { name: 'Quitar Chicha morada del pedido' }).click();
  await expect(page.getByText('Chicha morada')).toBeHidden();
  await page.reload();
  await expect(ceviche.locator('output')).toHaveText(/2$/);
  await expect(page.getByText('Rocoto, para valientes')).toBeVisible();
  await expectNoAxeViolations(page);

  // 8–9. Checkout → iniciar sesión → vuelve al checkout con el carrito fusionado.
  await page.getByRole('link', { name: 'Finalizar el pedido' }).click();
  await expect(page.getByRole('heading', { name: 'Iniciá sesión para confirmar' })).toBeVisible();
  await page.getByRole('link', { name: 'Iniciar sesión' }).click();
  await signIn(page, email);
  await expect(page).toHaveURL(/\/pedido\/finalizar$/);
  await expect.poll(() => cartUnits(email)).toBe(2);
  expect(await page.evaluate(() => localStorage.getItem('marea-baja:pedido'))).toBeNull();

  // 10–13. Entrega (retiro) → datos → pago (demo) → confirmar. Un doble clic no duplica.
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByLabel('Teléfono de contacto').fill('8888 1234');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByText('el pago todavía no está habilitado')).toBeVisible();
  await expectNoAxeViolations(page);
  await page.getByRole('button', { name: /Confirmar pedido/ }).dblclick();

  // 14. Confirmación demo.
  await expect(page).toHaveURL(/\/pedido\/confirmacion\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Pedido registrado' })).toBeVisible();
  await expect(page.getByText(/Registramos tu pedido MB-[A-Z2-9]{6}/)).toBeVisible();
  await expect(page.getByText('no se cobró nada')).toBeVisible();
  await expectNoAxeViolations(page);

  // 15–17. Persistencia, estado del pago y sin duplicados.
  const orders = await ordersOf(email);
  expect(orders).toHaveLength(1);
  expect(orders[0]).toMatchObject({
    status: 'PENDING_PAYMENT',
    payment: 'REQUIRES_PAYMENT',
    fulfillmentType: 'PICKUP',
    units: 2,
    totalMinor: 2 * (890000 + 60000),
  });
  expect(await cartUnits(email)).toBe(0);
  await expect(cartLink(page)).toHaveAccessibleName('Pedido');
});

test('en inglés: delivery con dirección nueva; si el precio cambia, pide confirmar de nuevo', async ({
  page,
}) => {
  const email = account('en');
  await page.goto('/en/account/sign-in');
  await signIn(page, email);
  await expect(page).toHaveURL(/\/en\/account$/);

  await page.goto('/en/menu/ceviches/ceviche-clasico');
  await page.getByRole('button', { name: money('8 900') }).click();
  await expect(page.getByText('Added to your order.')).toBeVisible();

  await page.goto('/en/order/checkout');
  await page.getByText('Our own delivery').click();
  await page.getByRole('button', { name: 'Add an address' }).click();
  await page.locator('#checkout-address-label').fill('Home');
  await page.locator('#checkout-address-line1').fill('Avenida 9, casa 33');
  await page.locator('#checkout-address-district').selectOption('San Pedro');
  await page.locator('#checkout-address-canton').fill('Montes de Oca');
  await page.locator('#checkout-address-province').fill('San José');
  await page.locator('#checkout-address-reference').fill('Black gate');
  await page.getByRole('button', { name: 'Save address' }).click();
  await expect(page.getByText(/delivery ₡\s?1[\s,.]200 · about 30 min/)).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Contact phone').fill('8888 4321');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expectNoAxeViolations(page);
  const placeOrder = page.getByRole('button', { name: /^Place order/ });
  await expect(placeOrder).toContainText(money('10 100'));

  const rows = await query<{ price: number }>(
    `SELECT "basePriceMinor" AS "price" FROM "Product" WHERE "slug" = 'ceviche-clasico'`,
  );
  const price = rows[0]?.price ?? 890000;
  await query(`UPDATE "Product" SET "basePriceMinor" = $1 WHERE "slug" = 'ceviche-clasico'`, [
    price + 100000,
  ]);
  try {
    await placeOrder.click();
    await expect(page.getByRole('alert')).toContainText('The amounts changed');
    expect(await ordersOf(email)).toHaveLength(0);
    await expect(placeOrder).toContainText(money('11 100'));
    await placeOrder.click();
    await expect(page).toHaveURL(/\/en\/order\/confirmation\/[0-9a-f-]{36}$/);
    await expect(page.getByText('Delivery to Avenida 9, casa 33')).toBeVisible();
  } finally {
    await query(`UPDATE "Product" SET "basePriceMinor" = $1 WHERE "slug" = 'ceviche-clasico'`, [price]);
  }
  const orders = await ordersOf(email);
  expect(orders).toHaveLength(1);
  expect(orders[0]).toMatchObject({
    fulfillmentType: 'DELIVERY',
    deliveryFeeMinor: 120000,
    totalMinor: 1110000,
  });
});

test('una cuenta sin verificar arma el pedido pero no puede confirmarlo (D3)', async ({ page }) => {
  const email = account('es-CR', { unverified: true });
  await page.goto('/cuenta/ingresar');
  await signIn(page, email);
  await expect(page).toHaveURL(/\/cuenta$/);
  await page.goto('/carta/bebidas/limonada-de-hierbabuena');
  await page.getByRole('button', { name: money('2 000') }).click();
  await expect(page.getByText('Agregado a tu pedido.')).toBeVisible();
  await page.goto('/pedido/finalizar');
  await expect(page.getByRole('heading', { name: 'Verificá tu correo para confirmar' })).toBeVisible();
  const status = await page.evaluate(async () => {
    const csrf = ((await (await fetch('/api/auth/csrf')).json()) as { csrfToken: string }).csrfToken;
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': csrf,
        'idempotency-key': crypto.randomUUID(),
      },
      body: JSON.stringify({ locale: 'es-CR', fulfillmentType: 'PICKUP', quoteVersion: 'x' }),
    });
    return res.status;
  });
  expect(status).toBe(403);
  expect(await ordersOf(email)).toHaveLength(0);
});

// --- Correcciones visuales D1–D4 de la revisión de aceptación de M5 ---------------------------------

/** Agrega dos ceviches con picante rocoto y palta (opciones con recargo) desde la página del plato. */
async function addCevicheWithOptions(page: Page): Promise<void> {
  await page.goto('/carta/ceviches/ceviche-clasico');
  await page.getByText('Rocoto, para valientes').click();
  await page.getByText('Palta', { exact: true }).click();
  const add = page.getByRole('button', { name: /^Agregar · / });
  await add.click();
  await expect(page.getByText('Agregado a tu pedido.')).toBeVisible();
  await add.click();
  await expect(cartLink(page)).toHaveAccessibleName(/2 productos/);
}

interface HeaderLayout {
  overflowX: number;
  outside: string[];
  cartLines: number;
}

/** Desborde de la página y controles de la barra que quedan fuera de la pantalla. */
function headerLayout(page: Page): Promise<HeaderLayout> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const visible = [...document.querySelectorAll<HTMLElement>('header a, header button')].filter(
      (el) => el.getClientRects().length > 0 && !el.closest('dialog'),
    );
    const outside = visible
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.left < -1 || r.right > vw + 1;
      })
      .map((el) => el.textContent.trim().slice(0, 30));
    // En /pedido el enlace "ES" del selector de idioma también apunta a /pedido.
    const cart = visible.find((el) => el.querySelector('[data-cart-part]'));
    // Renglones del texto visible de cada parte del botón (la etiqueta y el importe).
    const cartLines = cart
      ? Math.max(
          ...[...cart.querySelectorAll<HTMLElement>('[data-cart-part]')].map(
            (p) => p.getClientRects().length,
          ),
        )
      : 0;
    return { overflowX: document.documentElement.scrollWidth - vw, outside, cartLines };
  });
}

const cartButton = (page: Page) => page.locator('header a:visible:has([data-cart-part])').first();

const HEADER_PAGES = ['/', '/carta', '/carta/ceviches/ceviche-clasico', '/pedido', '/pedido/finalizar'];

test('D1 y D2: la barra no desborda a 390, 768, 1024 ni 1440 px, con el pedido vacío o con productos', async ({
  page,
}) => {
  test.setTimeout(180_000);
  for (const filled of [false, true]) {
    if (filled) {
      await page.setViewportSize({ width: 1280, height: 900 });
      await addCevicheWithOptions(page);
    }
    // Cada página se carga una vez y se cambia el ancho sin recargar: con 40 cargas por motor, las
    // dos ejecuciones superaban el freno global de solicitudes por IP de la API.
    for (const path of HEADER_PAGES) {
      await page.goto(path);
      await page.locator('main h1').waitFor();
      if (filled) await expect(cartButton(page)).toHaveAccessibleName(/2 productos, ₡/);
      for (const width of [390, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        const layout = await headerLayout(page);
        const where = `${path} a ${String(width)} px (${filled ? 'con productos' : 'vacío'})`;
        expect(layout.overflowX, where).toBeLessThanOrEqual(0);
        expect(layout.outside, where).toEqual([]);
        // Cada parte del botón (etiqueta y cantidad; importe) en un solo renglón.
        expect(layout.cartLines, where).toBe(1);
        // La navegación sigue al alcance: en la barra o en el botón "Menú".
        const menu = page.getByRole('button', { name: 'Menú' });
        if (await menu.isVisible()) await expect(menu).toBeInViewport({ ratio: 1 });
        else await expect(page.getByRole('navigation', { name: /principal/i }).first()).toBeVisible();
      }
    }
  }
});

test('D3: después de un error, corregir el dato y hacer un solo clic guarda la dirección una sola vez', async ({
  page,
}) => {
  const email = account('es-CR');
  await page.goto('/cuenta/ingresar');
  await signIn(page, email);
  await expect(page).toHaveURL(/\/cuenta$/);
  await page.getByRole('button', { name: 'Agregar una dirección' }).click();

  const posts: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/account/addresses')) {
      posts.push(request.url());
    }
  });
  // Todo menos la referencia → error.
  await page.locator('#profile-address-label').fill('Casa');
  await page.locator('#profile-address-line1').fill('Avenida 9, casa 33');
  await page.locator('#profile-address-district').selectOption('San Pedro');
  await page.locator('#profile-address-canton').fill('Montes de Oca');
  await page.locator('#profile-address-province').fill('San José');
  const save = page.getByRole('button', { name: 'Guardar la dirección' });
  await save.click();
  await expect(page.locator('#profile-address-reference')).toHaveAttribute('aria-invalid', 'true');
  expect(posts).toHaveLength(0);

  // Se corrige el último dato y, sin salir del campo, un solo clic (de puntero) en "Guardar".
  await page.locator('#profile-address-reference').fill('Portón negro');
  await expect(page.locator('#profile-address-reference')).toBeFocused();
  await save.click();
  await expect(page.getByRole('status').filter({ hasText: 'Dirección guardada.' })).toBeVisible();
  await expect(page.getByText('Avenida 9, casa 33, San Pedro, Montes de Oca, San José')).toBeVisible();
  expect(posts).toHaveLength(1);
});

test('D4: en el celular, el recargo de una opción del carrito queda en un solo renglón', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await addCevicheWithOptions(page);
  for (const width of [390, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/pedido');
    const option = page.getByRole('listitem').filter({ hasText: 'Rocoto, para valientes' }).last();
    await expect(option).toContainText(/\(\+\s?₡\s?600\)/);
    const surcharges = option.locator('[data-option-surcharge]');
    await expect(surcharges).toHaveCount(1);
    expect(await surcharges.evaluate((el) => el.getClientRects().length), `${String(width)} px`).toBe(1);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(0);
  }
});
