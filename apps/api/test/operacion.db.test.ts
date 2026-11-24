/**
 * M7 · Operación contra PostgreSQL real (§7.1, §3.6, §8.5, §11): el Pase y los cambios de estado
 * con su matriz por rol, confirmar → capturar, cancelar → anular o reembolsar, versión optimista y
 * concurrencia, entrega con cobro contra entrega, cancelación del cliente, barridos de vencidos y
 * sin confirmar (R-M6-2), historial y seguimiento (D3), correos de estado en los dos idiomas, la
 * bandeja de demostración y `DEMO_ONLY`, AuditLog, RBAC, IDOR, CSRF y límites.
 */
import {
  apiErrorBodySchema,
  checkoutQuoteSchema,
  demoInboxResponseSchema,
  orderResponseSchema,
  orderSchema,
  ordersListResponseSchema,
  passOrderResponseSchema,
  passResponseSchema,
  type Order,
  type OrderStatus,
  type PassOrder,
} from '@marea-baja/shared';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { GatewayResult, PaymentGateway, RetrieveResult } from '../src/modules/payments/gateway.ts';
import { MockGateway } from '../src/modules/payments/mock-gateway.ts';
import { processOutbox } from '../src/modules/notifications/outbox.ts';
import {
  DeliverableRecipients,
  DemoInboxProvider,
  MemoryEmailProvider,
} from '../src/modules/notifications/providers.ts';
import { setUserRoles } from '../src/modules/users/roles.ts';
import { MINUTE } from '../src/lib/clock.ts';
import { pino } from 'pino';
import { buildApi, Browser, registerUser, signIn, type TestApi } from './http.ts';

type Op = 'capture' | 'void' | 'refund';

/** El procesador simulado real, con la posibilidad de forzar el resultado de la próxima llamada. */
class ScriptedGateway implements PaymentGateway {
  #real: MockGateway | null = null;
  readonly #forced = new Map<Op, GatewayResult>();

  attach(target: TestApi): void {
    this.#real = new MockGateway({ db: target.db, clock: target.clock });
  }

  /** La próxima llamada de esa operación responde esto sin llegar al procesador. */
  force(op: Op, result: GatewayResult): void {
    this.#forced.set(op, result);
  }

  get #mock(): MockGateway {
    if (!this.#real) throw new Error('ScriptedGateway sin API');
    return this.#real;
  }

  #through(op: Op, call: () => Promise<GatewayResult>): Promise<GatewayResult> {
    const forced = this.#forced.get(op);
    if (forced) {
      this.#forced.delete(op);
      return Promise.resolve(forced);
    }
    return call();
  }

  authorize(input: Parameters<PaymentGateway['authorize']>[0]): Promise<GatewayResult> {
    return this.#mock.authorize(input);
  }
  capture(input: Parameters<PaymentGateway['capture']>[0]): Promise<GatewayResult> {
    return this.#through('capture', () => this.#mock.capture(input));
  }
  void(input: Parameters<PaymentGateway['void']>[0]): Promise<GatewayResult> {
    return this.#through('void', () => this.#mock.void(input));
  }
  refund(input: Parameters<PaymentGateway['refund']>[0]): Promise<GatewayResult> {
    return this.#through('refund', () => this.#mock.refund(input));
  }
  retrieve(key: string): Promise<RetrieveResult> {
    return this.#mock.retrieve(key);
  }
}

let api: TestApi;
const gateway = new ScriptedGateway();
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
  api = buildApi({ paymentGateway: gateway });
  gateway.attach(api);
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
const passOrder = (body: unknown): PassOrder => passOrderResponseSchema.parse(body).order;

async function customer(options: { locale?: 'es-CR' | 'en' } = {}) {
  const { email } = await registerUser(api, { verify: true, locale: options.locale ?? 'es-CR' });
  const browser = await signIn(api, email);
  const user = await api.db.user.findFirstOrThrow({ where: { email } });
  return { browser, userId: user.id, email };
}

async function staffOrAdmin(roles: ('STAFF' | 'ADMIN')[]) {
  const who = await customer();
  await setUserRoles(api.db, {
    email: who.email,
    roles: ['CUSTOMER', ...roles],
    actor: null,
    reason: 'prueba M7',
  });
  return { ...who, browser: await signIn(api, who.email) };
}

const ADDRESS = {
  label: 'Casa',
  line1: 'Avenida 9, casa 33',
  district: 'San Pedro',
  canton: 'Montes de Oca',
  province: 'San José',
  reference: 'Portón negro',
};

/** Pedido nuevo en `PENDING_PAYMENT` (2 ceviches: supera el mínimo). */
async function placeOrder(
  browser: Browser,
  fulfillmentType: 'PICKUP' | 'DELIVERY' = 'PICKUP',
): Promise<Order> {
  await browser.post('/api/cart/items', {
    locale: 'es-CR',
    productId: ceviche,
    optionIds: [suave],
    quantity: 2,
    mode: 'set',
  });
  let addressId: string | null = null;
  if (fulfillmentType === 'DELIVERY') {
    const created = await browser.post('/api/account/addresses', ADDRESS);
    addressId = (created.body as { address: { id: string } }).address.id;
  }
  const quote = checkoutQuoteSchema.parse(
    (await browser.post('/api/checkout/quote', { locale: 'es-CR', fulfillmentType, addressId })).body,
  );
  const res = await browser.post(
    '/api/orders',
    {
      locale: 'es-CR',
      fulfillmentType,
      addressId,
      contactPhone: fulfillmentType === 'DELIVERY' ? '8888-1234' : null,
      quoteVersion: quote.quoteVersion,
    },
    { 'Idempotency-Key': randomUUID() },
  );
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return orderResponseSchema.parse(res.body).order;
}

/** Pedido pagado con la tarjeta demo (aprobado): `PENDING_CONFIRMATION` con el pago `AUTHORIZED`. */
async function cardOrder(
  fulfillmentType: 'PICKUP' | 'DELIVERY' = 'PICKUP',
  who?: Awaited<ReturnType<typeof customer>>,
) {
  const owner = who ?? (await customer());
  const order = await placeOrder(owner.browser, fulfillmentType);
  const res = await owner.browser.post(
    `/api/orders/${order.id}/payments/authorize`,
    { scenario: 'APPROVED' },
    { 'Idempotency-Key': randomUUID() },
  );
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { owner, order: orderBody.parse(res.body).order };
}

/** Pedido con contra entrega: `PENDING_CONFIRMATION` con el pago `PENDING_COLLECTION`. */
async function cashOrder(fulfillmentType: 'PICKUP' | 'DELIVERY' = 'PICKUP') {
  const owner = await customer();
  const order = await placeOrder(owner.browser, fulfillmentType);
  const res = await owner.browser.post(`/api/orders/${order.id}/payments/cash-on-delivery`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { owner, order: orderBody.parse(res.body).order };
}

async function versionOf(orderId: string): Promise<number> {
  return (await api.db.order.findUniqueOrThrow({ where: { id: orderId }, select: { version: true } }))
    .version;
}

function move(browser: Browser, orderId: string, status: OrderStatus, version: number, reason?: string) {
  return browser.patch(`/api/admin/orders/${orderId}/status`, {
    status,
    version,
    ...(reason ? { reason } : {}),
  });
}

/** Avanza con la versión actual, un segundo después del paso anterior (el reloj de prueba está fijo). */
async function advance(browser: Browser, orderId: string, status: OrderStatus, reason?: string) {
  api.clock.advance(1000);
  return move(browser, orderId, status, await versionOf(orderId), reason);
}

async function templatesFor(userId: string, orderCode?: string): Promise<string[]> {
  const rows = await api.db.emailOutbox.findMany({
    where: { userId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return rows
    .filter((r) => !orderCode || (r.payload as { orderCode?: string }).orderCode === orderCode)
    .map((r) => r.template);
}

// ─── Pase y RBAC ────────────────────────────────────────────────────────────

describe('Pase: acceso y contenido (§3.6)', () => {
  it('invitado 401, cliente 403; staff ve los pedidos que esperan trabajo, con antigüedad y siguiente paso', async () => {
    expect((await new Browser(api).get('/api/admin/pass')).status).toBe(401);
    const { owner, order } = await cardOrder();
    expect((await owner.browser.get('/api/admin/pass')).status).toBe(403);

    const staff = await staffOrAdmin(['STAFF']);
    const res = await staff.browser.get('/api/admin/pass');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const pass = passResponseSchema.parse(res.body);
    const card = pass.orders.find((o) => o.id === order.id);
    expect(card).toMatchObject({
      code: order.code,
      status: 'PENDING_CONFIRMATION',
      next: 'CONFIRMED',
      canCancel: true,
      customerName: 'Ana Prueba',
      payment: { method: 'DEMO_CARD', status: 'AUTHORIZED', operation: null },
      items: [{ name: 'Ceviche clásico de corvina', quantity: 2 }],
    });
    // Nada interno ni de otros hitos: ni `PENDING_PAYMENT` ni pedidos terminados.
    expect(pass.orders.every((o) => o.status !== 'PENDING_PAYMENT' && o.status !== 'DELIVERED')).toBe(true);
    // Sin datos del procesador ni de la cuenta más allá de lo operativo.
    expect(JSON.stringify(res.body)).not.toMatch(/gatewayRef|mock_|idempotency|email|passwordHash/i);
  });

  it('staff no puede cancelar un pedido confirmado; admin sí (el Pase lo indica por rol)', async () => {
    const { order } = await cardOrder();
    const staff = await staffOrAdmin(['STAFF']);
    const admin = await staffOrAdmin(['ADMIN']);
    expect((await advance(staff.browser, order.id, 'CONFIRMED')).status).toBe(200);
    const asStaff = passResponseSchema.parse((await staff.browser.get('/api/admin/pass')).body);
    const asAdmin = passResponseSchema.parse((await admin.browser.get('/api/admin/pass')).body);
    expect(asStaff.orders.find((o) => o.id === order.id)).toMatchObject({
      next: 'PREPARING',
      canCancel: false,
    });
    expect(asAdmin.orders.find((o) => o.id === order.id)).toMatchObject({
      next: 'PREPARING',
      canCancel: true,
    });
    const denied = await advance(staff.browser, order.id, 'CANCELLED', 'Sin pescado');
    expect(denied.status).toBe(403);
    expect(errorCode(denied.body)).toBe('FORBIDDEN');
  });

  it('cliente 403 al cambiar estados; CSRF obligatorio; pedido inexistente 404; cuerpo estricto', async () => {
    const { owner, order } = await cardOrder();
    expect((await advance(owner.browser, order.id, 'CONFIRMED')).status).toBe(403);
    const staff = await staffOrAdmin(['STAFF']);
    const noCsrf = await staff.browser.agent
      .patch(`/api/admin/orders/${order.id}/status`)
      .set('x-test-ip', staff.browser.ip)
      .set('Origin', 'http://web.test')
      .send({ status: 'CONFIRMED', version: await versionOf(order.id) });
    expect(noCsrf.status).toBe(403);
    expect((await move(staff.browser, randomUUID(), 'CONFIRMED', 0)).status).toBe(404);
    const extra = await staff.browser.patch(`/api/admin/orders/${order.id}/status`, {
      status: 'CONFIRMED',
      version: await versionOf(order.id),
      amountMinor: 1,
    });
    expect(extra.status).toBe(400);
    expect((await api.db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      'PENDING_CONFIRMATION',
    );
  });
});

// ─── Confirmar → capturar ───────────────────────────────────────────────────

describe('confirmar captura la tarjeta demo (§7.2, §7.3)', () => {
  it('captura, confirma, deja historial y AuditLog del staff y encola "confirmado"', async () => {
    const { owner, order } = await cardOrder();
    const staff = await staffOrAdmin(['STAFF']);
    const res = await advance(staff.browser, order.id, 'CONFIRMED');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(passOrder(res.body)).toMatchObject({ status: 'CONFIRMED', payment: { status: 'CAPTURED' } });

    const row = await api.db.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { payment: true, statusHistory: { orderBy: { createdAt: 'asc' } } },
    });
    expect(row.payment).toMatchObject({ status: 'CAPTURED', amountCapturedMinor: order.totals.totalMinor });
    expect(row.statusHistory.at(-1)).toMatchObject({
      fromStatus: 'PENDING_CONFIRMATION',
      toStatus: 'CONFIRMED',
      actorUserId: staff.userId,
      actorRole: 'STAFF',
    });
    const audit = await api.db.auditLog.findMany({
      where: { entityId: order.id, action: 'order.status_changed' },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorRole: 'STAFF', entityType: 'order' });
    expect(audit[0]?.after).toEqual({ code: order.code, status: 'CONFIRMED', version: row.version });
    expect(await templatesFor(owner.userId, order.code)).toEqual(['order-received', 'order-confirmed']);
  });

  it('versión vieja → 409 ORDER_VERSION_CONFLICT; dos confirmaciones a la vez → una sola captura', async () => {
    const { order } = await cardOrder();
    const a = await staffOrAdmin(['STAFF']);
    const b = await staffOrAdmin(['ADMIN']);
    const version = await versionOf(order.id);
    expect(errorCode((await move(a.browser, order.id, 'CONFIRMED', version + 7)).body)).toBe(
      'ORDER_VERSION_CONFLICT',
    );
    await a.browser.refreshCsrf();
    await b.browser.refreshCsrf();
    const results = await Promise.all([
      move(a.browser, order.id, 'CONFIRMED', version),
      move(b.browser, order.id, 'CONFIRMED', version),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const loser = results.find((r) => r.status === 409);
    expect(['PAYMENT_IN_PROGRESS', 'ORDER_VERSION_CONFLICT']).toContain(errorCode(loser?.body));
    const ops = await api.db.paymentOperation.findMany({
      where: { payment: { orderId: order.id }, type: 'CAPTURE' },
    });
    expect(ops).toHaveLength(1);
    const history = await api.db.orderStatusHistory.count({
      where: { orderId: order.id, toStatus: 'CONFIRMED' },
    });
    expect(history).toBe(1);
  });

  it('captura rechazada → 502 y el pedido no se confirma; el Pase lo muestra; reintentar la completa', async () => {
    const { order } = await cardOrder();
    const staff = await staffOrAdmin(['STAFF']);
    gateway.force('capture', { outcome: 'DECLINED', code: 'processor_error', ref: null });
    const failed = await advance(staff.browser, order.id, 'CONFIRMED');
    expect(failed.status).toBe(502);
    expect(errorCode(failed.body)).toBe('GATEWAY_ERROR');
    expect((await api.db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      'PENDING_CONFIRMATION',
    );
    const pass = passResponseSchema.parse((await staff.browser.get('/api/admin/pass')).body);
    expect(pass.orders.find((o) => o.id === order.id)?.payment.operation).toMatchObject({
      type: 'CAPTURE',
      state: 'FAILED',
    });
    const retry = await advance(staff.browser, order.id, 'CONFIRMED');
    expect(retry.status).toBe(200);
    expect(passOrder(retry.body)).toMatchObject({ status: 'CONFIRMED', payment: { operation: null } });
  });

  it('captura sin respuesta → 202 "en curso"; nada se puede mover; la reconciliación confirma', async () => {
    const { order } = await cardOrder();
    const staff = await staffOrAdmin(['STAFF']);
    gateway.force('capture', { outcome: 'UNKNOWN' });
    const pending = await advance(staff.browser, order.id, 'CONFIRMED');
    expect(pending.status).toBe(202);
    expect(passOrder(pending.body)).toMatchObject({
      status: 'PENDING_CONFIRMATION',
      payment: { operation: { type: 'CAPTURE', state: 'IN_PROGRESS' } },
    });
    // Mientras tanto, cancelar (anular) choca con la captura en curso.
    const cancel = await advance(staff.browser, order.id, 'CANCELLED', 'Cliente llamó');
    expect(cancel.status).toBe(409);
    expect(errorCode(cancel.body)).toBe('PAYMENT_IN_PROGRESS');

    api.clock.advance(1000);
    await api.payments.reconcile();
    const row = await api.db.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { payment: true, statusHistory: { where: { toStatus: 'CONFIRMED' } } },
    });
    expect(row.status).toBe('CONFIRMED');
    expect(row.payment?.status).toBe('CAPTURED');
    expect(row.statusHistory).toMatchObject([{ actorUserId: null, reason: 'reconciliation' }]);
  });
});

// ─── Avance operativo ───────────────────────────────────────────────────────

describe('avance operativo por modalidad (§7.1)', () => {
  it('retiro: confirmar → preparar → listo → entregado, con un correo por paso; sale del Pase', async () => {
    const { owner, order } = await cardOrder('PICKUP');
    const staff = await staffOrAdmin(['STAFF']);
    for (const status of ['CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP', 'DELIVERED'] as const) {
      const res = await advance(staff.browser, order.id, status);
      expect(res.status, `${status}: ${JSON.stringify(res.body)}`).toBe(200);
    }
    expect(await templatesFor(owner.userId, order.code)).toEqual([
      'order-received',
      'order-confirmed',
      'order-preparing',
      'order-ready',
      'order-delivered',
    ]);
    const pass = passResponseSchema.parse((await staff.browser.get('/api/admin/pass')).body);
    expect(pass.orders.some((o) => o.id === order.id)).toBe(false);
    // El cliente ve las marcas de la línea de marea, sin el actor.
    const view = orderBody.parse((await owner.browser.get(`/api/orders/${order.id}`)).body).order;
    expect(view.timeline.map((t) => t.status)).toEqual([
      'PENDING_PAYMENT',
      'PENDING_CONFIRMATION',
      'CONFIRMED',
      'PREPARING',
      'READY_FOR_PICKUP',
      'DELIVERED',
    ]);
    expect(view.cancellable).toBe(false);
    expect(JSON.stringify(view.timeline)).not.toContain(staff.userId);
  });

  it('saltear pasos o usar el paso de la otra modalidad → 409 ORDER_TRANSITION_NOT_ALLOWED', async () => {
    const { order } = await cardOrder('PICKUP');
    const staff = await staffOrAdmin(['STAFF']);
    const skip = await advance(staff.browser, order.id, 'PREPARING');
    expect(skip.status).toBe(409);
    expect(errorCode(skip.body)).toBe('ORDER_TRANSITION_NOT_ALLOWED');
    await advance(staff.browser, order.id, 'CONFIRMED');
    await advance(staff.browser, order.id, 'PREPARING');
    const wrong = await advance(staff.browser, order.id, 'OUT_FOR_DELIVERY');
    expect(errorCode(wrong.body)).toBe('ORDER_TRANSITION_NOT_ALLOWED');
    // Hacia atrás o a un estado interno, tampoco.
    expect(errorCode((await advance(staff.browser, order.id, 'CONFIRMED')).body)).toBe(
      'ORDER_TRANSITION_NOT_ALLOWED',
    );
    expect(errorCode((await advance(staff.browser, order.id, 'PENDING_PAYMENT')).body)).toBe(
      'ORDER_TRANSITION_NOT_ALLOWED',
    );
  });

  it('delivery contra entrega: confirma sin procesador y al entregar el cobro queda COLLECTED (auditado)', async () => {
    const { owner, order } = await cashOrder('DELIVERY');
    const staff = await staffOrAdmin(['STAFF']);
    for (const status of ['CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY'] as const) {
      expect((await advance(staff.browser, order.id, status)).status).toBe(200);
    }
    const before = await api.db.payment.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(before.status).toBe('PENDING_COLLECTION');
    const done = await advance(staff.browser, order.id, 'DELIVERED');
    expect(passOrder(done.body)).toMatchObject({ status: 'DELIVERED', payment: { status: 'COLLECTED' } });
    const ops = await api.db.paymentOperation.count({ where: { paymentId: before.id } });
    expect(ops).toBe(0);
    const audit = await api.db.auditLog.findMany({
      where: { entityId: before.id, action: 'payment.collected' },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorUserId: staff.userId, actorRole: 'STAFF' });
    expect(await templatesFor(owner.userId, order.code)).toEqual([
      'order-received',
      'order-confirmed',
      'order-preparing',
      'order-out-for-delivery',
      'order-delivered',
    ]);
  });

  it('el Pase de un delivery trae la dirección y el teléfono para el reparto', async () => {
    const { order } = await cashOrder('DELIVERY');
    const staff = await staffOrAdmin(['STAFF']);
    const pass = passResponseSchema.parse((await staff.browser.get('/api/admin/pass')).body);
    expect(pass.orders.find((o) => o.id === order.id)).toMatchObject({
      fulfillmentType: 'DELIVERY',
      contactPhone: '8888-1234',
      deliveryAddress: { line1: 'Avenida 9, casa 33', district: 'San Pedro', reference: 'Portón negro' },
      payment: { method: 'CASH_ON_DELIVERY', status: 'PENDING_COLLECTION' },
    });
  });
});

// ─── Cancelaciones ──────────────────────────────────────────────────────────

describe('cancelar (§7.1): antes de confirmar anula; después, solo admin y reembolsa', () => {
  it('staff sin motivo → 400; con motivo anula la autorización, cancela, audita y avisa', async () => {
    const { owner, order } = await cardOrder();
    const staff = await staffOrAdmin(['STAFF']);
    const noReason = await advance(staff.browser, order.id, 'CANCELLED');
    expect(noReason.status).toBe(400);
    expect(apiErrorBodySchema.parse(noReason.body).error.fields).toEqual({ reason: 'required' });
    const res = await advance(staff.browser, order.id, 'CANCELLED', 'Se agotó la corvina');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(passOrder(res.body)).toMatchObject({ status: 'CANCELLED', payment: { status: 'VOIDED' } });
    const audit = await api.db.auditLog.findMany({
      where: { entityId: order.id, action: 'order.cancelled' },
    });
    expect(audit[0]).toMatchObject({ reason: 'Se agotó la corvina', actorRole: 'STAFF' });
    expect(await templatesFor(owner.userId, order.code)).toEqual(['order-received', 'order-cancelled']);
  });

  it('admin cancela un confirmado: reembolso total, pedido cancelado y correos de cancelación y reembolso', async () => {
    const { owner, order } = await cardOrder();
    const admin = await staffOrAdmin(['ADMIN']);
    await advance(admin.browser, order.id, 'CONFIRMED');
    const res = await advance(admin.browser, order.id, 'CANCELLED', 'Cocina cerrada por lluvia');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const row = await api.db.payment.findUniqueOrThrow({
      where: { orderId: order.id },
      include: { refunds: true },
    });
    expect(row).toMatchObject({ status: 'REFUNDED', amountRefundedMinor: order.totals.totalMinor });
    expect(row.refunds).toHaveLength(1);
    expect(row.refunds[0]).toMatchObject({
      reason: 'Cocina cerrada por lluvia',
      idempotencyKey: `cancel:${order.id}`,
    });
    expect((await api.db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('CANCELLED');
    const templates = await templatesFor(owner.userId, order.code);
    expect(templates.slice(0, 2)).toEqual(['order-received', 'order-confirmed']);
    expect(templates.slice(2).sort()).toEqual(['order-cancelled', 'order-refunded']);
  });

  it('con un reembolso parcial previo, la cancelación devuelve solo lo que falta', async () => {
    const { order } = await cardOrder();
    const admin = await staffOrAdmin(['ADMIN']);
    await advance(admin.browser, order.id, 'CONFIRMED');
    const partial = await admin.browser.post(
      `/api/admin/orders/${order.id}/payment/refunds`,
      { amountMinor: 100_000, reason: 'Faltó un acompañamiento' },
      { 'Idempotency-Key': randomUUID() },
    );
    expect(partial.status).toBe(201);
    // El reembolso parcial no cambia el pedido.
    expect((await api.db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('CONFIRMED');
    await advance(admin.browser, order.id, 'CANCELLED', 'Cliente no pudo esperar');
    const row = await api.db.payment.findUniqueOrThrow({
      where: { orderId: order.id },
      include: { refunds: true },
    });
    expect(row.status).toBe('REFUNDED');
    expect(row.amountRefundedMinor).toBe(order.totals.totalMinor);
    expect(row.refunds.map((r) => r.amountMinor).sort((a, b) => a - b)).toEqual(
      [100_000, order.totals.totalMinor - 100_000].sort((a, b) => a - b),
    );
  });

  it('reembolso de la cancelación rechazado → 502, el pedido sigue confirmado y se puede reintentar', async () => {
    const { order } = await cardOrder();
    const admin = await staffOrAdmin(['ADMIN']);
    await advance(admin.browser, order.id, 'CONFIRMED');
    gateway.force('refund', { outcome: 'DECLINED', code: 'processor_error', ref: null });
    const failed = await advance(admin.browser, order.id, 'CANCELLED', 'Prueba');
    expect(failed.status).toBe(502);
    expect((await api.db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('CONFIRMED');
    const retry = await advance(admin.browser, order.id, 'CANCELLED', 'Prueba');
    expect(retry.status).toBe(200);
    expect((await api.db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('CANCELLED');
  });

  it('reembolso de la cancelación en curso: el pedido no avanza hasta que se resuelve', async () => {
    const { order } = await cardOrder();
    const admin = await staffOrAdmin(['ADMIN']);
    await advance(admin.browser, order.id, 'CONFIRMED');
    gateway.force('refund', { outcome: 'UNKNOWN' });
    expect((await advance(admin.browser, order.id, 'CANCELLED', 'Prueba')).status).toBe(202);
    const blocked = await advance(admin.browser, order.id, 'PREPARING');
    expect(blocked.status).toBe(409);
    expect(errorCode(blocked.body)).toBe('PAYMENT_IN_PROGRESS');
    await api.payments.reconcile();
    expect((await api.db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('CANCELLED');
  });

  it('admin cancela un confirmado contra entrega: el cobro pendiente se anula sin procesador', async () => {
    const { order } = await cashOrder();
    const admin = await staffOrAdmin(['ADMIN']);
    await advance(admin.browser, order.id, 'CONFIRMED');
    const res = await advance(admin.browser, order.id, 'CANCELLED', 'Sin repartidor');
    expect(passOrder(res.body)).toMatchObject({ status: 'CANCELLED', payment: { status: 'VOIDED' } });
  });

  it('nadie cancela un pedido en preparación (la máquina no lo permite)', async () => {
    const { order } = await cardOrder();
    const admin = await staffOrAdmin(['ADMIN']);
    await advance(admin.browser, order.id, 'CONFIRMED');
    await advance(admin.browser, order.id, 'PREPARING');
    const res = await advance(admin.browser, order.id, 'CANCELLED', 'Tarde');
    expect(errorCode(res.body)).toBe('ORDER_TRANSITION_NOT_ALLOWED');
  });
});

describe('cancelación del cliente (§7.1)', () => {
  it('cancela su pedido por confirmar: anula la tarjeta demo; ajeno → 404; confirmado → 409', async () => {
    const { owner, order } = await cardOrder();
    const other = await customer();
    expect((await other.browser.post(`/api/orders/${order.id}/cancel`, {})).status).toBe(404);
    expect((await new Browser(api).post(`/api/orders/${order.id}/cancel`, {})).status).toBe(401);
    const res = await owner.browser.post(`/api/orders/${order.id}/cancel`, {
      reason: 'Me equivoqué de plato',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const view = orderBody.parse(res.body).order;
    expect(view).toMatchObject({ status: 'CANCELLED', cancellable: false, payment: { status: 'VOIDED' } });
    const history = await api.db.orderStatusHistory.findFirstOrThrow({
      where: { orderId: order.id, toStatus: 'CANCELLED' },
    });
    expect(history).toMatchObject({
      actorUserId: owner.userId,
      actorRole: 'CUSTOMER',
      reason: 'Me equivoqué de plato',
    });
    // El cliente no deja entrada de pedido en el AuditLog (solo staff y admin, §7.1).
    expect(await api.db.auditLog.count({ where: { entityId: order.id } })).toBe(0);

    const confirmed = await cardOrder();
    const staff = await staffOrAdmin(['STAFF']);
    await advance(staff.browser, confirmed.order.id, 'CONFIRMED');
    const late = await confirmed.owner.browser.post(`/api/orders/${confirmed.order.id}/cancel`, {});
    expect(late.status).toBe(409);
    expect(errorCode(late.body)).toBe('ORDER_TRANSITION_NOT_ALLOWED');
  });

  it('un pedido sin pagar no se cancela a mano: vence solo (§7.1)', async () => {
    const owner = await customer();
    const order = await placeOrder(owner.browser);
    const res = await owner.browser.post(`/api/orders/${order.id}/cancel`, {});
    expect(errorCode(res.body)).toBe('ORDER_TRANSITION_NOT_ALLOWED');
  });
});

// ─── Barridos ───────────────────────────────────────────────────────────────

describe('barridos (§7.1, §4.3)', () => {
  it('vencido sin pagar → cancelado sin correo; con el pago en proceso, espera a la reconciliación', async () => {
    const owner = await customer();
    const unpaid = await placeOrder(owner.browser);
    const other = await customer();
    const processing = await placeOrder(other.browser);
    await other.browser.post(
      `/api/orders/${processing.id}/payments/authorize`,
      { scenario: 'PENDING' },
      { 'Idempotency-Key': randomUUID() },
    );
    api.clock.advance(31 * MINUTE);
    await api.operations.sweep(undefined, 1000);
    const swept = await api.db.order.findUniqueOrThrow({
      where: { id: unpaid.id },
      include: { statusHistory: { where: { toStatus: 'CANCELLED' } } },
    });
    expect(swept.status).toBe('CANCELLED');
    expect(swept.statusHistory).toMatchObject([
      { fromStatus: 'PENDING_PAYMENT', actorUserId: null, reason: 'expired' },
    ]);
    expect(await templatesFor(owner.userId, unpaid.code)).toEqual([]);
    expect((await api.db.order.findUniqueOrThrow({ where: { id: processing.id } })).status).toBe(
      'PENDING_PAYMENT',
    );
  });

  it('sin confirmar a los 20 min → se anula y cancela; antes, no', async () => {
    const { owner, order } = await cardOrder();
    api.clock.advance(19 * MINUTE);
    await api.operations.sweep(undefined, 1000);
    expect((await api.db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      'PENDING_CONFIRMATION',
    );
    api.clock.advance(2 * MINUTE);
    await api.operations.sweep(undefined, 1000);
    const row = await api.db.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { payment: true, statusHistory: { where: { toStatus: 'CANCELLED' } } },
    });
    expect(row.status).toBe('CANCELLED');
    expect(row.payment?.status).toBe('VOIDED');
    expect(row.statusHistory).toMatchObject([{ actorUserId: null, reason: 'confirmation_timeout' }]);
    expect(await templatesFor(owner.userId, order.code)).toEqual(['order-received', 'order-cancelled']);
  });

  it('R-M6-2: un pago que la reconciliación autoriza después del vencimiento se anula enseguida', async () => {
    const owner = await customer();
    const order = await placeOrder(owner.browser);
    // Tiempo agotado: el procesador autorizó, pero la API no lo sabe hasta reconciliar.
    const res = await owner.browser.post(
      `/api/orders/${order.id}/payments/authorize`,
      { scenario: 'TIMEOUT' },
      { 'Idempotency-Key': randomUUID() },
    );
    expect(orderBody.parse(res.body).order.payment.status).toBe('PROCESSING');
    api.clock.advance(31 * MINUTE);
    await api.payments.reconcile(undefined, 1000);
    expect((await api.db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      'PENDING_CONFIRMATION',
    );
    api.clock.advance(1000);
    await api.operations.sweep(undefined, 1000);
    const row = await api.db.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { payment: true, statusHistory: { where: { toStatus: 'CANCELLED' } } },
    });
    expect(row.status).toBe('CANCELLED');
    expect(row.payment?.status).toBe('VOIDED');
    expect(row.statusHistory).toMatchObject([{ actorUserId: null, reason: 'authorized_after_expiry' }]);
  });
});

// ─── Historial, correos y bandeja ───────────────────────────────────────────

describe('historial del cliente (D3)', () => {
  it('solo los pedidos propios, del más nuevo al más viejo, paginados de a 20', async () => {
    const owner = await customer();
    const intruder = await customer();
    await placeOrder(intruder.browser);
    const created: string[] = [];
    // De a 3,5 min: nunca más de 20 por hora (límite de M5) y fuera de la ventana de duplicados (60 s).
    for (let i = 0; i < 21; i += 1) {
      api.clock.advance(3.5 * MINUTE);
      created.push((await placeOrder(owner.browser)).id);
    }
    const first = ordersListResponseSchema.parse((await owner.browser.get('/api/orders')).body);
    expect(first.orders).toHaveLength(20);
    expect(first.orders[0]?.id).toBe(created.at(-1));
    expect(first.orders[0]).toMatchObject({ itemCount: 2, status: 'PENDING_PAYMENT' });
    expect(first.nextCursor).not.toBeNull();
    const second = ordersListResponseSchema.parse(
      (await owner.browser.get(`/api/orders?cursor=${first.nextCursor ?? ''}`)).body,
    );
    expect(second.orders.map((o) => o.id)).toEqual([created[0]]);
    expect(second.nextCursor).toBeNull();
    expect((await owner.browser.get('/api/orders?cursor=nope')).status).toBe(400);
    expect((await new Browser(api).get('/api/orders')).status).toBe(401);
  });
});

describe('correos de estado y bandeja de demostración (§8.5)', () => {
  it('"pedido recibido" al cliente y "nuevo pedido por confirmar" al staff, en el idioma de cada cuenta', async () => {
    const staff = await staffOrAdmin(['STAFF']);
    const owner = await customer({ locale: 'en' });
    const { order } = await cardOrder('PICKUP', owner);
    const toStaff = await api.db.emailOutbox.findMany({
      where: { userId: staff.userId, template: 'staff-new-order' },
    });
    expect(toStaff.some((r) => (r.payload as { orderCode?: string }).orderCode === order.code)).toBe(true);
    await api.outbox.idle();
    await api.outbox.kick();
    await api.outbox.idle();
    const sent = api.email.sent.filter((m) => m.to === owner.email);
    const received = sent.find((m) => m.subject.includes(order.code));
    expect(received?.subject).toBe(`We received your order ${order.code} · Marea Baja`);
    expect(received?.html).toContain('lang="en"');
    expect(received?.text).toContain(`/en/account/orders/${order.id}`);
    expect(received?.text).toMatch(/fictional demo restaurant/);
    // Sin dirección, teléfono ni datos de pago en el correo.
    expect(received?.text).not.toMatch(/8888|DEMO •|mock_/);
  });

  it('la bandeja muestra los correos de la cuenta con su estado, sin enlaces ni tokens', async () => {
    const { owner, order } = await cardOrder();
    await api.outbox.idle();
    await api.outbox.kick();
    await api.outbox.idle();
    const res = await owner.browser.get('/api/me/notifications');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const inbox = demoInboxResponseSchema.parse(res.body);
    const received = inbox.messages.find((m) => m.template === 'order-received');
    expect(received).toMatchObject({
      status: 'SENT',
      to: owner.email,
      orderId: order.id,
      subject: `Recibimos tu pedido ${order.code} · Marea Baja`,
    });
    const verification = inbox.messages.find((m) => m.template === 'email-verification');
    expect(verification?.status).toBe('SENT');
    expect(JSON.stringify(res.body)).not.toMatch(/token=|https?:\/\//);
    // Solo los de la propia cuenta.
    const other = await customer();
    const theirs = demoInboxResponseSchema.parse((await other.browser.get('/api/me/notifications')).body);
    expect(theirs.messages.every((m) => m.to === other.email)).toBe(true);
    expect((await new Browser(api).get('/api/me/notifications')).status).toBe(401);
  });

  it('DEMO_ONLY: el destinatario sin correo real no se intenta; los de la lista sí se envían', async () => {
    const owner = await customer();
    const allowed = await customer();
    const later = new Date(api.clock.now().getTime() + 24 * 60 * MINUTE);
    const payload = (code: string) => ({
      name: 'Ana',
      actionUrl: 'http://web.test/cuenta/pedidos/x',
      orderCode: code,
    });
    // Encolados "para mañana": el worker de la API (con su reloj de hoy) no los toma.
    await api.db.emailOutbox.createMany({
      data: [
        {
          userId: owner.userId,
          to: owner.email,
          locale: 'es_CR',
          template: 'order-received',
          payload: payload('MB-DEMO01'),
          nextAttemptAt: later,
        },
        {
          userId: owner.userId,
          to: owner.email,
          locale: 'es_CR',
          template: 'email-verification',
          payload: { name: 'Ana', actionUrl: 'http://web.test/cuenta/verificar#token=secreto' },
          nextAttemptAt: later,
        },
        {
          userId: allowed.userId,
          to: allowed.email,
          locale: 'es_CR',
          template: 'order-received',
          payload: payload('MB-DEMO02'),
          nextAttemptAt: later,
        },
      ],
    });
    const real = new MemoryEmailProvider();
    const provider = new DeliverableRecipients(real, [allowed.email.toUpperCase()]);
    const tomorrow = { now: () => new Date(later.getTime() + 1000) };
    await processOutbox({ db: api.db, provider, clock: tomorrow, logger: pino({ level: 'silent' }) }, 500);

    const mine = await api.db.emailOutbox.findMany({
      where: { userId: owner.userId, nextAttemptAt: { gte: later } },
    });
    const order = mine.find((r) => r.template === 'order-received');
    expect(order).toMatchObject({
      status: 'DEMO_ONLY',
      providerMessageId: null,
      lastError: null,
      attempts: 1,
    });
    // El correo del pedido conserva su contenido para la bandeja; el de un solo uso pierde el enlace.
    expect(order?.payload).toMatchObject({ orderCode: 'MB-DEMO01' });
    expect(mine.find((r) => r.template === 'email-verification')).toMatchObject({
      status: 'DEMO_ONLY',
      payload: {},
    });
    const theirs = await api.db.emailOutbox.findFirstOrThrow({
      where: { userId: allowed.userId, nextAttemptAt: { gte: later } },
    });
    expect(theirs.status).toBe('SENT');
    expect(real.sent.map((m) => m.to)).not.toContain(owner.email);
    expect(real.sent.map((m) => m.to)).toContain(allowed.email);

    const inbox = demoInboxResponseSchema.parse((await owner.browser.get('/api/me/notifications')).body);
    const shown = inbox.messages.find((m) => m.subject.includes('MB-DEMO01'));
    expect(shown).toMatchObject({ status: 'DEMO_ONLY', template: 'order-received' });
    expect(JSON.stringify(inbox)).not.toContain('secreto');
  });

  it('DemoInboxProvider nunca envía: todo queda DEMO_ONLY', async () => {
    expect(await new DemoInboxProvider().send()).toEqual({ accepted: false, demoOnly: true });
  });
});

describe('límites de staff (§8.4)', () => {
  it('más de 30 cambios en 10 min → 429 con Retry-After y entrada en el AuditLog', async () => {
    const { order } = await cardOrder();
    const staff = await staffOrAdmin(['STAFF']);
    let last = await move(staff.browser, order.id, 'CONFIRMED', 999);
    for (let i = 0; i < 30; i += 1) last = await move(staff.browser, order.id, 'CONFIRMED', 999);
    expect(last.status).toBe(429);
    expect(last.headers['retry-after']).toBeDefined();
    const audit = await api.db.auditLog.findMany({
      where: { entityId: order.id, action: 'order.rate_limited' },
    });
    expect(audit.length).toBeGreaterThan(0);
    expect(audit[0]).toMatchObject({ actorUserId: staff.userId, reason: 'CONFIRMED' });
  });
});
