/**
 * M5 · Pedido contra PostgreSQL real: carrito (invitado y cuenta), regla C5, fusión idempotente,
 * cotización, direcciones y zonas, creación del pedido (transacción, copia histórica,
 * idempotencia, duplicados, cambio de precio, horario), IDOR, CSRF y límites.
 */
import {
  apiErrorBodySchema,
  cartMergeResponseSchema,
  cartResponseSchema,
  checkoutQuoteSchema,
  orderResponseSchema,
  type CheckoutQuote,
} from '@marea-baja/shared';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { divideHalfUp } from '../src/modules/pricing/engine.ts';
import { buildApi, Browser, registerUser, signIn, type TestApi } from './http.ts';

let api: TestApi;

/** Próximo martes a las 13:00 en San José (UTC−6): el local está abierto (semilla de M2). */
function nextTuesdayAt13CostaRica(): Date {
  const date = new Date();
  date.setUTCHours(19, 0, 0, 0);
  while (date.getUTCDay() !== 2 || date.getTime() < Date.now()) date.setUTCDate(date.getUTCDate() + 1);
  return date;
}
const OPEN = nextTuesdayAt13CostaRica();
/** El lunes anterior a esa fecha, a la misma hora: cerrado. */
const CLOSED = new Date(OPEN.getTime() - 24 * 60 * 60 * 1000);

interface Ids {
  ceviche: string;
  suave: string;
  rocoto: string;
  palta: string;
  camote: string;
  chalaca: string;
  chicha: string;
  pulpoAgotado: string;
  otroPlatoOpcion: string;
}
let ids: Ids;

beforeAll(async () => {
  api = buildApi();
  api.clock.set(OPEN);
  const ceviche = await api.db.product.findUniqueOrThrow({
    where: { slug: 'ceviche-clasico' },
    include: { optionGroups: { include: { options: true } } },
  });
  const option = (name: string) => {
    const found = ceviche.optionGroups.flatMap((g) => g.options).find((o) => o.name === name);
    if (!found) throw new Error(`Falta la opción ${name}`);
    return found.id;
  };
  const nikkei = await api.db.product.findUniqueOrThrow({
    where: { slug: 'ceviche-nikkei' },
    include: { optionGroups: { include: { options: true } } },
  });
  ids = {
    ceviche: ceviche.id,
    suave: option('Suave'),
    rocoto: option('Rocoto, para valientes'),
    palta: option('Palta'),
    camote: option('Camote glaseado'),
    chalaca: option('Salsa chalaca'),
    chicha: (await api.db.product.findUniqueOrThrow({ where: { slug: 'chicha-morada' } })).id,
    pulpoAgotado: (await api.db.product.findUniqueOrThrow({ where: { slug: 'pulpo-anticuchero' } })).id,
    otroPlatoOpcion: nikkei.optionGroups[0]?.options[0]?.id ?? '',
  };
});
afterAll(async () => {
  await api.close();
});
beforeEach(() => {
  api.clock.set(OPEN);
});

async function verifiedCustomer(
  locale: 'es-CR' | 'en' = 'es-CR',
): Promise<{ browser: Browser; userId: string }> {
  const { email } = await registerUser(api, { verify: true, locale });
  const browser = await signIn(api, email);
  const user = await api.db.user.findFirstOrThrow({ where: { email } });
  return { browser, userId: user.id };
}

const errorCode = (body: unknown) => apiErrorBodySchema.parse(body).error.code;

async function internalLines(userId: string): Promise<number[]> {
  const cart = await api.db.cart.findUnique({ where: { userId }, include: { items: true } });
  return (cart?.items ?? []).map((i) => i.quantity).sort((a, b) => b - a);
}

async function setLine(
  browser: Browser,
  line: { productId: string; optionIds?: string[]; quantity: number; mode?: 'add' | 'set' },
) {
  return browser.post('/api/cart/items', {
    locale: 'es-CR',
    optionIds: [],
    mode: 'set',
    ...line,
  });
}

async function quote(browser: Browser, body: object = {}): Promise<CheckoutQuote> {
  const res = await browser.post('/api/checkout/quote', {
    locale: 'es-CR',
    fulfillmentType: 'PICKUP',
    ...body,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return checkoutQuoteSchema.parse(res.body);
}

function order(browser: Browser, body: object, key: string = randomUUID()) {
  return browser.post(
    '/api/orders',
    { locale: 'es-CR', fulfillmentType: 'PICKUP', contactPhone: '8888 8888', ...body },
    { 'Idempotency-Key': key },
  );
}

/** Carrito que cumple el pedido mínimo: 25 ceviches suaves (20 + 5) y una chicha. */
async function fillCart(browser: Browser): Promise<void> {
  expect(
    (await setLine(browser, { productId: ids.ceviche, optionIds: [ids.suave], quantity: 25 })).status,
  ).toBe(200);
  expect((await setLine(browser, { productId: ids.chicha, quantity: 1 })).status).toBe(200);
}

async function withProduct<T>(
  id: string,
  data: { basePriceMinor?: number; isAvailable?: boolean },
  fn: () => Promise<T>,
) {
  const before = await api.db.product.findUniqueOrThrow({ where: { id } });
  await api.db.product.update({ where: { id }, data });
  try {
    return await fn();
  } finally {
    await api.db.product.update({
      where: { id },
      data: { basePriceMinor: before.basePriceMinor, isAvailable: before.isAvailable },
    });
  }
}

// ─── Carrito de invitado ────────────────────────────────────────────────────

describe('POST /api/cart/quote (invitado)', () => {
  it('valoriza con los precios de la base e ignora cualquier precio que envíe el cliente', async () => {
    const guest = new Browser(api);
    const res = await guest.post('/api/cart/quote', {
      locale: 'en',
      lines: [
        { productId: ids.ceviche, optionIds: [ids.rocoto, ids.palta], quantity: 2, unitPriceMinor: 1 },
        { productId: ids.chicha, quantity: 1, priceMinor: 0 },
      ],
      subtotalMinor: 1,
    });
    expect(res.status).toBe(200);
    const { cart } = cartResponseSchema.parse(res.body);
    const [ceviche, chicha] = cart.lines;
    expect(ceviche).toMatchObject({
      quantity: 2,
      unitPriceMinor: 890000 + 60000 + 90000,
      lineTotalMinor: 2 * 1040000,
      available: true,
      reason: null,
      name: 'Ceviche clásico de corvina',
    });
    expect(ceviche?.options.map((o) => o.name)).toEqual([
      { text: 'Rocoto, for the brave', lang: 'en' },
      { text: 'Avocado', lang: 'en' },
    ]);
    expect(chicha?.unitPriceMinor).toBe(220000);
    expect(cart).toMatchObject({
      subtotalMinor: 2080000 + 220000,
      itemCount: 3,
      minOrderMinor: 500000,
      meetsMinimum: true,
    });
    // Nada se guardó: el carrito del invitado vive en el navegador.
    expect(
      await api.db.cartItem.count({ where: { productId: ids.ceviche, cart: { user: { email: 'x' } } } }),
    ).toBe(0);
  });

  it('marca cada línea que no se puede pedir con su motivo y la deja fuera del subtotal', async () => {
    const guest = new Browser(api);
    const res = await guest.post('/api/cart/quote', {
      locale: 'es-CR',
      lines: [
        { productId: ids.pulpoAgotado, quantity: 1 },
        { productId: randomUUID(), quantity: 1 },
        { productId: ids.ceviche, optionIds: [], quantity: 1 },
        { productId: ids.ceviche, optionIds: [ids.suave, ids.otroPlatoOpcion], quantity: 1 },
        { productId: ids.ceviche, optionIds: [ids.suave, ids.palta, ids.camote, ids.chalaca], quantity: 1 },
        { productId: ids.chicha, quantity: 1 },
      ],
    });
    const { cart } = cartResponseSchema.parse(res.body);
    expect(cart.lines.map((l) => l.reason)).toEqual([
      'PRODUCT_SOLD_OUT',
      'PRODUCT_NOT_FOUND',
      'OPTIONS_INVALID',
      'OPTIONS_INVALID',
      'OPTIONS_INVALID',
      null,
    ]);
    expect(cart).toMatchObject({ subtotalMinor: 220000, itemCount: 1, meetsMinimum: false });
  });

  it('valida la entrada: cantidad, ids y tope técnico', async () => {
    const guest = new Browser(api);
    for (const quantity of [0, -1, 1.5, 1000]) {
      const res = await guest.post('/api/cart/quote', {
        locale: 'es-CR',
        lines: [{ productId: ids.chicha, quantity }],
      });
      expect(res.status, String(quantity)).toBe(400);
    }
    const bad = await guest.post('/api/cart/quote', {
      locale: 'es-CR',
      lines: [{ productId: 'no-uuid', quantity: 1 }],
    });
    expect(bad.status).toBe(400);
  });

  it('exige el token CSRF también al invitado (§8.3)', async () => {
    const guest = new Browser(api);
    const res = await guest.agent
      .post('/api/cart/quote')
      .set('x-test-ip', guest.ip)
      .set('Origin', 'http://web.test')
      .send({ locale: 'es-CR', lines: [] });
    expect(res.status).toBe(403);
    expect(errorCode(res.body)).toBe('CSRF_FAILED');
  });
});

// ─── Carrito de la cuenta y regla C5 ────────────────────────────────────────

describe('carrito de la cuenta (C5)', () => {
  it('sin sesión: 401', async () => {
    const guest = new Browser(api);
    expect((await guest.get('/api/cart')).status).toBe(401);
    expect((await setLine(guest, { productId: ids.chicha, quantity: 1 })).status).toBe(401);
  });

  it('reparte el total en líneas internas de hasta 20 y lo muestra como un único producto', async () => {
    const { browser, userId } = await verifiedCustomer();
    const steps: [number, 'add' | 'set', number, number[]][] = [
      [15, 'add', 15, [15]],
      [10, 'add', 25, [20, 5]],
      [30, 'set', 30, [20, 10]],
      [47, 'set', 47, [20, 20, 7]],
      [41, 'set', 41, [20, 20, 1]],
      [40, 'set', 40, [20, 20]],
      [19, 'set', 19, [19]],
    ];
    for (const [quantity, mode, total, rows] of steps) {
      const res = await setLine(browser, { productId: ids.ceviche, optionIds: [ids.suave], quantity, mode });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const { cart } = cartResponseSchema.parse(res.body);
      expect(cart.lines).toHaveLength(1);
      expect(cart.lines[0]?.quantity).toBe(total);
      expect(await internalLines(userId)).toEqual(rows);
    }
    // Sin tope artificial de 20 en la edición (C5): 120 unidades se aceptan.
    await setLine(browser, { productId: ids.ceviche, optionIds: [ids.suave], quantity: 120 });
    expect(await internalLines(userId)).toEqual([20, 20, 20, 20, 20, 20]);
    const res = await setLine(browser, { productId: ids.ceviche, optionIds: [ids.suave], quantity: 0 });
    expect(cartResponseSchema.parse(res.body).cart.lines).toEqual([]);
    expect(await internalLines(userId)).toEqual([]);
  });

  it('las mismas opciones en otro orden suman sobre la misma línea; otras opciones son otra línea', async () => {
    const { browser } = await verifiedCustomer();
    await setLine(browser, {
      productId: ids.ceviche,
      optionIds: [ids.camote, ids.suave],
      quantity: 2,
      mode: 'add',
    });
    await setLine(browser, {
      productId: ids.ceviche,
      optionIds: [ids.suave, ids.camote],
      quantity: 3,
      mode: 'add',
    });
    const res = await setLine(browser, {
      productId: ids.ceviche,
      optionIds: [ids.rocoto],
      quantity: 1,
      mode: 'add',
    });
    const { cart } = cartResponseSchema.parse(res.body);
    expect(cart.lines.map((l) => l.quantity)).toEqual([5, 1]);
    const persisted = cartResponseSchema.parse((await browser.get('/api/cart?locale=es-CR')).body).cart;
    expect(persisted.lines.map((l) => [l.key, l.quantity])).toEqual(
      cart.lines.map((l) => [l.key, l.quantity]),
    );
  });

  it('rechaza platos u opciones que no se pueden pedir y el tope técnico, sin tocar el carrito', async () => {
    const { browser, userId } = await verifiedCustomer();
    const sold = await setLine(browser, { productId: ids.pulpoAgotado, quantity: 1 });
    expect(sold.status).toBe(409);
    expect(errorCode(sold.body)).toBe('ITEMS_UNAVAILABLE');
    const invalid = await setLine(browser, {
      productId: ids.ceviche,
      optionIds: [ids.otroPlatoOpcion],
      quantity: 1,
    });
    expect(errorCode(invalid.body)).toBe('ITEMS_UNAVAILABLE');
    const missing = await setLine(browser, { productId: ids.ceviche, quantity: 1 });
    expect(apiErrorBodySchema.parse(missing.body).error.details).toMatchObject({
      lines: [{ reason: 'OPTIONS_INVALID' }],
    });
    await setLine(browser, { productId: ids.chicha, quantity: 990 });
    const tooMany = await setLine(browser, { productId: ids.chicha, quantity: 10, mode: 'add' });
    expect(tooMany.status).toBe(422);
    expect(await internalLines(userId)).toHaveLength(50);
  });
});

// ─── Fusión ─────────────────────────────────────────────────────────────────

describe('POST /api/cart/merge (D3, C5)', () => {
  it('suma por identidad, reparte en bloques de 20 y devuelve lo que no entra con su motivo', async () => {
    const { browser, userId } = await verifiedCustomer();
    await setLine(browser, { productId: ids.ceviche, optionIds: [ids.suave], quantity: 20 });
    const mergeKey = randomUUID();
    const res = await browser.post('/api/cart/merge', {
      locale: 'es-CR',
      mergeKey,
      lines: [
        { productId: ids.ceviche, optionIds: [ids.suave], quantity: 3 },
        { productId: ids.ceviche, optionIds: [ids.suave], quantity: 2 },
        { productId: ids.pulpoAgotado, quantity: 1 },
        { productId: ids.chicha, quantity: 2 },
      ],
    });
    expect(res.status).toBe(200);
    const merged = cartMergeResponseSchema.parse(res.body);
    expect(merged.alreadyMerged).toBe(false);
    expect(merged.cart.lines.map((l) => l.quantity)).toEqual([25, 2]);
    expect(merged.unavailable).toEqual([
      {
        productId: ids.pulpoAgotado,
        optionIds: [],
        quantity: 1,
        reason: 'PRODUCT_SOLD_OUT',
        name: 'Pulpo anticuchero',
      },
    ]);
    expect(await internalLines(userId)).toEqual([20, 5, 2]);
    const cart = await api.db.cart.findUniqueOrThrow({ where: { userId } });
    expect(cart.lastMergeKey).toBe(mergeKey);

    // Reintento con la misma mergeKey: no vuelve a sumar.
    const again = cartMergeResponseSchema.parse(
      (
        await browser.post('/api/cart/merge', {
          locale: 'es-CR',
          mergeKey,
          lines: [{ productId: ids.chicha, quantity: 9 }],
        })
      ).body,
    );
    expect(again.alreadyMerged).toBe(true);
    expect(again.cart.lines.map((l) => l.quantity)).toEqual([25, 2]);
    expect(await internalLines(userId)).toEqual([20, 5, 2]);
  });

  it('47 unidades del invitado → 20 + 20 + 7', async () => {
    const { browser, userId } = await verifiedCustomer();
    await browser.post('/api/cart/merge', {
      locale: 'es-CR',
      mergeKey: randomUUID(),
      lines: [{ productId: ids.ceviche, optionIds: [ids.suave], quantity: 47 }],
    });
    expect(await internalLines(userId)).toEqual([20, 20, 7]);
  });

  it('A → B → A: una clave ya fusionada no vuelve a sumar aunque no sea la última (lastMergeKey sola no alcanza)', async () => {
    const { browser, userId } = await verifiedCustomer();
    const a = randomUUID();
    const b = randomUUID();
    const lines = [{ productId: ids.chicha, quantity: 3 }];
    for (const key of [a, b, a, b])
      await browser.post('/api/cart/merge', { locale: 'es-CR', mergeKey: key, lines });
    expect(await internalLines(userId)).toEqual([6]);
  });

  it('dos fusiones simultáneas con la misma clave suman una sola vez', async () => {
    const { browser, userId } = await verifiedCustomer();
    const body = { locale: 'es-CR', mergeKey: randomUUID(), lines: [{ productId: ids.chicha, quantity: 4 }] };
    const results = await Promise.all([1, 2, 3].map(() => browser.post('/api/cart/merge', body)));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(results.filter((r) => cartMergeResponseSchema.parse(r.body).alreadyMerged)).toHaveLength(2);
    expect(await internalLines(userId)).toEqual([4]);
  });

  it('la misma mergeKey en otra cuenta es otra fusión (la clave es por cuenta)', async () => {
    const one = await verifiedCustomer();
    const two = await verifiedCustomer();
    const body = { locale: 'es-CR', mergeKey: randomUUID(), lines: [{ productId: ids.chicha, quantity: 1 }] };
    await one.browser.post('/api/cart/merge', body);
    const second = cartMergeResponseSchema.parse((await two.browser.post('/api/cart/merge', body)).body);
    expect(second.alreadyMerged).toBe(false);
    expect(await internalLines(two.userId)).toEqual([1]);
  });

  it('respeta el tope técnico: lo que excede vuelve como QUANTITY_LIMIT, sin perderlo en silencio', async () => {
    const { browser, userId } = await verifiedCustomer();
    await setLine(browser, { productId: ids.chicha, quantity: 995 });
    const merged = cartMergeResponseSchema.parse(
      (
        await browser.post('/api/cart/merge', {
          locale: 'es-CR',
          mergeKey: randomUUID(),
          lines: [{ productId: ids.chicha, quantity: 7 }],
        })
      ).body,
    );
    expect(merged.cart.lines[0]?.quantity).toBe(999);
    expect(merged.unavailable).toEqual([
      expect.objectContaining({ reason: 'QUANTITY_LIMIT', quantity: 3, productId: ids.chicha }),
    ]);
    expect((await internalLines(userId)).reduce((a, b) => a + b, 0)).toBe(999);
  });
});

// ─── Direcciones y zonas ────────────────────────────────────────────────────

describe('direcciones y zonas de delivery', () => {
  const address = {
    label: 'Casa',
    line1: 'Avenida 9, casa 33',
    district: 'san pedro',
    canton: 'Montes de Oca',
    province: 'San José',
    reference: 'Portón negro',
  };

  it('zonas públicas con tarifa y ETA de la semilla', async () => {
    const res = await new Browser(api).get('/api/public/delivery-zones').expect(200);
    const body = res.body as { zones: { name: string; feeMinor: number; districts: string[] }[] };
    expect(body.zones[0]).toMatchObject({ feeMinor: 120000, districts: ['Carmen', 'San Pedro'] });
  });

  it('alta en un distrito cubierto (normaliza el nombre) y rechazo fuera de las zonas', async () => {
    const { browser } = await verifiedCustomer();
    const created = await browser.post('/api/account/addresses', address);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      address: { district: 'San Pedro', isDefault: true, deliveryZone: { feeMinor: 120000, etaMinutes: 30 } },
    });
    const outside = await browser.post('/api/account/addresses', { ...address, district: 'Heredia' });
    expect(outside.status).toBe(422);
    expect(apiErrorBodySchema.parse(outside.body).error.fields).toEqual({ district: 'districtNotCovered' });
    const list = await browser.get('/api/account/addresses').expect(200);
    expect((list.body as { addresses: unknown[] }).addresses).toHaveLength(1);
  });

  it('IDOR: borrar la dirección de otra cuenta responde 404 y no la borra', async () => {
    const owner = await verifiedCustomer();
    const other = await verifiedCustomer();
    const id = (
      (await owner.browser.post('/api/account/addresses', address)).body as { address: { id: string } }
    ).address.id;
    expect((await other.browser.delete(`/api/account/addresses/${id}`)).status).toBe(404);
    expect((await other.browser.delete('/api/account/addresses/no-es-uuid')).status).toBe(404);
    expect(await api.db.address.count({ where: { id } })).toBe(1);
    expect((await owner.browser.delete(`/api/account/addresses/${id}`)).status).toBe(204);
  });
});

// ─── Checkout y pedidos ─────────────────────────────────────────────────────

describe('POST /api/checkout/quote', () => {
  it('retiro: IVA 13 % incluido, sin envío y con huella de la cotización', async () => {
    const { browser } = await verifiedCustomer();
    await fillCart(browser);
    const q = await quote(browser);
    const subtotal = 25 * 890000 + 220000;
    expect(q.problems).toEqual([]);
    expect(q.totals).toMatchObject({
      subtotalMinor: subtotal,
      deliveryFeeMinor: 0,
      taxLines: [{ name: 'IVA', rateBps: 1300, inclusive: true, taxableBaseMinor: subtotal }],
      taxTotalMinor: divideHalfUp(subtotal * 1300, 11300),
      totalMinor: subtotal,
    });
    expect(q).toMatchObject({ openNow: true, orderingAllowed: true, deliveryZone: null });
    expect(q.quoteVersion).toMatch(/^[\w-]{32}$/);
  });

  it('informa los problemas: carrito vacío, mínimo, dirección faltante y horario', async () => {
    const { browser } = await verifiedCustomer();
    expect((await quote(browser)).problems).toEqual(['CART_EMPTY']);
    await setLine(browser, { productId: ids.chicha, quantity: 1 });
    expect((await quote(browser)).problems).toEqual(['MIN_ORDER_NOT_MET']);
    expect((await quote(browser, { fulfillmentType: 'DELIVERY' })).problems).toEqual([
      'ADDRESS_REQUIRED',
      'MIN_ORDER_NOT_MET',
    ]);
    api.clock.set(CLOSED);
    const closed = await quote(browser);
    expect(closed).toMatchObject({ openNow: false, orderingAllowed: false });
    expect(closed.problems).toContain('OUTSIDE_OPENING_HOURS');
  });

  it('el pedido mínimo se mide sobre el subtotal de productos, sin el envío (D-M5-4)', async () => {
    const { browser } = await verifiedCustomer();
    // ₡4 400 de productos + ₡1 200 de envío = ₡5 600, pero el subtotal no llega a ₡5 000.
    await setLine(browser, { productId: ids.chicha, quantity: 2 });
    const id = (
      (
        await browser.post('/api/account/addresses', {
          label: 'Casa',
          line1: 'Calle 1',
          district: 'Carmen',
          canton: 'San José',
          province: 'San José',
          reference: 'Frente al parque',
        })
      ).body as { address: { id: string } }
    ).address.id;
    const q = await quote(browser, { fulfillmentType: 'DELIVERY', addressId: id });
    expect(q.totals.totalMinor).toBe(560000);
    expect(q.problems).toEqual(['MIN_ORDER_NOT_MET']);
    await setLine(browser, { productId: ids.chicha, quantity: 3 });
    expect((await quote(browser, { fulfillmentType: 'DELIVERY', addressId: id })).problems).toEqual([]);
  });
});

describe('POST /api/orders', () => {
  it('sin sesión 401, sin verificar 403 EMAIL_NOT_VERIFIED; la identidad nunca sale del cuerpo', async () => {
    const guest = new Browser(api);
    expect((await order(guest, { quoteVersion: 'x' })).status).toBe(401);
    const { email } = await registerUser(api, { verify: false });
    const unverified = await signIn(api, email);
    const res = await order(unverified, { quoteVersion: 'x', userId: randomUUID() });
    expect(res.status).toBe(403);
    expect(errorCode(res.body)).toBe('EMAIL_NOT_VERIFIED');
  });

  it('exige una Idempotency-Key UUID', async () => {
    const { browser } = await verifiedCustomer();
    const res = await browser.post('/api/orders', {
      locale: 'es-CR',
      fulfillmentType: 'PICKUP',
      quoteVersion: 'x',
    });
    expect(res.status).toBe(400);
    expect(apiErrorBodySchema.parse(res.body).error.fields).toEqual({ idempotencyKey: 'required' });
    const bad = await order(browser, { quoteVersion: 'x' }, 'no-uuid');
    expect(apiErrorBodySchema.parse(bad.body).error.fields).toEqual({ idempotencyKey: 'invalid' });
  });

  it('crea el pedido en PENDING_PAYMENT con su pago en REQUIRES_PAYMENT, copia histórica y carrito vacío', async () => {
    const { browser, userId } = await verifiedCustomer('en');
    await setLine(browser, { productId: ids.ceviche, optionIds: [ids.rocoto, ids.camote], quantity: 25 });
    const q = await quote(browser, { locale: 'en' });
    const res = await order(browser, {
      locale: 'en',
      quoteVersion: q.quoteVersion,
      customerNote: 'Sin cebolla',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const { order: created, duplicate } = orderResponseSchema.parse(res.body);
    expect(duplicate).toBe(false);
    expect(created).toMatchObject({
      status: 'PENDING_PAYMENT',
      payment: { status: 'REQUIRES_PAYMENT' },
      fulfillmentType: 'PICKUP',
      orderLocale: 'en',
      customerNote: 'Sin cebolla',
      totals: q.totals,
    });
    expect(created.code).toMatch(/^MB-[A-Z2-9]{6}$/);
    // Un único producto con el total, aunque se guarde en dos líneas internas (C5).
    expect(created.items).toEqual([
      expect.objectContaining({ quantity: 25, unitPriceMinor: 890000 + 60000 + 50000 }),
    ]);

    const row = await api.db.order.findUniqueOrThrow({
      where: { id: created.id },
      include: { items: { include: { options: true } }, taxLines: true, payment: true, statusHistory: true },
    });
    expect(row.userId).toBe(userId);
    expect(row.items.map((i) => i.quantity).sort((a, b) => b - a)).toEqual([20, 5]);
    expect(row.items.every((i) => i.unitPriceMinor === 890000 && i.optionsTotalMinor === 110000)).toBe(true);
    expect(row.items[0]?.options.map((o) => [o.groupLabelEsCr, o.labelEsCr, o.label]).sort()).toEqual(
      [
        ['Extras', 'Camote glaseado', 'Glazed sweet potato'],
        ['Punto del picante', 'Rocoto, para valientes', 'Rocoto, for the brave'],
      ].sort(),
    );
    expect(row.taxLines).toEqual([expect.objectContaining({ name: 'IVA', rateBps: 1300, inclusive: true })]);
    expect(row.payment).toMatchObject({
      status: 'REQUIRES_PAYMENT',
      method: 'DEMO_CARD',
      amountAuthorizedMinor: 0,
      amountCapturedMinor: 0,
    });
    expect(row.statusHistory).toEqual([
      expect.objectContaining({ fromStatus: null, toStatus: 'PENDING_PAYMENT' }),
    ]);
    expect(row.expiresAt?.getTime()).toBe(OPEN.getTime() + 30 * 60 * 1000);
    expect(await internalLines(userId)).toEqual([]);
  });

  it('idempotencia: misma clave y cuerpo → la respuesta original; otro cuerpo → 422', async () => {
    const { browser, userId } = await verifiedCustomer();
    await fillCart(browser);
    const q = await quote(browser);
    const key = randomUUID();
    const first = await order(browser, { quoteVersion: q.quoteVersion }, key);
    const second = await order(browser, { quoteVersion: q.quoteVersion }, key);
    expect([first.status, second.status]).toEqual([201, 201]);
    expect(second.body).toEqual(first.body);
    const changed = await order(browser, { quoteVersion: q.quoteVersion, customerNote: 'otra' }, key);
    expect(changed.status).toBe(422);
    expect(errorCode(changed.body)).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await api.db.order.count({ where: { userId } })).toBe(1);
  });

  it('concurrencia con la misma clave: un solo pedido; las demás reciben 409 en curso o la respuesta original', async () => {
    const { browser, userId } = await verifiedCustomer();
    await fillCart(browser);
    const q = await quote(browser);
    const key = randomUUID();
    const results = await Promise.all(
      [1, 2, 3, 4].map(() => order(browser, { quoteVersion: q.quoteVersion }, key)),
    );
    for (const r of results) {
      expect([201, 409]).toContain(r.status);
      if (r.status === 409) expect(errorCode(r.body)).toBe('IDEMPOTENCY_IN_PROGRESS');
    }
    expect(results.some((r) => r.status === 201)).toBe(true);
    expect(await api.db.order.count({ where: { userId } })).toBe(1);
  });

  it('doble clic con otra clave y el mismo carrito en menos de 60 s → el pedido existente', async () => {
    const { browser, userId } = await verifiedCustomer();
    await fillCart(browser);
    const q = await quote(browser);
    const results = await Promise.all([
      order(browser, { quoteVersion: q.quoteVersion }),
      order(browser, { quoteVersion: q.quoteVersion }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
    const bodies = results.map((r) => orderResponseSchema.parse(r.body));
    expect(bodies[0]?.order.id).toBe(bodies[1]?.order.id);
    expect(bodies.filter((b) => b.duplicate)).toHaveLength(1);
    // Pasado el minuto ya no es un duplicado: el carrito quedó vacío al crear el pedido.
    api.clock.advance(61_000);
    const late = await order(browser, { quoteVersion: q.quoteVersion });
    expect(errorCode(late.body)).toBe('CART_EMPTY');
    expect(await api.db.order.count({ where: { userId } })).toBe(1);
  });

  it('cambio de precio (D-M5-2): 409 PRICE_CHANGED con los importes nuevos; con la nueva confirmación, se crea', async () => {
    const { browser, userId } = await verifiedCustomer();
    await fillCart(browser);
    const before = await quote(browser);
    await withProduct(ids.chicha, { basePriceMinor: 260000 }, async () => {
      const res = await order(browser, { quoteVersion: before.quoteVersion });
      expect(res.status).toBe(409);
      const error = apiErrorBodySchema.parse(res.body).error;
      expect(error.code).toBe('PRICE_CHANGED');
      const fresh = checkoutQuoteSchema.parse(error.details?.['quote']);
      expect(fresh.totals.totalMinor).toBe(before.totals.totalMinor + 40000);
      expect(await api.db.order.count({ where: { userId } })).toBe(0);
      const ok = await order(browser, { quoteVersion: fresh.quoteVersion });
      expect(ok.status).toBe(201);
      expect(orderResponseSchema.parse(ok.body).order.totals.totalMinor).toBe(fresh.totals.totalMinor);
    });
  });

  it('una opción o un plato que se agota durante el checkout: 409 ITEMS_UNAVAILABLE y sin pedido', async () => {
    const { browser, userId } = await verifiedCustomer();
    await fillCart(browser);
    const q = await quote(browser);
    await withProduct(ids.ceviche, { isAvailable: false }, async () => {
      const res = await order(browser, { quoteVersion: q.quoteVersion });
      expect(res.status).toBe(409);
      expect(apiErrorBodySchema.parse(res.body).error).toMatchObject({
        code: 'ITEMS_UNAVAILABLE',
        details: { lines: [expect.objectContaining({ productId: ids.ceviche, reason: 'PRODUCT_SOLD_OUT' })] },
      });
    });
    expect(await api.db.order.count({ where: { userId } })).toBe(0);
    // El carrito se conserva para corregirlo.
    expect(await internalLines(userId)).toEqual([20, 5, 1]);
  });

  it('pedido mínimo: 422 MIN_ORDER_NOT_MET', async () => {
    const { browser } = await verifiedCustomer();
    await setLine(browser, { productId: ids.chicha, quantity: 1 });
    const q = await quote(browser);
    const res = await order(browser, { quoteVersion: q.quoteVersion });
    expect(res.status).toBe(422);
    expect(apiErrorBodySchema.parse(res.body).error).toMatchObject({
      code: 'MIN_ORDER_NOT_MET',
      details: { minOrderMinor: 500000, subtotalMinor: 220000 },
    });
  });

  it('fuera de horario: 409 OUTSIDE_OPENING_HOURS; solo el modo de demostración de la API lo permite', async () => {
    const { browser, userId } = await verifiedCustomer();
    await fillCart(browser);
    api.clock.set(CLOSED);
    const q = await quote(browser);
    const res = await order(browser, { quoteVersion: q.quoteVersion });
    expect(res.status).toBe(409);
    expect(errorCode(res.body)).toBe('OUTSIDE_OPENING_HOURS');
    expect(await api.db.order.count({ where: { userId } })).toBe(0);

    const demo = buildApi({ config: { ordersAllowOutsideHours: true } });
    try {
      demo.clock.set(CLOSED);
      const { email } = await registerUser(demo, { verify: true });
      const other = await signIn(demo, email);
      await fillCart(other);
      const res2 = await other.post('/api/checkout/quote', { locale: 'es-CR', fulfillmentType: 'PICKUP' });
      const dq = checkoutQuoteSchema.parse(res2.body);
      expect(dq).toMatchObject({ openNow: false, orderingAllowed: true, problems: [] });
      const created = await other.post(
        '/api/orders',
        { locale: 'es-CR', fulfillmentType: 'PICKUP', quoteVersion: dq.quoteVersion },
        { 'Idempotency-Key': randomUUID() },
      );
      expect(created.status).toBe(201);
    } finally {
      await demo.close();
    }
  });

  it('delivery: tarifa y zona del servidor, dirección copiada, teléfono obligatorio; los montos del cliente se ignoran', async () => {
    const { browser } = await verifiedCustomer();
    await fillCart(browser);
    const address = (
      (
        await browser.post('/api/account/addresses', {
          label: 'Oficina',
          line1: 'Calle 33',
          district: 'Sabanilla',
          canton: 'Montes de Oca',
          province: 'San José',
          reference: 'Edificio azul',
        })
      ).body as { address: { id: string } }
    ).address;
    const q = await quote(browser, { fulfillmentType: 'DELIVERY', addressId: address.id });
    expect(q.deliveryZone).toMatchObject({ feeMinor: 180000, etaMinutes: 40 });
    const items = 25 * 890000 + 220000;
    expect(q.totals).toMatchObject({
      deliveryFeeMinor: 180000,
      totalMinor: items + 180000,
      taxLines: [expect.objectContaining({ taxableBaseMinor: items + 180000 })],
    });
    const noPhone = await order(browser, {
      fulfillmentType: 'DELIVERY',
      addressId: address.id,
      contactPhone: '',
      quoteVersion: q.quoteVersion,
    });
    expect(noPhone.status).toBe(400);
    expect(apiErrorBodySchema.parse(noPhone.body).error.fields).toEqual({ contactPhone: 'required' });
    const res = await order(browser, {
      fulfillmentType: 'DELIVERY',
      addressId: address.id,
      quoteVersion: q.quoteVersion,
      deliveryFeeMinor: 0,
      totalMinor: 1,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const created = orderResponseSchema.parse(res.body).order;
    expect(created.totals.deliveryFeeMinor).toBe(180000);
    expect(created.totals.totalMinor).toBe(items + 180000);
    expect(created.deliveryZone).toMatchObject({ etaMinutes: 40 });
    expect(created.deliveryAddress).toMatchObject({ district: 'Sabanilla', reference: 'Edificio azul' });
  });

  it('delivery con la dirección de otra cuenta: 404, sin pedido', async () => {
    const owner = await verifiedCustomer();
    const thief = await verifiedCustomer();
    const id = (
      (
        await owner.browser.post('/api/account/addresses', {
          label: 'Casa',
          line1: 'Calle 1',
          district: 'Carmen',
          canton: 'San José',
          province: 'San José',
          reference: 'Casa amarilla',
        })
      ).body as { address: { id: string } }
    ).address.id;
    await fillCart(thief.browser);
    const res = await thief.browser.post('/api/checkout/quote', {
      locale: 'es-CR',
      fulfillmentType: 'DELIVERY',
      addressId: id,
    });
    expect(res.status).toBe(404);
    const created = await order(thief.browser, {
      fulfillmentType: 'DELIVERY',
      addressId: id,
      quoteVersion: 'x',
    });
    expect(created.status).toBe(404);
  });

  it('modalidad deshabilitada en la configuración: 409 FULFILLMENT_UNAVAILABLE', async () => {
    const { browser } = await verifiedCustomer();
    await fillCart(browser);
    const q = await quote(browser);
    await api.db.restaurantSettings.update({ where: { id: 1 }, data: { pickupEnabled: false } });
    try {
      const res = await order(browser, { quoteVersion: q.quoteVersion });
      expect(res.status).toBe(409);
      expect(errorCode(res.body)).toBe('FULFILLMENT_UNAVAILABLE');
    } finally {
      await api.db.restaurantSettings.update({ where: { id: 1 }, data: { pickupEnabled: true } });
    }
  });

  it('rechaza DINE_IN y cualquier otra modalidad (D4, C10)', async () => {
    const { browser } = await verifiedCustomer();
    const res = await order(browser, { fulfillmentType: 'DINE_IN', quoteVersion: 'x' });
    expect(res.status).toBe(400);
    expect(apiErrorBodySchema.parse(res.body).error.fields).toHaveProperty('fulfillmentType');
  });

  it('CSRF: sin token o desde otro origen, 403 y sin pedido', async () => {
    const { browser, userId } = await verifiedCustomer();
    await fillCart(browser);
    const noToken = await browser.agent
      .post('/api/orders')
      .set('x-test-ip', browser.ip)
      .set('Origin', 'http://web.test')
      .set('Idempotency-Key', randomUUID())
      .send({ locale: 'es-CR', fulfillmentType: 'PICKUP', quoteVersion: 'x' });
    expect(noToken.status).toBe(403);
    const foreign = await browser.agent
      .post('/api/orders')
      .set('x-test-ip', browser.ip)
      .set('Origin', 'https://evil.example')
      .set('X-CSRF-Token', browser.csrf)
      .set('Idempotency-Key', randomUUID())
      .send({ locale: 'es-CR', fulfillmentType: 'PICKUP', quoteVersion: 'x' });
    expect(foreign.status).toBe(403);
    expect(await api.db.order.count({ where: { userId } })).toBe(0);
  });

  it('límite por cuenta: después de 20 intentos en una hora, 429 con Retry-After', async () => {
    const { browser } = await verifiedCustomer();
    for (let i = 0; i < 20; i += 1) {
      expect((await order(browser, { quoteVersion: '' })).status).toBe(400);
    }
    const limited = await order(browser, { quoteVersion: '' });
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
  });
});

describe('GET /api/orders/:id (IDOR, R-SEC-06)', () => {
  it('el dueño lo ve; otra cuenta, un id inexistente o mal formado → 404 sin diferencias', async () => {
    const owner = await verifiedCustomer();
    await fillCart(owner.browser);
    const q = await quote(owner.browser);
    const created = orderResponseSchema.parse(
      (await order(owner.browser, { quoteVersion: q.quoteVersion })).body,
    ).order;
    const mine = await owner.browser.get(`/api/orders/${created.id}`).expect(200);
    expect(orderResponseSchema.shape.order.parse((mine.body as { order: unknown }).order).id).toBe(
      created.id,
    );

    const other = await verifiedCustomer();
    const foreign = await other.browser.get(`/api/orders/${created.id}`);
    const missing = await other.browser.get(`/api/orders/${randomUUID()}`);
    const malformed = await other.browser.get('/api/orders/123');
    for (const res of [foreign, missing, malformed]) {
      expect(res.status).toBe(404);
      expect(errorCode(res.body)).toBe('NOT_FOUND');
    }
    expect((await new Browser(api).get(`/api/orders/${created.id}`)).status).toBe(401);
  });
});
