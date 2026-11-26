/**
 * M10-1 · Despliegue contra PostgreSQL real (ADR 0010):
 * - D-M10-2: secreto de origen (dos, para rotar), IP del cliente desde `X-Client-IP`, IPv4/IPv6,
 *   `X-Forwarded-For` ignorado, límites por IP y logs sin IP ni secretos;
 * - D-M10-6: `/api/health` público y `/api/health/ready` detrás del secreto;
 * - D-M10-1: endpoint interno de tareas (dos secretos, 404 sin configurar, 409 si ya corre, límite
 *   propio, solo conteos), con la reconciliación del pago "pendiente", el barrido y el outbox reales,
 *   repetición sin efectos dobles y la actividad que habilita los temporizadores;
 * - D-M10-P1: "Verificar (demo)" solo para la propia cuenta, con el último correo de verificación
 *   `DEMO_ONLY`, la bandera activa, límite por cuenta, AuditLog y sesión rotada.
 *
 * La falsificación de `CF-Connecting-IP` en la entrada del Worker **no** se puede probar aquí: es
 * comportamiento de Cloudflare. Queda en la suite post-deploy (docs/m10/POST_DEPLOY.md).
 */
import {
  apiErrorBodySchema,
  checkoutQuoteSchema,
  demoInboxResponseSchema,
  orderResponseSchema,
  type Order,
} from '@marea-baja/shared';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MINUTE } from '../src/lib/clock.ts';
import { windowStart } from '../src/modules/rate-limit/rate-limiter.ts';
import { TasksBusyError } from '../src/modules/tasks/background.ts';
import { INTERNAL_TASKS_LIMIT } from '../src/modules/tasks/routes.ts';
import {
  Browser,
  buildApi,
  PASSWORD,
  registerUser,
  setCookie,
  signIn,
  uniqueEmail,
  WEB_ORIGIN,
  type TestApi,
} from './http.ts';

const ORIGIN_A = 'origen-actual-de-pruebas-con-32-caracteres-o-mas';
const ORIGIN_B = 'origen-siguiente-de-pruebas-con-32-caracteres-mas';
const TASKS_A = 'tareas-actual-de-pruebas-con-32-caracteres-o-mas';
const TASKS_B = 'tareas-siguiente-de-pruebas-con-32-caracteres-mas';

/** API detrás del Worker (secretos de origen configurados, como en producción). */
let guarded: TestApi;
/** API con el endpoint de tareas y la verificación demo, sin Worker delante (como en desarrollo). */
let api: TestApi;
let ceviche = '';
let suave = '';

beforeAll(async () => {
  guarded = buildApi({ config: { originSecrets: [ORIGIN_A, ORIGIN_B] } });
  api = buildApi({
    config: {
      tasksSecrets: [TASKS_A, TASKS_B],
      demoEmailVerification: true,
      ordersAllowOutsideHours: true,
      demoPaymentsEnabled: true,
    },
  });
  const product = await api.db.product.findUniqueOrThrow({
    where: { slug: 'ceviche-clasico' },
    include: { optionGroups: { include: { options: true } } },
  });
  ceviche = product.id;
  suave = product.optionGroups.flatMap((g) => g.options).find((o) => o.name === 'Suave')?.id ?? '';
});
afterAll(async () => {
  await guarded.close();
  await api.close();
});

const errorCode = (body: unknown) => apiErrorBodySchema.parse(body).error.code;

let ipCounter = 0;
/** IP única de la red de documentación 198.51.100.0/24 (RFC 5737), distinta de la de `uniqueIp`. */
function workerIp(): string {
  ipCounter += 1;
  return `198.51.100.${String((ipCounter % 250) + 1)}`;
}

/** Navegador detrás del Worker: el Worker agrega el secreto y la IP real a cada petición. */
class WorkerBrowser {
  readonly agent: ReturnType<typeof request.agent>;
  readonly ip: string;
  readonly secret: string;
  readonly extra: Record<string, string>;
  csrf = '';

  constructor(ip: string, secret = ORIGIN_A, extra: Record<string, string> = {}) {
    this.agent = request.agent(guarded.app);
    this.ip = ip;
    this.secret = secret;
    this.extra = extra;
  }

  #headers(req: request.Test): request.Test {
    let out = req.set('X-Origin-Auth', this.secret).set('X-Client-IP', this.ip);
    for (const [name, value] of Object.entries(this.extra)) out = out.set(name, value);
    return out;
  }

  get(path: string) {
    return this.#headers(this.agent.get(path));
  }

  async post(path: string, body: object = {}) {
    if (!this.csrf) {
      const res = await this.get('/api/auth/csrf').expect(200);
      this.csrf = (res.body as { csrfToken: string }).csrfToken;
    }
    return this.#headers(this.agent.post(path))
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', this.csrf)
      .send(body);
  }
}

describe('secreto de origen e IP del cliente (D-M10-2)', () => {
  it('/api/health responde sin secreto; el resto de /api exige el secreto', async () => {
    expect((await request(guarded.app).get('/api/health')).status).toBe(200);
    const direct = await request(guarded.app).get('/api/auth/csrf');
    expect(direct.status).toBe(403);
    expect(errorCode(direct.body)).toBe('ORIGIN_FORBIDDEN');
    // Una llamada directa con una IP inventada y sin secreto tampoco pasa.
    const spoofed = await request(guarded.app).get('/api/auth/csrf').set('X-Client-IP', '203.0.113.9');
    expect(spoofed.status).toBe(403);
  });

  it('rechaza un secreto falsificado, vacío o con otro largo', async () => {
    for (const secret of ['', 'otro', `${ORIGIN_A}x`, ORIGIN_A.slice(0, -1), TASKS_A]) {
      const res = await request(guarded.app)
        .get('/api/auth/csrf')
        .set('X-Origin-Auth', secret)
        .set('X-Client-IP', '203.0.113.9');
      expect(res.status, secret).toBe(403);
    }
  });

  it('acepta los dos secretos de la rotación', async () => {
    for (const secret of [ORIGIN_A, ORIGIN_B]) {
      const res = await request(guarded.app)
        .get('/api/auth/csrf')
        .set('X-Origin-Auth', secret)
        .set('X-Client-IP', workerIp());
      expect(res.status).toBe(200);
    }
  });

  it('con secreto válido exige una IPv4 o IPv6 válida en X-Client-IP', async () => {
    const send = (ip?: string) => {
      const req = request(guarded.app).get('/api/auth/csrf').set('X-Origin-Auth', ORIGIN_A);
      return ip === undefined ? req : req.set('X-Client-IP', ip);
    };
    for (const bad of [undefined, '', 'no-es-una-ip', '203.0.113.1, 198.51.100.2', '999.1.1.1', '::g']) {
      const res = await send(bad);
      expect(res.status, String(bad)).toBe(400);
      expect(errorCode(res.body)).toBe('INVALID_CLIENT_IP');
    }
    expect((await send('203.0.113.200')).status).toBe(200);
    expect((await send('2001:DB8::1')).status).toBe(200);
  });

  it('los límites por IP usan X-Client-IP: X-Forwarded-For y la cabecera de pruebas no cuentan', async () => {
    const ip = workerIp();
    // Registro: 5 por hora por IP (§8.4). Cada intento manda un X-Forwarded-For distinto.
    for (let i = 0; i < 5; i += 1) {
      const browser = new WorkerBrowser(ip, ORIGIN_A, {
        'X-Forwarded-For': `192.0.2.${String(i + 1)}`,
        'x-test-ip': `192.0.2.${String(i + 1)}`,
      });
      const res = await browser.post('/api/auth/register', {
        name: 'Ana Worker',
        email: uniqueEmail('worker'),
        password: PASSWORD,
        locale: 'es-CR',
      });
      expect(res.status, JSON.stringify(res.body)).toBe(202);
    }
    const blocked = await new WorkerBrowser(ip, ORIGIN_B, { 'X-Forwarded-For': '192.0.2.99' }).post(
      '/api/auth/register',
      { name: 'Ana Worker', email: uniqueEmail('worker'), password: PASSWORD, locale: 'es-CR' },
    );
    expect(blocked.status).toBe(429);
    // Otra IP real (IPv6) no queda afectada.
    const other = await new WorkerBrowser(`2001:db8::${String(ipCounter)}`).post('/api/auth/register', {
      name: 'Ana Worker',
      email: uniqueEmail('worker'),
      password: PASSWORD,
      locale: 'es-CR',
    });
    expect(other.status).toBe(202);
  });

  it('los logs no guardan la IP del cliente ni los secretos', async () => {
    const ip = '198.51.100.251';
    await new WorkerBrowser(ip).get('/api/auth/session').expect(200);
    await request(guarded.app).get('/api/auth/csrf').set('X-Origin-Auth', 'secreto-falso-en-el-log');
    const logs = guarded.logs.join('\n');
    expect(logs).not.toContain(ip);
    expect(logs).not.toContain(ORIGIN_A);
    expect(logs).not.toContain('secreto-falso-en-el-log');
  });
});

describe('salud (D-M10-6)', () => {
  it('/api/health/ready exige el secreto de origen y confirma la base', async () => {
    expect((await request(guarded.app).get('/api/health/ready')).status).toBe(403);
    const ready = await request(guarded.app)
      .get('/api/health/ready')
      .set('X-Origin-Auth', ORIGIN_A)
      .set('X-Client-IP', workerIp());
    expect(ready.status).toBe(200);
    expect(ready.body).toEqual({ status: 'ready' });
    // /api/health sigue igual: sin base ni datos.
    expect((await request(guarded.app).get('/api/health')).body).toEqual({ status: 'ok' });
  });
});

const tasks = (secret?: string, target: TestApi = api) => {
  const req = request(target.app).post('/api/internal/tasks');
  return secret === undefined ? req : req.set('X-Tasks-Auth', secret);
};

/** Pedido nuevo en `PENDING_PAYMENT` (retiro, 2 ceviches). */
async function placeOrder(browser: Browser): Promise<Order> {
  expect(
    (
      await browser.post('/api/cart/items', {
        locale: 'es-CR',
        productId: ceviche,
        optionIds: [suave],
        quantity: 2,
        mode: 'set',
      })
    ).status,
  ).toBe(200);
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

async function verifiedCustomer() {
  const { email } = await registerUser(api, { verify: true });
  return { email, browser: await signIn(api, email) };
}

/** Todas las hojas del informe son números o booleanos: nada de ids, correos ni textos. */
function leaves(value: unknown): unknown[] {
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(leaves);
  return [value];
}

describe('endpoint interno de tareas (D-M10-1)', () => {
  it('no existe sin TASKS_SECRETS', async () => {
    expect((await tasks(TASKS_A, guarded)).status).toBe(403); // sin secreto de origen: 403 antes
    const plain = await request(guarded.app)
      .post('/api/internal/tasks')
      .set('X-Origin-Auth', ORIGIN_A)
      .set('X-Client-IP', workerIp())
      .set('X-Tasks-Auth', TASKS_A);
    expect(plain.status).toBe(404);
  });

  it('exige X-Tasks-Auth, acepta los dos secretos y no acepta otros', async () => {
    for (const secret of [undefined, '', 'otro', ORIGIN_A, `${TASKS_A}x`, TASKS_A.slice(1)]) {
      const res = await tasks(secret);
      expect(res.status, String(secret)).toBe(403);
      if (res.status === 403) expect(errorCode(res.body)).toBe('TASKS_FORBIDDEN');
    }
    for (const secret of [TASKS_A, TASKS_B]) expect((await tasks(secret)).status).toBe(200);
  });

  it('responde solo conteos y no necesita Origin, CSRF ni sesión', async () => {
    const res = await tasks(TASKS_A);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body as object).sort()).toEqual(
      ['durationMs', 'ok', 'outbox', 'purge', 'reconcile', 'sweep'].sort(),
    );
    for (const leaf of leaves(res.body)) expect(['number', 'boolean']).toContain(typeof leaf);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('resuelve el pago "pendiente" de la demo, barre los vencidos y reintenta el outbox', async () => {
    const { browser } = await verifiedCustomer();
    // Pago pendiente: el procesador demo lo aprueba a los ~20 s.
    const pending = await placeOrder(browser);
    await browser.post(
      `/api/orders/${pending.id}/payments/authorize`,
      { scenario: 'PENDING' },
      { 'Idempotency-Key': randomUUID() },
    );
    // Pedido sin pagar: vence a los 30 min. Mismo carrito en menos de 60 s sería el mismo pedido (§7.3).
    api.clock.advance(61_000);
    const unpaid = await placeOrder(browser);
    // Un correo en cola con el reintento vencido.
    const queued = await api.db.emailOutbox.findFirstOrThrow({
      where: { status: { in: ['SENT', 'DEMO_ONLY'] } },
      orderBy: { createdAt: 'desc' },
    });
    await api.db.emailOutbox.update({
      where: { id: queued.id },
      data: { status: 'QUEUED', nextAttemptAt: api.clock.now(), sentAt: null },
    });

    api.clock.advance(31 * MINUTE);
    const res = await tasks(TASKS_A);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const report = res.body as {
      ok: boolean;
      sweep: { expired: number };
      reconcile: { resolved: number; passes: number };
      outbox: { sent: number; demoOnly: number; failed: number };
    };
    expect(report.ok).toBe(true);
    expect(report.reconcile.resolved).toBeGreaterThanOrEqual(1);
    expect(report.sweep.expired).toBeGreaterThanOrEqual(1);

    const paid = await api.db.payment.findUniqueOrThrow({
      where: { orderId: pending.id },
      include: { order: true },
    });
    expect(paid.status).toBe('AUTHORIZED');
    expect(paid.order.status).toBe('PENDING_CONFIRMATION');
    const expired = await api.db.order.findUniqueOrThrow({ where: { id: unpaid.id } });
    expect(expired.status).toBe('CANCELLED');
    const retried = await api.db.emailOutbox.findUniqueOrThrow({ where: { id: queued.id } });
    expect(retried.status).not.toBe('QUEUED');

    // La segunda vuelta tiene trabajo nuevo y legítimo: el pago se autorizó después de vencer el pedido
    // (31 min > 30), y el barrido lo cancela y anula el pago (R-M6-2). Después, repetir no cambia nada.
    expect((await tasks(TASKS_B)).status).toBe(200);
    const historyBefore = await api.db.orderStatusHistory.count({
      where: { orderId: { in: [pending.id, unpaid.id] } },
    });
    expect((await tasks(TASKS_A)).status).toBe(200);
    expect(
      await api.db.orderStatusHistory.count({ where: { orderId: { in: [pending.id, unpaid.id] } } }),
    ).toBe(historyBefore);
    expect((await api.db.order.findUniqueOrThrow({ where: { id: unpaid.id } })).status).toBe('CANCELLED');
  });

  it('una vuelta a la vez: la segunda simultánea responde ocupado (409 por HTTP)', async () => {
    const first = api.tasks.runAll();
    await expect(api.tasks.runAll()).rejects.toBeInstanceOf(TasksBusyError);
    const report = await first;
    expect(report.ok).toBe(true);
    // Termina la primera: se puede volver a correr.
    expect((await api.tasks.runAll()).ok).toBe(true);
  });

  it('el endpoint y los temporizadores juntos no duplican efectos', async () => {
    const { browser } = await verifiedCustomer();
    const unpaid = await placeOrder(browser);
    api.clock.advance(31 * MINUTE);
    // El barrido del temporizador y la vuelta del endpoint, a la vez.
    const [timerSweep, round] = await Promise.all([api.tasks.sweep(), api.tasks.runAll()]);
    expect(timerSweep.expired + round.sweep.expired).toBeGreaterThanOrEqual(1);
    const history = await api.db.orderStatusHistory.findMany({
      where: { orderId: unpaid.id, toStatus: 'CANCELLED' },
    });
    expect(history).toHaveLength(1);
  });

  it('tiene su propio límite: 12 por hora', async () => {
    // Ventana nueva, lejos de las demás pruebas.
    const window = INTERNAL_TASKS_LIMIT.windowMs;
    api.clock.set(new Date(windowStart(api.clock.now(), window).getTime() + 48 * window));
    for (let i = 0; i < INTERNAL_TASKS_LIMIT.max; i += 1) expect((await tasks(TASKS_A)).status).toBe(200);
    const blocked = await tasks(TASKS_B);
    expect(blocked.status).toBe(429);
    expect(errorCode(blocked.body)).toBe('RATE_LIMITED');
  });
});

describe('actividad reciente (D-M10-1)', () => {
  it('health, catalog-version y el endpoint interno no cuentan; una petición real sí, por 5 min', async () => {
    const fresh = buildApi({ config: { tasksSecrets: [TASKS_A] } });
    try {
      expect(fresh.activity.isActive()).toBe(false);
      await request(fresh.app).get('/api/health').expect(200);
      await request(fresh.app).get('/api/health/ready').expect(200);
      await request(fresh.app).get('/api/public/catalog-version').expect(200);
      await request(fresh.app).post('/api/internal/tasks').set('X-Tasks-Auth', TASKS_A).expect(200);
      expect(fresh.activity.isActive()).toBe(false);

      await request(fresh.app).get('/api/auth/session').expect(200);
      expect(fresh.activity.isActive()).toBe(true);
      fresh.clock.advance(5 * MINUTE - 1);
      expect(fresh.activity.isActive()).toBe(true);
      fresh.clock.advance(1);
      expect(fresh.activity.isActive()).toBe(false);
    } finally {
      await fresh.close();
    }
  });

  it('detrás del Worker, una petición rechazada sin secreto no cuenta como actividad', async () => {
    const fresh = buildApi({ config: { originSecrets: [ORIGIN_A] } });
    try {
      await request(fresh.app).get('/api/auth/session').expect(403);
      expect(fresh.activity.isActive()).toBe(false);
      await request(fresh.app)
        .get('/api/auth/session')
        .set('X-Origin-Auth', ORIGIN_A)
        .set('X-Client-IP', workerIp())
        .expect(200);
      expect(fresh.activity.isActive()).toBe(true);
    } finally {
      await fresh.close();
    }
  });
});

describe('verificación demo del correo (D-M10-P1)', () => {
  async function unverified(target: TestApi = api) {
    const { email } = await registerUser(target);
    const browser = await signIn(target, email);
    const user = await target.db.user.findFirstOrThrow({ where: { email } });
    return { email, browser, userId: user.id };
  }

  /** Simula la demo pública: el correo de verificación no se envió (sin dominio, D6). */
  async function markLatestVerificationDemoOnly(userId: string) {
    const latest = await api.db.emailOutbox.findFirstOrThrow({
      where: { userId, template: 'email-verification' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    await api.db.emailOutbox.update({
      where: { id: latest.id },
      data: { status: 'DEMO_ONLY', sentAt: null },
    });
    return latest.id;
  }

  const inbox = async (browser: Browser) =>
    demoInboxResponseSchema.parse((await browser.get('/api/me/notifications')).body).messages;

  it('sin la bandera no está disponible', async () => {
    const plain = buildApi();
    try {
      const { browser, userId } = await unverified(plain);
      const latest = await plain.db.emailOutbox.findFirstOrThrow({
        where: { userId, template: 'email-verification' },
      });
      await plain.db.emailOutbox.update({ where: { id: latest.id }, data: { status: 'DEMO_ONLY' } });
      const res = await browser.post('/api/auth/demo-verify');
      expect(res.status).toBe(403);
      expect(errorCode(res.body)).toBe('DEMO_VERIFICATION_UNAVAILABLE');
      expect((await inbox(browser)).every((m) => !m.demoVerifiable)).toBe(true);
    } finally {
      await plain.close();
    }
  });

  it('sin sesión: 401', async () => {
    const res = await new Browser(api).post('/api/auth/demo-verify');
    expect(res.status).toBe(401);
  });

  it('si el correo se envió por un canal real, vale solo el enlace del correo', async () => {
    const { browser, userId } = await unverified();
    // MemoryEmailProvider acepta el envío: el correo quedó SENT.
    expect((await inbox(browser)).every((m) => !m.demoVerifiable)).toBe(true);
    const res = await browser.post('/api/auth/demo-verify');
    expect(res.status).toBe(403);
    expect((await api.db.user.findUniqueOrThrow({ where: { id: userId } })).emailVerifiedAt).toBeNull();
  });

  it('solo cuenta el último correo de verificación', async () => {
    const { browser, userId } = await unverified();
    await markLatestVerificationDemoOnly(userId);
    // Reenvío por un canal real: el último queda SENT.
    api.clock.advance(2 * MINUTE);
    expect((await browser.post('/api/auth/resend-verification')).status).toBe(202);
    await api.outbox.idle();
    await api.outbox.kick();
    expect((await browser.post('/api/auth/demo-verify')).status).toBe(403);
  });

  it('verifica la propia cuenta sin exponer tokens, con AuditLog y sesión rotada', async () => {
    const { browser, userId } = await unverified();
    const messageId = await markLatestVerificationDemoOnly(userId);

    const before = await inbox(browser);
    expect(before.filter((m) => m.demoVerifiable).map((m) => m.id)).toEqual([messageId]);
    expect(JSON.stringify(before)).not.toMatch(/#token=|token=/);

    const res = await browser.post('/api/auth/demo-verify');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((res.body as { user: { emailVerified: boolean } }).user.emailVerified).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/token=/);
    // La sesión rota (§8.2): llega una cookie de sesión nueva.
    expect(setCookie(res, 'mb_session')).toBeDefined();

    const user = await api.db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.emailVerifiedAt).not.toBeNull();
    expect(await api.db.emailVerificationToken.count({ where: { userId, usedAt: null } })).toBe(0);
    const audit = await api.db.auditLog.findFirstOrThrow({
      where: { entityId: userId, action: 'user.email_verified_demo' },
    });
    expect(audit).toMatchObject({ actorUserId: userId, entityType: 'user', after: { emailVerified: true } });

    // Repetir: ya verificada.
    const again = await browser.post('/api/auth/demo-verify');
    expect(again.status).toBe(409);
    expect((await inbox(browser)).every((m) => !m.demoVerifiable)).toBe(true);

    // La sesión rotada sigue sirviendo y la cuenta ya puede pedir.
    expect((await browser.get('/api/auth/me')).status).toBe(200);
    const order = await placeOrder(browser);
    expect(order.status).toBe('PENDING_PAYMENT');
  });

  it('una cuenta no puede verificar a otra', async () => {
    const victim = await unverified();
    await markLatestVerificationDemoOnly(victim.userId);
    const other = await unverified();
    // La otra cuenta solo puede actuar sobre sí misma; su correo quedó SENT.
    expect((await other.browser.post('/api/auth/demo-verify')).status).toBe(403);
    expect(
      (await api.db.user.findUniqueOrThrow({ where: { id: victim.userId } })).emailVerifiedAt,
    ).toBeNull();
    expect((await inbox(other.browser)).every((m) => !m.demoVerifiable)).toBe(true);
  });

  it('tiene límite por cuenta (5 por hora)', async () => {
    const { browser } = await unverified();
    for (let i = 0; i < 5; i += 1) expect((await browser.post('/api/auth/demo-verify')).status).toBe(403);
    const limited = await browser.post('/api/auth/demo-verify');
    expect(limited.status).toBe(429);
  });

  it('el login de una cuenta verificada en la demo sigue funcionando', async () => {
    const { browser, userId, email } = await unverified();
    await markLatestVerificationDemoOnly(userId);
    expect((await browser.post('/api/auth/demo-verify')).status).toBe(200);
    const fresh = await signIn(api, email);
    expect((await fresh.get('/api/auth/me')).body).toMatchObject({ user: { emailVerified: true } });
  });
});
