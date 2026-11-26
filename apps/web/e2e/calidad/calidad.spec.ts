/**
 * Auditoría de calidad de M9 sobre las pantallas reales (web + API + PostgreSQL), en es-CR y en.
 * El idioma sale del proyecto (`es-CR` o `en`; cada uno en su propia invocación, con una API nueva, por el
 * freno global de ráfagas de §8.4: 300 / 5 min por IP; la política no se relaja).
 *
 * Para cada pantalla y cada ancho (375, 768, 1024, 1280 px):
 * - desbordamiento horizontal de la página (`scrollWidth` > `clientWidth`);
 * - captura real en `calidad-report/<idioma>/` (evidencia del *finish gate*).
 * Además, una vez por pantalla (a 375 y a 1280 px):
 * - axe WCAG 2.2 AA. Todas las violaciones van al informe; la prueba falla con las serias o
 *   críticas, el mismo criterio de M1–M8.
 * Y por pantalla, a 1280 px: foco visible en los primeros 25 elementos de la tabulación (el
 * criterio de M1: contorno de al menos 2 px y sin quedar tapado).
 *
 * El informe completo queda en `calidad-report/<idioma>/informe.json`.
 */
import AxeBuilder from '@axe-core/playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Browser, type Page } from '@playwright/test';
import pg from 'pg';
import { QUALITY_E2E_DATABASE_URL, QUALITY_WEB_URL } from '../../playwright.calidad.config.ts';

// El idioma se fija al empezar la prueba, según el proyecto.
let LOCALE: 'es-CR' | 'en' = 'es-CR';
let EN = false;
const PASSWORD = 'una frase larga para la demo';
const API_DIR = fileURLToPath(new URL('../../../api/', import.meta.url));
let OUT = '';
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const WIDTHS = [375, 768, 1024, 1280] as const;

type Role = 'visitor' | 'customer' | 'admin';
interface Screen {
  name: string;
  path: string;
  role: Role;
  /** Acción previa sobre la página ya cargada (abrir un panel, provocar un error…). */
  prepare?: (page: Page) => Promise<void>;
}

const p = (es: string, en: string) => (EN ? en : es);

interface Finding {
  screen: string;
  width?: number;
  kind: 'axe' | 'overflow' | 'focus' | 'i18n';
  impact?: string | null;
  id: string;
  detail: string;
}
const findings: Finding[] = [];
const visited: string[] = [];

function account(role?: 'STAFF' | 'ADMIN'): string {
  const email = `cal.${String(Date.now())}.${String(Math.floor(Math.random() * 1e6))}@example.com`;
  execFileSync(
    'node',
    [
      'scripts/e2e-user.ts',
      '--email',
      email,
      '--password',
      PASSWORD,
      '--locale',
      LOCALE,
      ...(role ? ['--role', role] : []),
    ],
    { cwd: API_DIR, env: { ...process.env, DATABASE_URL: QUALITY_E2E_DATABASE_URL }, stdio: 'pipe' },
  );
  return email;
}

async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: QUALITY_E2E_DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(sql, params)).rows as T[];
  } finally {
    await client.end();
  }
}

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext({ baseURL: QUALITY_WEB_URL });
  const page = await context.newPage();
  await page.goto(p('/cuenta/ingresar', '/en/account/sign-in'));
  await page.locator('#login-email').fill(email);
  await page.locator('#login-password').fill(PASSWORD);
  await page.locator('#login-form button[type=submit]').click();
  await expect(page).toHaveURL(EN ? /\/en\/account$/ : /\/cuenta$/);
  return page;
}

async function hydrated(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const el = document.querySelector('main button, main a');
    return el !== null && Object.keys(el).some((key) => key.startsWith('__react'));
  });
}

async function addClasico(page: Page): Promise<void> {
  await page.goto(p('/carta/ceviches/ceviche-clasico', '/en/menu/ceviches/ceviche-clasico'));
  await hydrated(page);
  await page.getByRole('button', { name: EN ? /^Add · / : /^Agregar · / }).click();
  await expect(page.getByText(p('Agregado a tu pedido.', 'Added to your order.'))).toBeVisible();
}

/** Pide y paga un ceviche con la tarjeta demo aprobada; devuelve el id del pedido. */
async function placeOrder(page: Page, email: string): Promise<string> {
  await addClasico(page);
  await page.goto(p('/pedido/finalizar', '/en/order/checkout'));
  const next = page.getByRole('button', { name: p('Continuar', 'Continue') });
  await next.click();
  await next.click();
  await page.getByRole('radio', { name: EN ? /^Approved/ : /^Aprobado/ }).check();
  await page.getByRole('button', { name: EN ? /^Place order/ : /Confirmar pedido/ }).click();
  await expect(page).toHaveURL(/\/[0-9a-f-]{36}$/);
  const [row] = await query<{ id: string }>(
    `SELECT o."id" FROM "Order" o JOIN "User" u ON u."id" = o."userId" WHERE u."email" = $1`,
    [email],
  );
  if (!row) throw new Error('sin pedido');
  return row.id;
}

async function settle(page: Page): Promise<void> {
  await page.locator('main h1').first().waitFor();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  // Las consultas de datos terminan: sin indicadores de carga visibles.
  await page
    .waitForFunction(() => !document.querySelector('main [role=status][aria-busy=true]'), undefined, {
      timeout: 5_000,
    })
    .catch(() => undefined);
  await page.waitForLoadState('networkidle').catch(() => undefined);
}

async function axe(page: Page, screen: string, width: number): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  for (const v of results.violations) {
    findings.push({
      screen,
      width,
      kind: 'axe',
      impact: v.impact ?? null,
      id: v.id,
      detail: v.nodes
        .slice(0, 4)
        .map((n) => n.target.join(' '))
        .join(' | '),
    });
  }
}

async function focusRing(page: Page, screen: string): Promise<void> {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
  });
  await page.locator('body').focus();
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      // Campo de fecha u hora con el foco en su botón nativo (el reloj o el calendario): el campo deja
      // de cumplir `:focus` y Chromium dibuja su propio recuadro en el botón. No es un foco perdido.
      if (el.matches('input[type=date], input[type=time]') && !el.matches(':focus')) return { native: true };
      el.scrollIntoView({ block: 'center' });
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return {
        label: `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent).trim().slice(0, 40)}"`,
        ring: style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2,
        covered: rect.width > 0 && !(top && (top === el || el.contains(top) || top.contains(el))),
      };
    });
    if (!info || 'native' in info) continue;
    if (!info.ring) findings.push({ screen, kind: 'focus', id: 'focus-not-visible', detail: info.label });
    if (info.covered) findings.push({ screen, kind: 'focus', id: 'focus-covered', detail: info.label });
  }
}

async function audit(page: Page, screen: Screen): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(screen.path);
  await settle(page);
  if (screen.prepare) await screen.prepare(page);
  // Fechas y horas en el idioma de la página: en inglés no puede quedar el formato de es-CR.
  if (EN) {
    const spanishTime = await page.evaluate(() => /\b[ap]\. m\./.exec(document.body.innerText)?.[0] ?? null);
    if (spanishTime)
      findings.push({ screen: screen.name, kind: 'i18n', id: 'date-format-locale', detail: spanishTime });
  }
  mkdirSync(OUT, { recursive: true });
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: width < 768 ? 812 : 900 });
    await page.waitForTimeout(250);
    const overflow = await page.evaluate(() => {
      const d = document.documentElement;
      if (d.scrollWidth <= d.clientWidth) return null;
      const wide = [...document.querySelectorAll('body *')]
        .filter(
          (el) => el.getBoundingClientRect().right > d.clientWidth + 1 && !el.closest('.overflow-x-auto'),
        )
        .slice(0, 3)
        .map((el) => `${el.tagName.toLowerCase()}.${el.getAttribute('class')?.slice(0, 50) ?? ''}`);
      return `${String(d.scrollWidth)} > ${String(d.clientWidth)}: ${wide.join(' | ')}`;
    });
    if (overflow)
      findings.push({
        screen: screen.name,
        width,
        kind: 'overflow',
        id: 'horizontal-overflow',
        detail: overflow,
      });
    await page.screenshot({
      path: `${OUT}${String(width)}-${screen.name}.jpg`,
      fullPage: true,
      type: 'jpeg',
      quality: 70,
    });
    if (width === 375 || width === 1280) await axe(page, screen.name, width);
  }
  await focusRing(page, screen.name);
  visited.push(screen.name);
}

test.describe.configure({ mode: 'serial' });

test('auditoría de pantallas reales', async ({ browser }) => {
  LOCALE = test.info().project.name === 'en' ? 'en' : 'es-CR';
  EN = LOCALE === 'en';
  OUT = fileURLToPath(new URL(`../../calidad-report/${LOCALE}/`, import.meta.url));
  const customerEmail = account();
  const adminEmail = account('ADMIN');
  const customer = await signedIn(browser, customerEmail);
  const orderId = await placeOrder(customer, customerEmail);
  await addClasico(customer); // Carrito con un plato para la página del pedido.
  const admin = await signedIn(browser, adminEmail);
  const [customerRow] = await query<{ id: string }>(`SELECT "id" FROM "User" WHERE "email" = $1`, [
    customerEmail,
  ]);
  const [product] = await query<{ id: string }>(`SELECT "id" FROM "Product" WHERE "slug" = 'ceviche-nikkei'`);
  const visitorContext = await browser.newContext({ baseURL: QUALITY_WEB_URL });
  const visitor = await visitorContext.newPage();

  const screens: Screen[] = [
    { name: 'inicio', path: p('/', '/en'), role: 'visitor' },
    { name: 'carta', path: p('/carta', '/en/menu'), role: 'visitor' },
    {
      name: 'carta-hoja-de-producto',
      path: p('/carta', '/en/menu'),
      role: 'visitor',
      prepare: async (page) => {
        await hydrated(page);
        await page
          .getByRole('button', { name: EN ? /^Add/ : /^Agregar/ })
          .first()
          .click();
        await page.locator('dialog[open]').waitFor();
      },
    },
    { name: 'categoria', path: p('/carta/ceviches', '/en/menu/ceviches'), role: 'visitor' },
    {
      name: 'plato',
      path: p('/carta/ceviches/ceviche-clasico', '/en/menu/ceviches/ceviche-clasico'),
      role: 'visitor',
    },
    { name: 'nosotros', path: p('/nosotros', '/en/about'), role: 'visitor' },
    { name: 'visitanos', path: p('/visitanos', '/en/visit'), role: 'visitor' },
    { name: 'ingresar', path: p('/cuenta/ingresar', '/en/account/sign-in'), role: 'visitor' },
    {
      name: 'ingresar-error',
      path: p('/cuenta/ingresar', '/en/account/sign-in'),
      role: 'visitor',
      prepare: async (page) => {
        await hydrated(page);
        await page.locator('#login-form button[type=submit]').click();
        await page.getByRole('alert').first().waitFor();
      },
    },
    { name: 'registro', path: p('/cuenta/registro', '/en/account/register'), role: 'visitor' },
    { name: 'recuperar', path: p('/cuenta/recuperar', '/en/account/forgot-password'), role: 'visitor' },
    { name: 'pedido-vacio', path: p('/pedido', '/en/order'), role: 'visitor' },
    { name: 'perfil', path: p('/cuenta', '/en/account'), role: 'customer' },
    { name: 'carrito', path: p('/pedido', '/en/order'), role: 'customer' },
    { name: 'checkout', path: p('/pedido/finalizar', '/en/order/checkout'), role: 'customer' },
    {
      name: 'confirmacion',
      path: p(`/pedido/confirmacion/${orderId}`, `/en/order/confirmation/${orderId}`),
      role: 'customer',
    },
    { name: 'historial', path: p('/cuenta/pedidos', '/en/account/orders'), role: 'customer' },
    {
      name: 'seguimiento',
      path: p(`/cuenta/pedidos/${orderId}`, `/en/account/orders/${orderId}`),
      role: 'customer',
    },
    { name: 'bandeja', path: p('/cuenta/bandeja', '/en/account/inbox'), role: 'customer' },
    { name: 'admin-resumen', path: p('/admin', '/en/admin'), role: 'admin' },
    { name: 'admin-pase', path: p('/admin/pase', '/en/admin/pass'), role: 'admin' },
    { name: 'admin-pedidos', path: p('/admin/pedidos', '/en/admin/orders'), role: 'admin' },
    {
      name: 'admin-pedido',
      path: p(`/admin/pedidos/${orderId}`, `/en/admin/orders/${orderId}`),
      role: 'admin',
    },
    { name: 'admin-carta', path: p('/admin/carta', '/en/admin/menu'), role: 'admin' },
    {
      name: 'admin-plato',
      path: p(`/admin/carta/${product?.id ?? ''}`, `/en/admin/menu/${product?.id ?? ''}`),
      role: 'admin',
    },
    { name: 'admin-plato-nuevo', path: p('/admin/carta/nuevo', '/en/admin/menu/new'), role: 'admin' },
    { name: 'admin-pesca', path: p('/admin/pesca', '/en/admin/catch'), role: 'admin' },
    { name: 'admin-clientes', path: p('/admin/clientes', '/en/admin/customers'), role: 'admin' },
    {
      name: 'admin-cliente',
      path: p(`/admin/clientes/${customerRow?.id ?? ''}`, `/en/admin/customers/${customerRow?.id ?? ''}`),
      role: 'admin',
    },
    { name: 'admin-configuracion', path: p('/admin/configuracion', '/en/admin/settings'), role: 'admin' },
    { name: 'admin-auditoria', path: p('/admin/auditoria', '/en/admin/audit'), role: 'admin' },
  ];
  const pages: Record<Role, Page> = { visitor, customer, admin };
  for (const screen of screens) {
    await test.step(screen.name, async () => {
      await audit(pages[screen.role], screen);
    });
  }

  // Movimiento reducido (R-A11Y-02): con `prefers-reduced-motion: reduce` no queda ninguna
  // animación ni transición en curso en la portada, la carta ni el seguimiento.
  for (const path of [
    p('/', '/en'),
    p('/carta', '/en/menu'),
    p(`/cuenta/pedidos/${orderId}`, `/en/account/orders/${orderId}`),
  ]) {
    const page = path.includes(orderId) ? customer : visitor;
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(path);
    await settle(page);
    const running = await page.evaluate(
      () =>
        document
          .getAnimations()
          .filter((a) => a.playState === 'running' && Number(a.effect?.getTiming().duration ?? 0) > 1).length,
    );
    if (running > 0)
      findings.push({
        screen: path,
        kind: 'axe',
        impact: 'moderate',
        id: 'reduced-motion',
        detail: `${String(running)} animaciones en curso`,
      });
    await page.emulateMedia({ reducedMotion: null });
  }

  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}informe.json`, JSON.stringify({ locale: LOCALE, visited, findings }, null, 2));
  const blocking = findings.filter(
    (f) =>
      f.kind === 'overflow' ||
      f.kind === 'focus' ||
      f.kind === 'i18n' ||
      f.impact === 'serious' ||
      f.impact === 'critical' ||
      f.id === 'reduced-motion',
  );
  expect(visited).toHaveLength(screens.length);
  expect(blocking.map((f) => `${f.screen}@${String(f.width ?? '-')} ${f.id}: ${f.detail}`)).toEqual([]);
});
