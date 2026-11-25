/**
 * M8 · Admin contra PostgreSQL real (§3.6, §6.2, §8.4, §8.6, §11, D2, D5, D8): RBAC (todo solo
 * ADMIN, D-M8-3), CSRF, dashboard con datos reales, carta con traducciones y versión optimista,
 * pesca del día, clientes (bloqueo y roles, sin dejar el local sin admin), configuración, impuestos,
 * zonas, umbral de Turnstile, asistente de moneda, auditoría de solo lectura, pedidos y límites.
 *
 * Este archivo cambia la configuración global de la base de prueba: guarda el estado inicial y lo
 * restaura al final, para que los archivos siguientes vean la semilla intacta.
 */
import {
  adminAuditResponseSchema,
  adminCatchResponseSchema,
  adminCustomerResponseSchema,
  adminCustomersResponseSchema,
  adminDashboardResponseSchema,
  adminMenuResponseSchema,
  adminOrderDetailResponseSchema,
  adminOrdersResponseSchema,
  adminProductResponseSchema,
  adminSettingsResponseSchema,
  apiErrorBodySchema,
  catalogResponseSchema,
  catchBoardResponseSchema,
  type AdminProduct,
  type AdminSettings,
  type AdminProductUpdateRequest,
} from '@marea-baja/shared';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../src/http/errors.ts';
import { CustomersAdminService } from '../src/modules/admin/customers.ts';
import { setUserRoles } from '../src/modules/users/roles.ts';
import { localDateOf } from '../src/modules/admin/time.ts';
import { MINUTE } from '../src/lib/clock.ts';
import { Browser, PASSWORD, buildApi, registerUser, signIn, type TestApi } from './http.ts';

let api: TestApi;
let admin: Browser;
let adminId: string;
let staff: Browser;
let customer: Browser;
let customerEmail: string;

const error = (body: unknown) => apiErrorBodySchema.parse(body).error;

async function userWithRoles(roles: ('CUSTOMER' | 'STAFF' | 'ADMIN')[], name = 'Persona Prueba') {
  const { email } = await registerUser(api, { verify: true, name });
  if (roles.some((r) => r !== 'CUSTOMER')) {
    await setUserRoles(api.db, { email, roles, actor: null, reason: 'prueba M8' });
  }
  const browser = await signIn(api, email);
  const user = await api.db.user.findFirstOrThrow({ where: { email }, select: { id: true } });
  return { email, browser, id: user.id };
}

// Estado de la semilla que este archivo cambia y restaura.
let snapshot: {
  settings: Awaited<ReturnType<TestApi['db']['restaurantSettings']['findUniqueOrThrow']>>;
  hours: { dayOfWeek: number; opensMinutes: number; closesMinutes: number }[];
  products: { id: string; basePriceMinor: number }[];
  options: { id: string; priceDeltaMinor: number }[];
  zones: { id: string; feeMinor: number; name: string; isActive: boolean }[];
  taxes: { id: string; rateBps: number; name: string; isActive: boolean }[];
  catches: {
    date: Date;
    publishedAt: Date | null;
    items: { species: string; port: string; arrivedAt: Date; sortOrder: number }[];
  }[];
};

beforeAll(async () => {
  api = buildApi();
  snapshot = {
    settings: await api.db.restaurantSettings.findUniqueOrThrow({ where: { id: 1 } }),
    hours: await api.db.openingHours.findMany({
      select: { dayOfWeek: true, opensMinutes: true, closesMinutes: true },
    }),
    products: await api.db.product.findMany({ select: { id: true, basePriceMinor: true } }),
    options: await api.db.productOption.findMany({ select: { id: true, priceDeltaMinor: true } }),
    zones: await api.db.deliveryZone.findMany({
      select: { id: true, feeMinor: true, name: true, isActive: true },
    }),
    taxes: await api.db.taxRate.findMany({ select: { id: true, rateBps: true, name: true, isActive: true } }),
    catches: await api.db.catchOfTheDay.findMany({
      select: {
        date: true,
        publishedAt: true,
        items: { select: { species: true, port: true, arrivedAt: true, sortOrder: true } },
      },
    }),
  };
  const a = await userWithRoles(['ADMIN'], 'Ada Admin');
  admin = a.browser;
  adminId = a.id;
  staff = (await userWithRoles(['STAFF'], 'Sol Staff')).browser;
  const c = await userWithRoles(['CUSTOMER'], 'Carla Cliente');
  customer = c.browser;
  customerEmail = c.email;
});

afterAll(async () => {
  const { id: _id, updatedAt: _u, ...settings } = snapshot.settings;
  await api.db.restaurantSettings.update({ where: { id: 1 }, data: settings });
  await api.db.openingHours.deleteMany({ where: { settingsId: 1 } });
  await api.db.openingHours.createMany({ data: snapshot.hours.map((h) => ({ settingsId: 1, ...h })) });
  for (const p of snapshot.products) {
    await api.db.product.update({ where: { id: p.id }, data: { basePriceMinor: p.basePriceMinor } });
  }
  for (const o of snapshot.options) {
    await api.db.productOption.update({ where: { id: o.id }, data: { priceDeltaMinor: o.priceDeltaMinor } });
  }
  for (const z of snapshot.zones) {
    await api.db.deliveryZone.update({
      where: { id: z.id },
      data: { feeMinor: z.feeMinor, name: z.name, isActive: z.isActive },
    });
  }
  for (const t of snapshot.taxes) {
    await api.db.taxRate.update({
      where: { id: t.id },
      data: { rateBps: t.rateBps, name: t.name, isActive: t.isActive },
    });
  }
  // Los platos creados por este archivo y la pizarra de la semilla.
  await api.db.product.deleteMany({ where: { slug: { startsWith: 'plato-m8-' } } });
  await api.db.catchOfTheDay.deleteMany({});
  for (const board of snapshot.catches) {
    await api.db.catchOfTheDay.create({
      data: { date: board.date, publishedAt: board.publishedAt, items: { create: board.items } },
    });
  }
  await api.close();
});

// El límite de §8.4 (30 cambios / 10 min por usuario) es real también aquí: el admin de este
// archivo hace muchos cambios, así que cada prueba empieza en una ventana nueva del limitador.
// No se relaja el límite; su propia prueba está al final.
beforeEach(() => {
  api.clock.advance(11 * MINUTE);
});

const ADMIN_READS = [
  '/api/admin/dashboard',
  '/api/admin/menu',
  '/api/admin/catch',
  '/api/admin/customers',
  '/api/admin/settings',
  '/api/admin/audit',
  '/api/admin/orders',
];

describe('RBAC y CSRF (D-M8-3, §8.3, §8.7)', () => {
  it('las lecturas del admin exigen sesión (401) y rol ADMIN (403 para cliente y staff)', async () => {
    const anonymous = new Browser(api);
    for (const path of ADMIN_READS) {
      expect((await anonymous.get(path)).status, path).toBe(401);
      expect(error((await customer.get(path)).body).code, path).toBe('FORBIDDEN');
      expect((await staff.get(path)).status, path).toBe(403);
      expect((await admin.get(path)).status, path).toBe(200);
    }
    // El Pase de M7 sigue abierto para staff.
    expect((await staff.get('/api/admin/pass')).status).toBe(200);
  });

  it('las escrituras exigen rol y token CSRF', async () => {
    const menu = adminMenuResponseSchema.parse((await admin.get('/api/admin/menu')).body);
    const product = menu.categories[0]?.products[0];
    if (!product) throw new Error('sin platos');
    const body = editable(product);
    expect((await staff.put(`/api/admin/products/${product.id}`, body)).status).toBe(403);
    const noCsrf = await admin.agent
      .put(`/api/admin/products/${product.id}`)
      .set('x-test-ip', admin.ip)
      .set('Origin', 'http://web.test')
      .send(body);
    expect(noCsrf.status).toBe(403);
    expect(error(noCsrf.body).code).toBe('CSRF_FAILED');
  });
});

function editable(product: AdminProduct): AdminProductUpdateRequest {
  return {
    updatedAt: product.updatedAt,
    categoryId: product.categoryId,
    name: product.name,
    description: product.description,
    basePriceMinor: product.basePriceMinor,
    tags: product.tags,
    isActive: product.isActive,
    isAvailable: product.isAvailable,
    sortOrder: product.sortOrder,
    en: {
      name: product.en.name,
      description: product.en.description ?? 'Description',
      altText: product.en.altText,
    },
    imageAlt: product.image?.alt ?? null,
  };
}

async function productBySlug(slug: string): Promise<AdminProduct> {
  const menu = adminMenuResponseSchema.parse((await admin.get('/api/admin/menu')).body);
  const found = menu.categories.flatMap((c) => c.products).find((p) => p.slug === slug);
  if (!found) throw new Error(`sin ${slug}`);
  return found;
}

async function publicProduct(slug: string, locale: 'es-CR' | 'en' = 'es-CR') {
  const catalog = catalogResponseSchema.parse(
    (await new Browser(api).get(`/api/public/catalog?locale=${locale}`)).body,
  );
  return catalog.categories.flatMap((c) => c.products).find((p) => p.slug === slug);
}

async function auditFor(entityId: string, action?: string) {
  return api.db.auditLog.findMany({
    where: { entityId, ...(action ? { action } : {}) },
    orderBy: { createdAt: 'asc' },
  });
}

describe('carta con traducciones (§3.6, §8.6, D2)', () => {
  it('cambia el precio, la disponibilidad y el inglés: la carta pública lo refleja y el AuditLog lo registra', async () => {
    const product = await productBySlug('ceviche-clasico');
    const versionBefore = (await new Browser(api).get('/api/public/catalog-version')).body as {
      version: string;
    };
    const res = await admin.put(`/api/admin/products/${product.id}`, {
      ...editable(product),
      basePriceMinor: product.basePriceMinor + 50000,
      isAvailable: false,
      en: { name: null, description: 'Classic ceviche, edited by the admin.', altText: product.en.altText },
    });
    expect(res.status).toBe(200);
    const updated = adminProductResponseSchema.parse(res.body).product;
    expect(updated.basePriceMinor).toBe(product.basePriceMinor + 50000);
    expect(updated.updatedAt).not.toBe(product.updatedAt);

    const live = await publicProduct('ceviche-clasico');
    expect(live?.basePriceMinor).toBe(product.basePriceMinor + 50000);
    expect(live?.isAvailable).toBe(false);
    const en = await publicProduct('ceviche-clasico', 'en');
    expect(en?.description).toEqual({ text: 'Classic ceviche, edited by the admin.', lang: 'en' });
    const versionAfter = (await new Browser(api).get('/api/public/catalog-version')).body as {
      version: string;
    };
    expect(versionAfter.version).not.toBe(versionBefore.version);

    const actions = (await auditFor(product.id)).map((e) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining(['product.price_changed', 'product.availability_changed', 'product.updated']),
    );
    const priceEntry = (await auditFor(product.id, 'product.price_changed'))[0];
    expect(priceEntry?.actorUserId).toBe(adminId);
    expect(priceEntry?.actorRole).toBe('ADMIN');
    expect(priceEntry?.before).toMatchObject({ basePriceMinor: product.basePriceMinor });
    expect(priceEntry?.after).toMatchObject({ basePriceMinor: product.basePriceMinor + 50000 });

    // Se restaura para los demás archivos.
    const restored = await admin.put(`/api/admin/products/${product.id}`, {
      ...editable(updated),
      basePriceMinor: product.basePriceMinor,
      isAvailable: true,
      en: editable(product).en,
    });
    expect(restored.status).toBe(200);
  });

  it('versión optimista: un updatedAt viejo responde 409 y no cambia nada', async () => {
    const product = await productBySlug('ceviche-nikkei');
    const first = await admin.put(`/api/admin/products/${product.id}`, {
      ...editable(product),
      sortOrder: product.sortOrder,
    });
    expect(first.status).toBe(200);
    const stale = await admin.put(`/api/admin/products/${product.id}`, {
      ...editable(product),
      name: 'Pisado',
    });
    expect(stale.status).toBe(409);
    expect(error(stale.body).code).toBe('RESOURCE_VERSION_CONFLICT');
    expect((await productBySlug('ceviche-nikkei')).name).toBe(product.name);
  });

  it('valida el precio contra el incremento de la moneda y el cuerpo estricto', async () => {
    const product = await productBySlug('ceviche-mixto');
    const odd = await admin.put(`/api/admin/products/${product.id}`, {
      ...editable(product),
      basePriceMinor: 890050,
    });
    expect(odd.status).toBe(400);
    expect(error(odd.body)).toMatchObject({
      code: 'PRICE_INCREMENT',
      fields: { basePriceMinor: 'increment' },
    });
    const extra = await admin.put(`/api/admin/products/${product.id}`, {
      ...editable(product),
      slug: 'otro',
    });
    expect(extra.status).toBe(400);
    const noEnglish = await admin.put(`/api/admin/products/${product.id}`, {
      ...editable(product),
      en: { name: null, description: '', altText: null },
    });
    expect(error(noEnglish.body).fields).toMatchObject({ 'en.description': 'required' });
  });

  it('crea un plato con su traducción; el slug repetido responde 409; desactivarlo lo saca de la carta', async () => {
    const menu = adminMenuResponseSchema.parse((await admin.get('/api/admin/menu')).body);
    const category = menu.categories[0];
    if (!category) throw new Error('sin categorías');
    const slug = `plato-m8-${randomUUID().slice(0, 6)}`;
    const body = {
      slug,
      categoryId: category.id,
      name: 'Tiradito de prueba',
      description: 'Plato creado por la prueba de M8.',
      basePriceMinor: 650000,
      tags: ['SPICY'],
      isActive: true,
      isAvailable: true,
      sortOrder: 99,
      en: { name: 'Test tiradito', description: 'Dish created by the M8 test.', altText: null },
      imageAlt: null,
    };
    const created = await admin.post('/api/admin/products', body);
    expect(created.status).toBe(201);
    const product = adminProductResponseSchema.parse(created.body).product;
    const englishLine = await publicProduct(slug, 'en');
    expect(englishLine?.translatedName).toBe('Test tiradito');
    expect(englishLine?.description).toEqual({ text: 'Dish created by the M8 test.', lang: 'en' });
    expect((await auditFor(product.id, 'product.created')).length).toBe(1);
    // Hereda las tasas como la semilla: el motor de precios lo cobra con IVA.
    expect(await api.db.productTaxRate.count({ where: { productId: product.id } })).toBe(
      await api.db.taxRate.count(),
    );

    const duplicate = await admin.post('/api/admin/products', body);
    expect(duplicate.status).toBe(409);
    expect(error(duplicate.body).code).toBe('SLUG_TAKEN');

    const off = await admin.put(`/api/admin/products/${product.id}`, {
      ...editable(product),
      isActive: false,
    });
    expect(off.status).toBe(200);
    expect(await publicProduct(slug)).toBeUndefined();
    expect((await auditFor(product.id, 'product.deactivated')).length).toBe(1);
  });

  it('categorías, grupos y opciones: traducción, recargo y disponibilidad con AuditLog', async () => {
    const menu = adminMenuResponseSchema.parse((await admin.get('/api/admin/menu')).body);
    const category = menu.categories.find((c) => c.slug === 'ceviches');
    if (!category) throw new Error('sin ceviches');
    const cat = await admin.put(`/api/admin/categories/${category.id}`, {
      updatedAt: category.updatedAt,
      name: category.name,
      description: category.description,
      sortOrder: category.sortOrder,
      isActive: true,
      en: { name: 'Ceviches (edited)', description: category.en.description },
    });
    expect(cat.status).toBe(200);
    const catalog = catalogResponseSchema.parse(
      (await new Browser(api).get('/api/public/catalog?locale=en')).body,
    );
    expect(catalog.categories.find((c) => c.slug === 'ceviches')?.name.text).toBe('Ceviches (edited)');
    expect((await auditFor(category.id, 'category.updated')).length).toBe(1);
    // Restaurar el nombre en inglés.
    const fresh = adminMenuResponseSchema
      .parse((await admin.get('/api/admin/menu')).body)
      .categories.find((c) => c.id === category.id);
    await admin.put(`/api/admin/categories/${category.id}`, {
      updatedAt: fresh?.updatedAt,
      name: category.name,
      description: category.description,
      sortOrder: category.sortOrder,
      isActive: true,
      en: { name: category.en.name ?? 'Ceviches', description: category.en.description },
    });

    const withOptions = menu.categories.flatMap((c) => c.products).find((p) => p.optionGroups.length > 0);
    const group = withOptions?.optionGroups[0];
    const option = group?.options[0];
    if (!withOptions || !group || !option) throw new Error('sin opciones');
    const opt = await admin.put(`/api/admin/options/${option.id}`, {
      name: option.name,
      enName: option.enName,
      priceDeltaMinor: option.priceDeltaMinor + 50000,
      isAvailable: option.isAvailable,
    });
    expect(opt.status).toBe(200);
    expect((await auditFor(option.id, 'option.price_changed')).length).toBe(1);
    const odd = await admin.put(`/api/admin/options/${option.id}`, {
      name: option.name,
      enName: option.enName,
      priceDeltaMinor: 12345,
      isAvailable: true,
    });
    expect(error(odd.body).code).toBe('PRICE_INCREMENT');
    const grp = await admin.put(`/api/admin/option-groups/${group.id}`, {
      name: group.name,
      enName: 'Heat level (edited)',
      isActive: group.isActive,
    });
    expect(grp.status).toBe(200);
    expect((await auditFor(group.id, 'option_group.updated')).length).toBe(1);
    await admin.put(`/api/admin/options/${option.id}`, {
      name: option.name,
      enName: option.enName,
      priceDeltaMinor: option.priceDeltaMinor,
      isAvailable: option.isAvailable,
    });
    await admin.put(`/api/admin/option-groups/${group.id}`, {
      name: group.name,
      enName: group.enName,
      isActive: group.isActive,
    });
  });
});

describe('pesca del día (§3.6, §8.6)', () => {
  it('guarda y publica la pizarra de hoy; la web pública la muestra; el pasado no se reescribe', async () => {
    const today = localDateOf(api.clock.now(), 'America/Costa_Rica');
    const draft = await admin.put('/api/admin/catch', {
      date: today,
      items: [{ species: 'Corvina reina', port: 'Puntarenas', arrivedAt: '06:40' }],
      publish: false,
    });
    expect(draft.status).toBe(200);
    const published = await admin.put('/api/admin/catch', {
      date: today,
      items: [
        { species: 'Corvina reina', port: 'Puntarenas', arrivedAt: '06:40' },
        { species: 'Pargo', port: 'Quepos', arrivedAt: '07:15' },
      ],
      publish: true,
    });
    expect(published.status).toBe(200);
    const boards = adminCatchResponseSchema.parse(published.body);
    expect(boards.boards[0]).toMatchObject({
      date: today,
      items: [{ arrivedAt: '06:40' }, { arrivedAt: '07:15' }],
    });
    const board = catchBoardResponseSchema.parse(
      (await new Browser(api).get('/api/public/catch-of-the-day')).body,
    );
    expect(board.board).toMatchObject({ date: today, isToday: true });
    expect(board.board?.items.map((i) => i.species)).toEqual(['Corvina reina', 'Pargo']);
    const entries = await api.db.auditLog.findMany({
      where: { entityType: 'catch' },
      orderBy: { createdAt: 'asc' },
    });
    expect(entries.map((e) => e.action)).toEqual(expect.arrayContaining(['catch.saved', 'catch.published']));

    const past = await admin.put('/api/admin/catch', {
      date: '2020-01-01',
      items: [{ species: 'Atún', port: 'Golfito', arrivedAt: '05:00' }],
      publish: true,
    });
    expect(past.status).toBe(400);
    const badTime = await admin.put('/api/admin/catch', {
      date: today,
      items: [{ species: 'Atún', port: 'Golfito', arrivedAt: '25:00' }],
      publish: true,
    });
    expect(badTime.status).toBe(400);
  });
});

describe('clientes: bloqueo y roles (§8.6)', () => {
  it('busca, bloquea (revoca sesiones y rechaza el login) y desbloquea con motivo y AuditLog', async () => {
    const list = adminCustomersResponseSchema.parse(
      (await admin.get(`/api/admin/customers?q=${encodeURIComponent(customerEmail)}`)).body,
    );
    expect(list.customers).toHaveLength(1);
    const target = list.customers[0];
    if (!target) throw new Error('sin cliente');
    expect(target).toMatchObject({ email: customerEmail, roles: ['CUSTOMER'], blocked: false });

    const noReason = await admin.patch(`/api/admin/customers/${target.id}`, { blocked: true });
    expect(noReason.status).toBe(400);
    const blocked = await admin.patch(`/api/admin/customers/${target.id}`, {
      blocked: true,
      reason: 'Pruebas de abuso',
    });
    expect(blocked.status).toBe(200);
    expect(adminCustomerResponseSchema.parse(blocked.body).customer.blocked).toBe(true);
    // La sesión abierta del cliente deja de servir y el login responde 403.
    expect((await customer.get('/api/auth/me')).status).toBe(401);
    const login = await new Browser(api).post('/api/auth/login', {
      email: customerEmail,
      password: PASSWORD,
    });
    expect(error(login.body).code).toBe('ACCOUNT_BLOCKED');

    const unblocked = await admin.patch(`/api/admin/customers/${target.id}`, {
      blocked: false,
      reason: 'Revisado',
    });
    expect(adminCustomerResponseSchema.parse(unblocked.body).customer.blocked).toBe(false);
    customer = await signIn(api, customerEmail);
    const actions = (await auditFor(target.id)).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['user.blocked', 'user.unblocked']));
    const entry = (await auditFor(target.id, 'user.blocked'))[0];
    expect(entry?.reason).toBe('Pruebas de abuso');
    // El correo se enmascara en el AuditLog (§8.6).
    expect(JSON.stringify(entry?.after)).not.toContain(customerEmail);
  });

  it('cambia roles; nadie se cambia a sí mismo y siempre queda un admin, también en carrera', async () => {
    const person = await userWithRoles(['CUSTOMER'], 'Futura Staff');
    const promoted = await admin.patch(`/api/admin/customers/${person.id}`, {
      roles: ['STAFF'],
      reason: 'Turno de noche',
    });
    expect(adminCustomerResponseSchema.parse(promoted.body).customer.roles).toEqual(['STAFF']);
    expect((await auditFor(person.id, 'user.roles_changed')).length).toBe(1);

    const self = await admin.patch(`/api/admin/customers/${adminId}`, {
      roles: ['CUSTOMER'],
      reason: 'Probar',
    });
    expect(self.status).toBe(403);
    expect(error(self.body).code).toBe('ADMIN_SELF_CHANGE');

    // Por la API, quien actúa ya es un admin activo distinto del afectado: el último admin solo se
    // perdería si dos admins se quitan el rol al mismo tiempo. El candado lo serializa y el segundo
    // recibe 409 LAST_ADMIN.
    const second = await userWithRoles(['ADMIN'], 'Segunda Admin');
    const others = await api.db.user.findMany({
      where: {
        id: { notIn: [adminId, second.id] },
        blockedAt: null,
        roles: { some: { role: { key: 'ADMIN' } } },
      },
      select: { id: true },
    });
    await api.db.user.updateMany({
      where: { id: { in: others.map((o) => o.id) } },
      data: { blockedAt: new Date() },
    });
    const adminEmail = (await api.db.user.findUniqueOrThrow({ where: { id: adminId } })).email;
    try {
      // Directo contra el servicio: por HTTP, el segundo pedido podría cortarse antes en el control
      // de rol (403) según el orden; aquí se prueba la regla y el candado de forma determinista.
      const service = new CustomersAdminService({ db: api.db, clock: api.clock });
      const results = await Promise.allSettled([
        service.update(
          { userId: adminId, role: 'ADMIN' },
          second.id,
          { roles: ['CUSTOMER'], reason: 'Carrera A' },
          'r-a',
        ),
        service.update(
          { userId: second.id, role: 'ADMIN' },
          adminId,
          { roles: ['CUSTOMER'], reason: 'Carrera B' },
          'r-b',
        ),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected');
      expect(
        rejected?.status === 'rejected' && rejected.reason instanceof AppError && rejected.reason.code,
      ).toBe('LAST_ADMIN');
      const activeAdmins = await api.db.user.count({
        where: { blockedAt: null, roles: { some: { role: { key: 'ADMIN' } } } },
      });
      expect(activeAdmins).toBe(1);
    } finally {
      await api.db.user.updateMany({
        where: { id: { in: others.map((o) => o.id) } },
        data: { blockedAt: null },
      });
      await setUserRoles(api.db, { email: adminEmail, roles: ['ADMIN'], actor: null, reason: 'restaurar' });
      await setUserRoles(api.db, {
        email: second.email,
        roles: ['CUSTOMER'],
        actor: null,
        reason: 'restaurar',
      });
      admin = await signIn(api, adminEmail);
    }
  });
});

async function currentSettings(): Promise<AdminSettings> {
  return adminSettingsResponseSchema.parse((await admin.get('/api/admin/settings')).body).settings;
}

function settingsBody(settings: AdminSettings) {
  return {
    version: settings.version,
    pricesIncludeTax: settings.pricesIncludeTax,
    roundingIncrementMinor: settings.roundingIncrementMinor,
    minOrderMinor: settings.minOrderMinor,
    pickupEnabled: settings.pickupEnabled,
    deliveryEnabled: settings.deliveryEnabled,
    turnstileGlobalThreshold: settings.turnstileGlobalThreshold,
    turnstileWindowMinutes: settings.turnstileWindowMinutes,
    openingHours: settings.openingHours,
  };
}

describe('configuración, umbral de Turnstile, impuestos y zonas (§6.2, §8.4, D5, D8)', () => {
  it('el umbral de Turnstile del admin rige el login y queda auditado; versión vieja → 409', async () => {
    const settings = await currentSettings();
    const res = await admin.put('/api/admin/settings', {
      ...settingsBody(settings),
      turnstileGlobalThreshold: 3,
    });
    expect(res.status).toBe(200);
    const updated = await currentSettings();
    expect(updated).toMatchObject({ turnstileGlobalThreshold: 3, version: settings.version + 1 });
    expect((await auditFor('1', 'settings.turnstile_threshold_changed')).length).toBeGreaterThan(0);

    const { email } = await registerUser(api);
    for (let i = 0; i < 2; i += 1) {
      const fail = await new Browser(api).post('/api/auth/login', {
        email,
        password: 'equivocada desde lejos',
      });
      expect(error(fail.body).challengeRequired).toBeUndefined();
    }
    const third = await new Browser(api).post('/api/auth/login', {
      email,
      password: 'equivocada desde lejos',
    });
    expect(error(third.body).challengeRequired).toBe(true);

    const stale = await admin.put('/api/admin/settings', {
      ...settingsBody(settings),
      turnstileGlobalThreshold: 9,
    });
    expect(stale.status).toBe(409);
    expect(error(stale.body).code).toBe('RESOURCE_VERSION_CONFLICT');

    const restored = await admin.put('/api/admin/settings', {
      ...settingsBody(updated),
      turnstileGlobalThreshold: settings.turnstileGlobalThreshold,
    });
    expect(restored.status).toBe(200);
  });

  it('valida el horario (rango y superposición) y el cuerpo estricto', async () => {
    const settings = await currentSettings();
    const overlap = await admin.put('/api/admin/settings', {
      ...settingsBody(settings),
      openingHours: [
        { dayOfWeek: 1, opensMinutes: 660, closesMinutes: 900 },
        { dayOfWeek: 1, opensMinutes: 840, closesMinutes: 1260 },
        { dayOfWeek: 2, opensMinutes: 900, closesMinutes: 600 },
      ],
    });
    expect(overlap.status).toBe(400);
    expect(error(overlap.body).fields).toMatchObject({
      'openingHours.1': 'overlap',
      'openingHours.2': 'range',
    });
    const timezone = await admin.put('/api/admin/settings', { ...settingsBody(settings), timezone: 'UTC' });
    expect(timezone.status).toBe(400);
  });

  it('cambia una tasa de impuesto y una zona con AuditLog; la tarifa respeta el incremento', async () => {
    const data = adminSettingsResponseSchema.parse((await admin.get('/api/admin/settings')).body);
    const iva = data.taxRates.find((t) => t.key === 'iva');
    const zone = data.zones[0];
    if (!iva || !zone) throw new Error('sin semilla');
    const taxBody = (rateBps: number) => ({
      name: iva.name,
      rateBps,
      appliesTo: iva.appliesTo,
      fulfillmentTypes: iva.fulfillmentTypes,
      isActive: true,
    });
    const tax = await admin.put(`/api/admin/tax-rates/${iva.id}`, taxBody(1000));
    expect(tax.status).toBe(200);
    expect((await auditFor(iva.id, 'tax_rate.rate_changed'))[0]?.after).toMatchObject({ rateBps: 1000 });
    expect((await admin.put(`/api/admin/tax-rates/${iva.id}`, taxBody(iva.rateBps))).status).toBe(200);
    expect((await api.db.taxRate.findUniqueOrThrow({ where: { id: iva.id } })).rateBps).toBe(iva.rateBps);
    expect((await admin.put(`/api/admin/tax-rates/${iva.id}`, taxBody(10_001))).status).toBe(400);

    const zoneBody = (feeMinor: number) => ({
      name: zone.name,
      districts: zone.districts,
      feeMinor,
      etaMinutes: zone.etaMinutes,
      isActive: zone.isActive,
    });
    const odd = await admin.put(`/api/admin/delivery-zones/${zone.id}`, zoneBody(zone.feeMinor + 1));
    expect(error(odd.body).code).toBe('PRICE_INCREMENT');
    const fee = await admin.put(`/api/admin/delivery-zones/${zone.id}`, zoneBody(zone.feeMinor + 10000));
    expect(fee.status).toBe(200);
    const zones = (await new Browser(api).get('/api/public/delivery-zones')).body as {
      zones: { id: string; feeMinor: number }[];
    };
    expect(zones.zones.find((z) => z.id === zone.id)?.feeMinor).toBe(zone.feeMinor + 10000);
    expect((await auditFor(zone.id, 'delivery_zone.fee_changed')).length).toBe(1);
    expect((await admin.put(`/api/admin/delivery-zones/${zone.id}`, zoneBody(zone.feeMinor))).status).toBe(
      200,
    );
  });
});

let customerId: string | undefined;
async function insertOrder(
  status: 'PENDING_CONFIRMATION' | 'CONFIRMED' | 'DELIVERED' | 'CANCELLED',
  totalMinor: number,
  refundedMinor = 0,
  currency: 'CRC' | 'USD' = 'CRC',
) {
  customerId ??= (await api.db.user.findFirstOrThrow({ where: { email: customerEmail } })).id;
  const captured = ['CONFIRMED', 'DELIVERED'].includes(status) ? totalMinor : 0;
  return api.db.order.create({
    data: {
      code: `MB-T${randomUUID().slice(0, 5).toUpperCase()}`,
      userId: customerId,
      status,
      fulfillmentType: 'PICKUP',
      orderLocale: 'es_CR',
      currency,
      currencyMinorUnits: 2,
      subtotalMinor: totalMinor,
      taxTotalMinor: 0,
      totalMinor,
      pricesIncludeTax: true,
      createdAt: api.clock.now(),
      items: {
        create: [
          {
            orderLocale: 'es_CR',
            productName: 'Plato M8',
            quantity: 2,
            unitPriceMinor: totalMinor / 2,
            lineTotalMinor: totalMinor,
          },
        ],
      },
      payment: {
        create: {
          method: 'DEMO_CARD',
          status: captured > 0 ? 'CAPTURED' : 'REQUIRES_PAYMENT',
          currency,
          amountAuthorizedMinor: captured,
          amountCapturedMinor: captured,
          amountRefundedMinor: refundedMinor,
        },
      },
    },
    select: { id: true, code: true },
  });
}

describe('asistente de cambio de moneda (§6.2, D-M8-4)', () => {
  it('se bloquea con pedidos activos; sin ellos convierte todo y vuelve exacto con el mismo tipo', async () => {
    const settings = await currentSettings();
    const active = await insertOrder('PENDING_CONFIRMATION', 500000);
    const change = (version: number, currency: 'CRC' | 'USD', reason = 'Prueba del asistente') =>
      admin.post('/api/admin/settings/currency', { version, currency, crcPerUsd: '500', reason });
    const blocked = await change(settings.version, 'USD');
    expect(blocked.status).toBe(409);
    expect(error(blocked.body).code).toBe('CURRENCY_CHANGE_BLOCKED');
    expect((await currentSettings()).currency).toBe('CRC');
    await api.db.order.update({ where: { id: active.id }, data: { status: 'CANCELLED' } });
    // Otros archivos de la misma corrida pueden dejar pedidos activos en la base compartida: se
    // apartan durante el cambio (como exige §6.2) y se restauran al final.
    const others = await api.db.order.findMany({
      where: {
        status: {
          in: [
            'PENDING_PAYMENT',
            'PENDING_CONFIRMATION',
            'CONFIRMED',
            'PREPARING',
            'READY_FOR_PICKUP',
            'OUT_FOR_DELIVERY',
          ],
        },
      },
      select: { id: true, status: true },
    });
    await api.db.order.updateMany({
      where: { id: { in: others.map((o) => o.id) } },
      data: { status: 'CANCELLED' },
    });
    try {
      await convertAndBack(settings, change);
    } finally {
      for (const order of others) {
        await api.db.order.update({ where: { id: order.id }, data: { status: order.status } });
      }
    }
  });
});

async function convertAndBack(
  settings: AdminSettings,
  change: (version: number, currency: 'CRC' | 'USD', reason?: string) => ReturnType<Browser['post']>,
) {
  {
    const clasico = await productBySlug('ceviche-clasico');
    expect((await change(settings.version, 'USD')).status).toBe(200);
    const usd = await currentSettings();
    expect(usd).toMatchObject({
      currency: 'USD',
      roundingIncrementMinor: 1,
      minOrderMinor: settings.minOrderMinor / 500,
    });
    const live = catalogResponseSchema.parse((await new Browser(api).get('/api/public/catalog')).body);
    expect(live.currency).toBe('USD');
    expect(
      live.categories.flatMap((c) => c.products).find((p) => p.slug === 'ceviche-clasico')?.basePriceMinor,
    ).toBe(clasico.basePriceMinor / 500);
    const entry = (await auditFor('1', 'settings.currency_changed'))[0];
    expect(entry?.after).toMatchObject({ currency: 'USD', crcPerUsd: '500' });
    expect(entry?.reason).toBe('Prueba del asistente');

    expect((await change(usd.version, 'USD')).status).toBe(400);
    expect(error((await change(settings.version, 'CRC')).body).code).toBe('RESOURCE_VERSION_CONFLICT');
    expect((await change(usd.version, 'CRC', 'Volver a colones')).status).toBe(200);
    expect((await currentSettings()).currency).toBe('CRC');
    // Ida y vuelta con 500 ₡/$: los precios de la semilla son múltiplos de ₡5 y vuelven exactos.
    const prices = await api.db.product.findMany({ select: { id: true, basePriceMinor: true } });
    for (const p of snapshot.products) {
      expect(prices.find((x) => x.id === p.id)?.basePriceMinor).toBe(p.basePriceMinor);
    }
  }
}

describe('dashboard con datos reales (§12)', () => {
  it('suma ventas aceptadas, reembolsos, ticket promedio, trabajo pendiente y top de platos', async () => {
    const before = adminDashboardResponseSchema.parse(
      (await admin.get('/api/admin/dashboard?range=today')).body,
    );
    await insertOrder('DELIVERED', 1_000_000, 100_000);
    await insertOrder('CONFIRMED', 500_000);
    await insertOrder('CANCELLED', 300_000);
    await insertOrder('PENDING_CONFIRMATION', 200_000);
    await insertOrder('DELIVERED', 400_000, 0, 'USD');
    const after = adminDashboardResponseSchema.parse(
      (await admin.get('/api/admin/dashboard?range=today')).body,
    );
    expect(after.currency).toBe('CRC');
    expect(after.sales.orders - before.sales.orders).toBe(2);
    expect(after.sales.grossMinor - before.sales.grossMinor).toBe(1_500_000);
    expect(after.sales.refundedMinor - before.sales.refundedMinor).toBe(100_000);
    expect(after.sales.netMinor).toBe(after.sales.grossMinor - after.sales.refundedMinor);
    expect(after.otherCurrencyOrders - before.otherCurrencyOrders).toBe(1);
    expect(after.cancelled - before.cancelled).toBe(1);
    expect(after.pending.confirmation - before.pending.confirmation).toBe(1);
    expect(after.pending.kitchen - before.pending.kitchen).toBe(1);
    expect(after.ordersByStatus).toHaveLength(8);
    expect(after.topProducts.find((p) => p.name === 'Plato M8')).toMatchObject({ quantity: 4 });
    expect((await admin.get('/api/admin/dashboard?range=year')).status).toBe(400);
    const week = adminDashboardResponseSchema.parse((await admin.get('/api/admin/dashboard?range=7d')).body);
    expect(new Date(week.from).getTime()).toBeLessThan(new Date(after.from).getTime());
    // Se cierran para no dejar pedidos activos en la base compartida.
    await api.db.order.updateMany({
      where: { userId: customerId ?? '', status: { in: ['PENDING_CONFIRMATION', 'CONFIRMED'] } },
      data: { status: 'CANCELLED' },
    });
  });
});

describe('auditoría de solo lectura con filtros (§8.6)', () => {
  it('filtra por entidad, acción y fechas; pagina; no hay endpoints de edición', async () => {
    const products = adminAuditResponseSchema.parse(
      (await admin.get('/api/admin/audit?entityType=product')).body,
    );
    expect(products.entries.length).toBeGreaterThan(0);
    expect(products.entries.every((e) => e.entityType === 'product')).toBe(true);
    const times = products.entries.map((e) => new Date(e.createdAt).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(products.entries[0]?.actor).toMatchObject({ role: 'ADMIN' });

    const currency = adminAuditResponseSchema.parse(
      (await admin.get('/api/admin/audit?action=settings.currency_changed')).body,
    );
    expect(currency.entries).toHaveLength(2);
    const today = localDateOf(new Date(), 'America/Costa_Rica');
    const ranged = adminAuditResponseSchema.parse(
      (await admin.get(`/api/admin/audit?from=${today}&to=${today}`)).body,
    );
    expect(ranged.entries.length).toBeGreaterThan(0);
    const old = adminAuditResponseSchema.parse(
      (await admin.get('/api/admin/audit?from=2020-01-01&to=2020-01-02')).body,
    );
    expect(old.entries).toHaveLength(0);
    // Más de 25 entradas hoy (las de este archivo): hay página siguiente y no repite.
    expect(ranged.nextCursor).not.toBeNull();
    const next = adminAuditResponseSchema.parse(
      (await admin.get(`/api/admin/audit?from=${today}&to=${today}&cursor=${String(ranged.nextCursor)}`))
        .body,
    );
    expect(next.entries.length).toBeGreaterThan(0);
    expect(next.entries.map((e) => e.id)).not.toContain(ranged.entries[0]?.id);
    expect((await admin.get('/api/admin/audit?entityType=secret')).status).toBe(400);
    const firstId = products.entries[0]?.id ?? randomUUID();
    expect((await admin.put(`/api/admin/audit/${firstId}`, {})).status).toBe(404);
    expect((await admin.delete(`/api/admin/audit/${firstId}`)).status).toBe(404);
    // Los correos de las entradas de usuario siguen enmascarados.
    const users = adminAuditResponseSchema.parse((await admin.get('/api/admin/audit?entityType=user')).body);
    expect(JSON.stringify(users.entries)).not.toContain(customerEmail);
  });
});

describe('pedidos y reembolsos del admin (ADR 0008)', () => {
  it('lista con búsqueda y estado; el detalle trae cliente, pago, versión y si se puede cancelar', async () => {
    const order = await insertOrder('CONFIRMED', 700_000);
    const byCode = adminOrdersResponseSchema.parse(
      (await admin.get(`/api/admin/orders?q=${order.code}`)).body,
    );
    expect(byCode.orders.map((o) => o.code)).toEqual([order.code]);
    const confirmed = adminOrdersResponseSchema.parse(
      (await admin.get('/api/admin/orders?status=CONFIRMED')).body,
    );
    expect(confirmed.orders.every((o) => o.status === 'CONFIRMED')).toBe(true);
    const detail = adminOrderDetailResponseSchema.parse(
      (await admin.get(`/api/admin/orders/${order.id}`)).body,
    );
    expect(detail).toMatchObject({ version: 0, canCancel: true, customer: { email: customerEmail } });
    expect(detail.payment).toMatchObject({ amountCapturedMinor: 700_000, refunds: [] });
    expect((await admin.get(`/api/admin/orders/${randomUUID()}`)).status).toBe(404);
    expect((await admin.get('/api/admin/orders/no-es-uuid')).status).toBe(404);
    expect((await admin.get('/api/admin/orders?status=PERDIDO')).status).toBe(400);
    await api.db.order.update({ where: { id: order.id }, data: { status: 'DELIVERED' } });
  });
});

describe('límites de §8.4 para cambios del admin', () => {
  it('30 cambios / 10 min por usuario; el 31.º responde 429 y queda en el AuditLog', async () => {
    const { browser, id } = await userWithRoles(['ADMIN'], 'Admin Apurada');
    const data = adminSettingsResponseSchema.parse((await browser.get('/api/admin/settings')).body);
    const zone = data.zones[0];
    if (!zone) throw new Error('sin zonas');
    const body = {
      name: zone.name,
      districts: zone.districts,
      feeMinor: zone.feeMinor,
      etaMinutes: zone.etaMinutes,
      isActive: zone.isActive,
    };
    for (let i = 0; i < 30; i += 1) {
      expect((await browser.put(`/api/admin/delivery-zones/${zone.id}`, body)).status).toBe(200);
    }
    const limited = await browser.put(`/api/admin/delivery-zones/${zone.id}`, body);
    expect(limited.status).toBe(429);
    expect(error(limited.body).code).toBe('RATE_LIMITED');
    const entry = await api.db.auditLog.findFirst({
      where: { actorUserId: id, action: 'delivery_zone.rate_limited' },
    });
    expect(entry).not.toBeNull();
    // El filtro de acciones de la auditoría la encuentra.
    const found = adminAuditResponseSchema.parse(
      (await browser.get('/api/admin/audit?action=delivery_zone.rate_limited')).body,
    );
    expect(found.entries.some((e) => e.entityId === zone.id)).toBe(true);
  });
});
