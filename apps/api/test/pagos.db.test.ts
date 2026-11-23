/**
 * M6 · Pagos contra PostgreSQL real (§7.2–7.4, §11): matriz de escenarios de la tarjeta demo,
 * idempotencia HTTP y del procesador, concurrencia (`Promise.all`), reconciliación del tiempo
 * agotado, del pendiente y de una llamada interrumpida, contra entrega, capturar, anular y
 * reembolsar (Σ ≤ capturado), RBAC, IDOR, CSRF, vencimiento, límites y AuditLog.
 */
import {
  adminPaymentResponseSchema,
  apiErrorBodySchema,
  checkoutQuoteSchema,
  orderResponseSchema,
  orderSchema,
  type DemoScenario,
  type Order,
} from '@marea-baja/shared';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { PaymentGateway } from '../src/modules/payments/gateway.ts';
import { MockGateway } from '../src/modules/payments/mock-gateway.ts';
import { setUserRoles } from '../src/modules/users/roles.ts';
import { buildApi, Browser, registerUser, signIn, type TestApi } from './http.ts';

let api: TestApi;
const orderBody = z.object({ order: orderSchema });

function nextTuesdayAt13CostaRica(): Date {
  const date = new Date();
  date.setUTCHours(19, 0, 0, 0);
  while (date.getUTCDay() !== 2 || date.getTime() < Date.now()) date.setUTCDate(date.getUTCDate() + 1);
  return date;
}
const OPEN = nextTuesdayAt13CostaRica();
let ceviche = '';
let suave = '';

beforeAll(async () => {
  api = buildApi();
  const product = await api.db.product.findUniqueOrThrow({
    where: { slug: 'ceviche-clasico' },
    include: { optionGroups: { include: { options: true } } },
  });
  ceviche = product.id;
  suave = product.optionGroups.flatMap((g) => g.options).find((o) => o.name === 'Suave')?.id ?? '';
});
afterAll(async () => {
  await api.close();
});
beforeEach(() => {
  api.clock.set(OPEN);
});

const errorCode = (body: unknown) => apiErrorBodySchema.parse(body).error.code;

async function customer(target: TestApi = api, options: { verify?: boolean } = {}) {
  const { email } = await registerUser(target, { verify: options.verify ?? true });
  const browser = await signIn(target, email);
  const user = await target.db.user.findFirstOrThrow({ where: { email } });
  return { browser, userId: user.id, email };
}

async function staffOrAdmin(roles: ('STAFF' | 'ADMIN')[]) {
  const who = await customer();
  await setUserRoles(api.db, {
    email: who.email,
    roles: ['CUSTOMER', ...roles],
    actor: null,
    reason: 'prueba M6',
  });
  // El cambio de roles rota la sesión: se vuelve a entrar.
  return { ...who, browser: await signIn(api, who.email) };
}

/** Pedido nuevo en `PENDING_PAYMENT` (retiro, 2 ceviches: supera el mínimo). */
async function placeOrder(browser: Browser): Promise<Order> {
  const cart = await browser.post('/api/cart/items', {
    locale: 'es-CR',
    productId: ceviche,
    optionIds: [suave],
    quantity: 2,
    mode: 'set',
  });
  expect(cart.status).toBe(200);
  const quote = checkoutQuoteSchema.parse(
    (await browser.post('/api/checkout/quote', { locale: 'es-CR', fulfillmentType: 'PICKUP' })).body,
  );
  const res = await browser.post(
    '/api/orders',
    { locale: 'es-CR', fulfillmentType: 'PICKUP', contactPhone: null, quoteVersion: quote.quoteVersion },
    { 'Idempotency-Key': randomUUID() },
  );
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return orderResponseSchema.parse(res.body).order;
}

function authorize(browser: Browser, orderId: string, scenario: DemoScenario | 'PAID', key = randomUUID()) {
  return browser.post(`/api/orders/${orderId}/payments/authorize`, { scenario }, { 'Idempotency-Key': key });
}

async function paymentRow(orderId: string, db = api.db) {
  return db.payment.findUniqueOrThrow({
    where: { orderId },
    include: { order: true, operations: true, attempts: { orderBy: { createdAt: 'asc' } }, refunds: true },
  });
}

async function mockTransactions(orderId: string, db = api.db) {
  const payment = await db.payment.findUniqueOrThrow({ where: { orderId }, select: { id: true } });
  return db.mockGatewayTransaction.findMany({
    where: { idempotencyKey: { startsWith: `${payment.id}:authorize:` } },
  });
}

describe('tarjeta demo: matriz de escenarios (§7.4)', () => {
  it('APPROVED: autoriza el total del pedido (leído de la base) y el pedido pasa a PENDING_CONFIRMATION', async () => {
    const { browser, userId } = await customer();
    const order = await placeOrder(browser);
    expect(order.payment).toMatchObject({
      status: 'REQUIRES_PAYMENT',
      method: 'DEMO_CARD',
      availableMethods: ['DEMO_CARD', 'CASH_ON_DELIVERY'],
      lastAttempt: null,
    });

    const res = await authorize(browser, order.id, 'APPROVED');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const after = orderBody.parse(res.body).order;
    expect(after.status).toBe('PENDING_CONFIRMATION');
    expect(after.payment).toMatchObject({
      status: 'AUTHORIZED',
      availableMethods: [],
      lastAttempt: { result: 'SUCCEEDED', scenario: 'APPROVED', failureCode: null },
    });

    const row = await paymentRow(order.id);
    expect(row.amountAuthorizedMinor).toBe(order.totals.totalMinor);
    expect(row.amountCapturedMinor).toBe(0);
    expect(row.gatewayRef).toMatch(/^mock_/);
    expect(row.operations).toMatchObject([
      { type: 'AUTHORIZE', status: 'SUCCEEDED', amountMinor: order.totals.totalMinor },
    ]);
    const history = await api.db.orderStatusHistory.findMany({
      where: { orderId: order.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(history.map((h) => [h.fromStatus, h.toStatus, h.actorUserId, h.reason])).toEqual([
      [null, 'PENDING_PAYMENT', userId, null],
      ['PENDING_PAYMENT', 'PENDING_CONFIRMATION', userId, 'payment.authorized'],
    ]);
    expect(await mockTransactions(order.id)).toHaveLength(1);
  });

  it.each([
    ['DECLINED', 'card_declined'],
    ['INSUFFICIENT_FUNDS', 'insufficient_funds'],
    ['PROCESSOR_ERROR', 'processor_error'],
  ] as const)(
    '%s: rechaza (%s), el pedido sigue reservado y se puede reintentar con otro escenario',
    async (scenario, code) => {
      const { browser } = await customer();
      const order = await placeOrder(browser);
      const declined = await authorize(browser, order.id, scenario);
      expect(declined.status).toBe(200);
      const view = orderBody.parse(declined.body).order;
      expect(view.status).toBe('PENDING_PAYMENT');
      expect(view.payment).toMatchObject({
        status: 'REQUIRES_PAYMENT',
        availableMethods: ['DEMO_CARD', 'CASH_ON_DELIVERY'],
        lastAttempt: { result: 'FAILED', scenario, failureCode: code },
      });
      const row = await paymentRow(order.id);
      expect(row.amountAuthorizedMinor).toBe(0);
      expect(row.operations).toMatchObject([{ status: 'FAILED', lastError: code }]);

      const retry = await authorize(browser, order.id, 'APPROVED');
      expect(orderBody.parse(retry.body).order.payment.status).toBe('AUTHORIZED');
      const final = await paymentRow(order.id);
      expect(final.attempts.map((a) => a.result)).toEqual(['FAILED', 'SUCCEEDED']);
      expect(final.amountAuthorizedMinor).toBe(order.totals.totalMinor);
    },
  );

  it('TIMEOUT: responde "en proceso"; la reconciliación encuentra la autorización y no cobra dos veces', async () => {
    const { browser } = await customer();
    const order = await placeOrder(browser);
    const res = await authorize(browser, order.id, 'TIMEOUT');
    expect(res.status).toBe(200);
    expect(orderBody.parse(res.body).order.payment).toMatchObject({
      status: 'PROCESSING',
      lastAttempt: { result: 'UNKNOWN', scenario: 'TIMEOUT' },
    });
    // El procesador sí autorizó (internamente); el pago todavía no lo sabe.
    expect((await mockTransactions(order.id)).map((t) => t.state)).toEqual(['AUTHORIZED']);
    expect((await paymentRow(order.id)).operations).toMatchObject([{ status: 'UNKNOWN' }]);

    // Mientras está en proceso, otro intento → 409.
    const again = await authorize(browser, order.id, 'APPROVED');
    expect(again.status).toBe(409);
    expect(errorCode(again.body)).toBe('PAYMENT_IN_PROGRESS');

    await api.payments.reconcile();
    await api.payments.reconcile();
    const row = await paymentRow(order.id);
    expect(row.status).toBe('AUTHORIZED');
    expect(row.order.status).toBe('PENDING_CONFIRMATION');
    expect(row.amountAuthorizedMinor).toBe(order.totals.totalMinor);
    expect(row.operations).toMatchObject([{ status: 'SUCCEEDED' }]);
    expect(await mockTransactions(order.id)).toHaveLength(1);
    const view = orderBody.parse((await browser.get(`/api/orders/${order.id}`)).body).order;
    expect(view.payment.lastAttempt).toMatchObject({ result: 'SUCCEEDED', scenario: 'TIMEOUT' });
  });

  it('PENDING: queda en proceso y se aprueba a los ~20 s (reconciliación)', async () => {
    const { browser } = await customer();
    const order = await placeOrder(browser);
    const res = await authorize(browser, order.id, 'PENDING');
    expect(orderBody.parse(res.body).order.payment).toMatchObject({
      status: 'PROCESSING',
      lastAttempt: { result: 'PENDING' },
    });
    api.clock.advance(10_000);
    await api.payments.reconcile();
    expect((await paymentRow(order.id)).status).toBe('PROCESSING');
    api.clock.advance(10_000);
    await api.payments.reconcile();
    const row = await paymentRow(order.id);
    expect(row.status).toBe('AUTHORIZED');
    expect(row.order.status).toBe('PENDING_CONFIRMATION');
    expect(row.attempts.map((a) => a.result)).toEqual(['SUCCEEDED']);
    // La transición la hizo el sistema (sin actor).
    const last = await api.db.orderStatusHistory.findFirstOrThrow({
      where: { orderId: order.id, toStatus: 'PENDING_CONFIRMATION' },
    });
    expect(last.actorUserId).toBeNull();
  });
});

describe('intención antes de la llamada externa (§7.3, punto 3)', () => {
  it('si la llamada al procesador se cae, la operación queda registrada y la reconciliación la repite con la misma clave', async () => {
    const own = buildApi({
      paymentGateway: new (class implements PaymentGateway {
        readonly real: MockGateway;
        constructor() {
          this.real = new MockGateway({ db: api.db, clock: api.clock });
        }
        authorize(): Promise<never> {
          return Promise.reject(new Error('conexión caída antes de llegar al procesador'));
        }
        capture = (i: Parameters<PaymentGateway['capture']>[0]) => this.real.capture(i);
        void = (i: Parameters<PaymentGateway['void']>[0]) => this.real.void(i);
        refund = (i: Parameters<PaymentGateway['refund']>[0]) => this.real.refund(i);
        retrieve = (k: string) => this.real.retrieve(k);
      })(),
    });
    own.clock.set(OPEN);
    try {
      const { browser } = await customer(own);
      const order = await placeOrder(browser);
      const res = await authorize(browser, order.id, 'APPROVED');
      expect(orderBody.parse(res.body).order.payment.status).toBe('PROCESSING');
      const row = await paymentRow(order.id, own.db);
      expect(row.operations).toMatchObject([{ type: 'AUTHORIZE', status: 'UNKNOWN' }]);
      expect(await mockTransactions(order.id, own.db)).toHaveLength(0);

      // El procesador "vuelve": la reconciliación (con el procesador real) no la encuentra y la repite.
      await api.payments.reconcile();
      const fixed = await paymentRow(order.id, own.db);
      expect(fixed.status).toBe('AUTHORIZED');
      expect(fixed.operations).toMatchObject([{ status: 'SUCCEEDED' }]);
      expect(await mockTransactions(order.id, own.db)).toHaveLength(1);
      expect((await mockTransactions(order.id, own.db))[0]?.idempotencyKey).toBe(
        fixed.operations[0]?.idempotencyKey,
      );
    } finally {
      await own.close();
    }
  });

  it('una operación REQUESTED reciente no se toca; vencido el margen, se retoma', async () => {
    const { browser } = await customer();
    const order = await placeOrder(browser);
    // Simula una caída entre registrar la intención y llamar al procesador.
    const payment = await api.db.payment.findUniqueOrThrow({ where: { orderId: order.id } });
    const key = `${payment.id}:authorize:${randomUUID()}`;
    await api.db.payment.update({ where: { id: payment.id }, data: { status: 'PROCESSING' } });
    await api.db.paymentOperation.create({
      data: {
        paymentId: payment.id,
        type: 'AUTHORIZE',
        status: 'REQUESTED',
        idempotencyKey: key,
        amountMinor: order.totals.totalMinor,
        updatedAt: api.clock.now(),
      },
    });
    await api.db.paymentAttempt.create({
      data: { paymentId: payment.id, idempotencyKey: key, demoScenario: 'APPROVED', result: 'UNKNOWN' },
    });
    await api.payments.reconcile();
    expect((await paymentRow(order.id)).status).toBe('PROCESSING');
    api.clock.advance(31_000);
    await api.payments.reconcile();
    expect((await paymentRow(order.id)).status).toBe('AUTHORIZED');
  });
});

describe('idempotencia y concurrencia', () => {
  it('misma Idempotency-Key y mismo cuerpo → la respuesta original; otro escenario con la misma clave → 422', async () => {
    const { browser } = await customer();
    const order = await placeOrder(browser);
    const key = randomUUID();
    const first = await authorize(browser, order.id, 'DECLINED', key);
    const replay = await authorize(browser, order.id, 'DECLINED', key);
    expect(replay.status).toBe(first.status);
    expect(replay.body).toEqual(first.body);
    expect((await paymentRow(order.id)).attempts).toHaveLength(1);
    const reused = await authorize(browser, order.id, 'APPROVED', key);
    expect(reused.status).toBe(422);
    expect(errorCode(reused.body)).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('dos autorizaciones simultáneas con claves distintas: una sola autoriza, la otra recibe 409', async () => {
    const { browser } = await customer();
    const order = await placeOrder(browser);
    await browser.refreshCsrf();
    const results = await Promise.all([
      authorize(browser, order.id, 'APPROVED'),
      authorize(browser, order.id, 'APPROVED'),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
    const conflict = results.find((r) => r.status === 409);
    expect(['PAYMENT_IN_PROGRESS', 'PAYMENT_NOT_ALLOWED']).toContain(errorCode(conflict?.body));
    expect(await mockTransactions(order.id)).toHaveLength(1);
    expect((await paymentRow(order.id)).amountAuthorizedMinor).toBe(order.totals.totalMinor);
  });

  it('un pedido ya autorizado no se vuelve a autorizar', async () => {
    const { browser } = await customer();
    const order = await placeOrder(browser);
    await authorize(browser, order.id, 'APPROVED');
    const again = await authorize(browser, order.id, 'APPROVED');
    expect(again.status).toBe(409);
    expect(errorCode(again.body)).toBe('PAYMENT_NOT_ALLOWED');
  });
});

describe('contra entrega (D-M6-1)', () => {
  it('deja el pago pendiente de cobro y el pedido por confirmar, sin procesador; repetirlo no cambia nada', async () => {
    const { browser } = await customer();
    const order = await placeOrder(browser);
    const res = await browser.post(`/api/orders/${order.id}/payments/cash-on-delivery`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const view = orderBody.parse(res.body).order;
    expect(view.status).toBe('PENDING_CONFIRMATION');
    expect(view.payment).toMatchObject({
      status: 'PENDING_COLLECTION',
      method: 'CASH_ON_DELIVERY',
      availableMethods: [],
    });
    const again = await browser.post(`/api/orders/${order.id}/payments/cash-on-delivery`);
    expect(again.status).toBe(200);
    const row = await paymentRow(order.id);
    expect(row.operations).toHaveLength(0);
    expect(row.amountAuthorizedMinor).toBe(0);
    expect(await api.db.orderStatusHistory.count({ where: { orderId: order.id } })).toBe(2);
    // Elegida la contra entrega, la tarjeta ya no se acepta.
    const card = await authorize(browser, order.id, 'APPROVED');
    expect(card.status).toBe(409);
    expect(errorCode(card.body)).toBe('PAYMENT_NOT_ALLOWED');
  });

  it('después de pagar con tarjeta, no se puede cambiar a contra entrega', async () => {
    const { browser } = await customer();
    const order = await placeOrder(browser);
    await authorize(browser, order.id, 'APPROVED');
    const res = await browser.post(`/api/orders/${order.id}/payments/cash-on-delivery`);
    expect(res.status).toBe(409);
    expect(errorCode(res.body)).toBe('PAYMENT_NOT_ALLOWED');
  });
});

describe('reglas y seguridad del cliente', () => {
  it('vencida la reserva de 30 min, ni la tarjeta ni la contra entrega', async () => {
    const { browser } = await customer();
    const order = await placeOrder(browser);
    api.clock.advance(30 * 60_000);
    expect(errorCode((await authorize(browser, order.id, 'APPROVED')).body)).toBe('ORDER_EXPIRED');
    const cash = await browser.post(`/api/orders/${order.id}/payments/cash-on-delivery`);
    expect(cash.status).toBe(409);
    expect(errorCode(cash.body)).toBe('ORDER_EXPIRED');
    const view = orderBody.parse((await browser.get(`/api/orders/${order.id}`)).body).order;
    expect(view.payment.availableMethods).toEqual([]);
  });

  it('el cuerpo no puede traer montos ni estados; el escenario es una lista cerrada', async () => {
    const { browser } = await customer();
    const order = await placeOrder(browser);
    const withAmount = await browser.post(
      `/api/orders/${order.id}/payments/authorize`,
      { scenario: 'APPROVED', amountMinor: 1 },
      { 'Idempotency-Key': randomUUID() },
    );
    expect(withAmount.status).toBe(400);
    expect(errorCode((await authorize(browser, order.id, 'PAID')).body)).toBe('VALIDATION_FAILED');
    const noKey = await browser.post(`/api/orders/${order.id}/payments/authorize`, { scenario: 'APPROVED' });
    expect(noKey.status).toBe(400);
    expect((await paymentRow(order.id)).status).toBe('REQUIRES_PAYMENT');
  });

  it('sin sesión 401, sin verificar 403, pedido ajeno 404, sin CSRF 403', async () => {
    const owner = await customer();
    const order = await placeOrder(owner.browser);
    const anonymous = new Browser(api);
    expect((await authorize(anonymous, order.id, 'APPROVED')).status).toBe(401);
    const unverified = await customer(api, { verify: false });
    const blocked = await authorize(unverified.browser, order.id, 'APPROVED');
    expect(blocked.status).toBe(403);
    expect(errorCode(blocked.body)).toBe('EMAIL_NOT_VERIFIED');
    const other = await customer();
    expect((await authorize(other.browser, order.id, 'APPROVED')).status).toBe(404);
    expect((await other.browser.post(`/api/orders/${order.id}/payments/cash-on-delivery`)).status).toBe(404);
    const noCsrf = await request(api.app)
      .post(`/api/orders/${order.id}/payments/authorize`)
      .set('Idempotency-Key', randomUUID())
      .send({ scenario: 'APPROVED' });
    expect(noCsrf.status).toBe(403);
    expect((await paymentRow(order.id)).status).toBe('REQUIRES_PAYMENT');
  });

  it('con DEMO_PAYMENTS_ENABLED=false la tarjeta demo responde 403 y solo se ofrece contra entrega', async () => {
    const off = buildApi({ config: { demoPaymentsEnabled: false } });
    off.clock.set(OPEN);
    try {
      const { browser } = await customer(off);
      const order = await placeOrder(browser);
      expect(order.payment.availableMethods).toEqual(['CASH_ON_DELIVERY']);
      const quote = checkoutQuoteSchema.parse(
        (await browser.post('/api/checkout/quote', { locale: 'es-CR', fulfillmentType: 'PICKUP' })).body,
      );
      expect(quote.paymentMethods).toEqual(['CASH_ON_DELIVERY']);
      const res = await authorize(browser, order.id, 'APPROVED');
      expect(res.status).toBe(403);
      expect(errorCode(res.body)).toBe('DEMO_PAYMENTS_DISABLED');
    } finally {
      await off.close();
    }
  });

  it('límite de 10 autorizaciones por pedido y hora (§8.4)', async () => {
    const { browser } = await customer();
    const order = await placeOrder(browser);
    for (let i = 0; i < 10; i += 1) {
      expect((await authorize(browser, order.id, 'DECLINED')).status).toBe(200);
    }
    const limited = await authorize(browser, order.id, 'APPROVED');
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
  });
});

describe('staff y admin: capturar, anular y reembolsar (D-M6-2)', () => {
  async function authorized() {
    const { browser } = await customer();
    const order = await placeOrder(browser);
    await authorize(browser, order.id, 'APPROVED');
    return order;
  }
  const adminPayment = (body: unknown) => adminPaymentResponseSchema.parse(body).payment;

  it('RBAC: el cliente no ve ni opera; el staff captura y anula pero no reembolsa; solo el admin reembolsa', async () => {
    const order = await authorized();
    const client = await customer();
    expect((await client.browser.get(`/api/admin/orders/${order.id}/payment`)).status).toBe(403);
    expect((await client.browser.post(`/api/admin/orders/${order.id}/payment/capture`)).status).toBe(403);
    const staff = await staffOrAdmin(['STAFF']);
    const view = await staff.browser.get(`/api/admin/orders/${order.id}/payment`);
    expect(view.status).toBe(200);
    expect(adminPayment(view.body)).toMatchObject({ status: 'AUTHORIZED', method: 'DEMO_CARD', refunds: [] });
    const refund = await staff.browser.post(
      `/api/admin/orders/${order.id}/payment/refunds`,
      { amountMinor: 100, reason: 'prueba' },
      { 'Idempotency-Key': randomUUID() },
    );
    expect(refund.status).toBe(403);
    expect((await staff.browser.get(`/api/admin/orders/${randomUUID()}/payment`)).status).toBe(404);
  });

  it('captura lo autorizado una sola vez (también con dos capturas simultáneas) y queda en el AuditLog', async () => {
    const order = await authorized();
    const staff = await staffOrAdmin(['STAFF']);
    await staff.browser.refreshCsrf();
    const results = await Promise.all([
      staff.browser.post(`/api/admin/orders/${order.id}/payment/capture`),
      staff.browser.post(`/api/admin/orders/${order.id}/payment/capture`),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const row = await paymentRow(order.id);
    expect(row.status).toBe('CAPTURED');
    expect(row.amountCapturedMinor).toBe(order.totals.totalMinor);
    // M6 no cambia el estado del pedido: eso lo conecta M7 (D-M6-2).
    expect(row.order.status).toBe('PENDING_CONFIRMATION');
    const mock = await api.db.mockGatewayTransaction.findUniqueOrThrow({
      where: { ref: row.gatewayRef ?? '' },
    });
    expect(mock).toMatchObject({ state: 'CAPTURED', capturedMinor: order.totals.totalMinor });
    const audit = await api.db.auditLog.findMany({ where: { entityId: row.id, action: 'payment.captured' } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorUserId: staff.userId, actorRole: 'STAFF', entityType: 'payment' });
    expect(audit[0]?.after).toMatchObject({
      status: 'CAPTURED',
      amountCapturedMinor: order.totals.totalMinor,
    });
  });

  it('reembolsos parciales y total: Σ ≤ capturado, idempotentes y sin pasarse con pedidos simultáneos', async () => {
    const order = await authorized();
    const total = order.totals.totalMinor;
    const admin = await staffOrAdmin(['ADMIN']);
    expect((await admin.browser.post(`/api/admin/orders/${order.id}/payment/capture`)).status).toBe(200);

    const key = randomUUID();
    const partial = await admin.browser.post(
      `/api/admin/orders/${order.id}/payment/refunds`,
      { amountMinor: 100_000, reason: 'Falta un acompañamiento' },
      { 'Idempotency-Key': key },
    );
    expect(partial.status, JSON.stringify(partial.body)).toBe(201);
    expect(adminPayment(partial.body)).toMatchObject({
      status: 'PARTIALLY_REFUNDED',
      amountRefundedMinor: 100_000,
    });
    const replay = await admin.browser.post(
      `/api/admin/orders/${order.id}/payment/refunds`,
      { amountMinor: 100_000, reason: 'Falta un acompañamiento' },
      { 'Idempotency-Key': key },
    );
    expect(replay.status).toBe(201);
    expect((await paymentRow(order.id)).amountRefundedMinor).toBe(100_000);

    const tooMuch = await admin.browser.post(
      `/api/admin/orders/${order.id}/payment/refunds`,
      { amountMinor: total, reason: 'Más de lo capturado' },
      { 'Idempotency-Key': randomUUID() },
    );
    expect(tooMuch.status).toBe(422);
    expect(errorCode(tooMuch.body)).toBe('REFUND_EXCEEDS_CAPTURED');

    // Dos reembolsos simultáneos que juntos se pasan: solo uno entra.
    const rest = total - 100_000;
    await admin.browser.refreshCsrf();
    const both = await Promise.all(
      [rest, rest].map((amountMinor) =>
        admin.browser.post(
          `/api/admin/orders/${order.id}/payment/refunds`,
          { amountMinor, reason: 'Reembolso del resto' },
          { 'Idempotency-Key': randomUUID() },
        ),
      ),
    );
    expect(both.map((r) => r.status).sort()).toEqual([201, 422]);
    const row = await paymentRow(order.id);
    expect(row).toMatchObject({ status: 'REFUNDED', amountRefundedMinor: total, amountCapturedMinor: total });
    expect(row.refunds.map((r) => r.amountMinor).sort((a, b) => a - b)).toEqual(
      [100_000, rest].sort((a, b) => a - b),
    );
    const audit = await api.db.auditLog.findMany({ where: { entityId: row.id, action: 'payment.refunded' } });
    expect(audit).toHaveLength(2);
    expect(audit.every((a) => a.actorRole === 'ADMIN' && typeof a.reason === 'string')).toBe(true);
    const finalView = adminPayment((await admin.browser.get(`/api/admin/orders/${order.id}/payment`)).body);
    expect(finalView.refunds).toHaveLength(2);
  });

  it('anular: libera la autorización (vía procesador) o el cobro contra entrega; después no se captura', async () => {
    const order = await authorized();
    const staff = await staffOrAdmin(['STAFF']);
    const voided = await staff.browser.post(`/api/admin/orders/${order.id}/payment/void`, {
      reason: 'Cliente canceló',
    });
    expect(voided.status).toBe(200);
    expect(adminPayment(voided.body).status).toBe('VOIDED');
    expect((await staff.browser.post(`/api/admin/orders/${order.id}/payment/capture`)).status).toBe(409);

    const { browser } = await customer();
    const cash = await placeOrder(browser);
    await browser.post(`/api/orders/${cash.id}/payments/cash-on-delivery`);
    const cashVoid = await staff.browser.post(`/api/admin/orders/${cash.id}/payment/void`);
    expect(adminPayment(cashVoid.body)).toMatchObject({ status: 'VOIDED', method: 'CASH_ON_DELIVERY' });
    const audit = await api.db.auditLog.findMany({
      where: { action: 'payment.voided', actorUserId: staff.userId },
    });
    expect(audit).toHaveLength(2);
  });

  it('no se captura ni anula un pedido sin pagar; no se reembolsa sin capturar', async () => {
    const { browser } = await customer();
    const order = await placeOrder(browser);
    const admin = await staffOrAdmin(['ADMIN']);
    for (const op of ['capture', 'void'] as const) {
      const res = await admin.browser.post(`/api/admin/orders/${order.id}/payment/${op}`);
      expect(res.status).toBe(409);
      expect(errorCode(res.body)).toBe('PAYMENT_NOT_ALLOWED');
    }
    const authorizedOrder = await authorized();
    const refund = await admin.browser.post(
      `/api/admin/orders/${authorizedOrder.id}/payment/refunds`,
      { amountMinor: 100, reason: 'Sin capturar' },
      { 'Idempotency-Key': randomUUID() },
    );
    expect(refund.status).toBe(409);
  });

  it('límite de staff/admin: 30 / 10 min por usuario, con entrada en el AuditLog al exceder', async () => {
    const order = await authorized();
    const staff = await staffOrAdmin(['STAFF']);
    // Anular con el pedido ya capturado devuelve 409, pero cada intento cuenta para el límite.
    await staff.browser.post(`/api/admin/orders/${order.id}/payment/capture`);
    for (let i = 0; i < 29; i += 1) {
      expect((await staff.browser.post(`/api/admin/orders/${order.id}/payment/void`)).status).toBe(409);
    }
    const limited = await staff.browser.post(`/api/admin/orders/${order.id}/payment/void`);
    expect(limited.status).toBe(429);
    const audit = await api.db.auditLog.findMany({
      where: { action: 'payment.rate_limited', actorUserId: staff.userId },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.reason).toBe('void');
  });
});

describe('restricciones de la base (§6.3)', () => {
  it('el CHECK impide reembolsar más de lo capturado y capturar más de lo autorizado', async () => {
    const { browser } = await customer();
    const order = await placeOrder(browser);
    const payment = await api.db.payment.findUniqueOrThrow({ where: { orderId: order.id } });
    await expect(
      api.db.payment.update({ where: { id: payment.id }, data: { amountCapturedMinor: 1 } }),
    ).rejects.toThrow();
    await expect(
      api.db.payment.update({
        where: { id: payment.id },
        data: { amountAuthorizedMinor: 10, amountCapturedMinor: 10, amountRefundedMinor: 11 },
      }),
    ).rejects.toThrow();
  });
});
