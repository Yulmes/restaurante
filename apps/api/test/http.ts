/**
 * Ayudas para las pruebas de integración de la API (Supertest + PostgreSQL real, §11).
 * Cada prueba usa correos e IP únicos, así los límites y los datos no se cruzan entre casos.
 */
import { randomInt, randomUUID } from 'node:crypto';
import type { Router } from 'express';
import request from 'supertest';
import { createApp } from '../src/app.ts';
import type { AppConfig } from '../src/config/app-config.ts';
import { createLogger } from '../src/config/logger.ts';
import { createPrismaClient } from '../src/db/client.ts';
import type { PrismaClient } from '../src/generated/prisma/client.ts';
import type { Clock } from '../src/lib/clock.ts';
import { FakeBotCheck } from '../src/modules/bot-check/bot-check.ts';
import { MemoryEmailProvider } from '../src/modules/notifications/providers.ts';
import type { PaymentGateway } from '../src/modules/payments/gateway.ts';
import type { OperationsService } from '../src/modules/orders/operations.ts';
import type { PaymentService } from '../src/modules/payments/service.ts';
import { appUrl } from './db.ts';

export const WEB_ORIGIN = 'http://web.test';

export class TestClock implements Clock {
  #ms = Date.now();
  now(): Date {
    return new Date(this.#ms);
  }
  advance(ms: number): void {
    this.#ms += ms;
  }
  /** M5: fija la hora (pruebas del horario de pedidos). */
  set(date: Date): void {
    this.#ms = date.getTime();
  }
}

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    production: false,
    webOrigin: WEB_ORIGIN,
    publicWebUrl: WEB_ORIGIN,
    appSecret: 'clave-de-pruebas-de-al-menos-32-caracteres',
    emailFrom: 'Marea Baja <no-reply@marea-baja.test>',
    turnstileDefaults: { threshold: 50, windowMinutes: 60 },
    ordersAllowOutsideHours: false,
    demoPaymentsEnabled: true,
    orderConfirmationTimeoutMs: 20 * 60_000,
    ...overrides,
  };
}

export interface TestApi {
  app: ReturnType<typeof createApp>['app'];
  outbox: ReturnType<typeof createApp>['outbox'];
  /** M6: el servicio de pagos (la reconciliación se corre a mano en las pruebas). */
  payments: PaymentService;
  /** M7: operación (los barridos se corren a mano en las pruebas). */
  operations: OperationsService;
  db: PrismaClient;
  clock: TestClock;
  email: MemoryEmailProvider;
  logs: string[];
  close(): Promise<void>;
}

/**
 * Un solo proveedor de correo en memoria para todas las API de un archivo de pruebas. Las API de
 * prueba comparten la base: el worker del outbox de cualquiera de ellas puede tomar un correo
 * encolado por otra (desde M7 los pagos y los cambios de estado también lo despiertan). Con un
 * proveedor compartido, el correo llega igual a la lista que miran las pruebas.
 */
const sharedEmail = new MemoryEmailProvider();

export function buildApi(
  options: { config?: Partial<AppConfig>; extraRoutes?: Router; paymentGateway?: PaymentGateway } = {},
): TestApi {
  const db = createPrismaClient(appUrl());
  const clock = new TestClock();
  const email = sharedEmail;
  const logs: string[] = [];
  const logger = createLogger({ level: 'info' }, { write: (line: string) => logs.push(line) });
  const { app, outbox, payments, operations } = createApp({
    config: testConfig(options.config),
    db,
    logger,
    clock,
    email,
    botCheck: new FakeBotCheck(),
    clientIp: (req) => req.get('x-test-ip') ?? '198.51.100.1',
    ...(options.extraRoutes ? { extraRoutes: options.extraRoutes } : {}),
    ...(options.paymentGateway ? { paymentGateway: options.paymentGateway } : {}),
  });
  return { app, outbox, payments, operations, db, clock, email, logs, close: () => db.$disconnect() };
}

// M8: cada archivo de pruebas empieza en un punto aleatorio del rango. Los archivos comparten la
// base (y sus contadores de límites por IP) en una misma corrida; si todos empezaran en la misma
// IP, los registros de uno contarían contra el límite de 5 / h por IP del siguiente.
let ipCounter = randomInt(0, 60_000);
/** IP única de la red de documentación (RFC 5737). */
export function uniqueIp(): string {
  ipCounter += 1;
  return `203.0.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter % 250) + 1)}`;
}

export function uniqueEmail(prefix = 'cliente'): string {
  return `${prefix}.${randomUUID().slice(0, 8)}@example.com`;
}

/** Contraseña válida que no está en la lista de comunes. */
export const PASSWORD = 'marea baja en la costa 2026';

/**
 * Un navegador simulado: guarda cookies, pide el token CSRF y lo manda con `Origin` correcto,
 * como hace la web.
 */
export class Browser {
  readonly agent: ReturnType<typeof request.agent>;
  readonly ip: string;
  csrf = '';

  constructor(api: TestApi, ip = uniqueIp()) {
    this.agent = request.agent(api.app);
    this.ip = ip;
  }

  async refreshCsrf(): Promise<string> {
    const res = await this.agent.get('/api/auth/csrf').set('x-test-ip', this.ip).expect(200);
    this.csrf = (res.body as { csrfToken: string }).csrfToken;
    return this.csrf;
  }

  get(path: string) {
    return this.agent.get(path).set('x-test-ip', this.ip);
  }

  async send(
    method: 'post' | 'patch' | 'put' | 'delete',
    path: string,
    body: object = {},
    headers: Record<string, string> = {},
  ) {
    if (!this.csrf) await this.refreshCsrf();
    let req = this.agent[method](path)
      .set('x-test-ip', this.ip)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', this.csrf);
    for (const [name, value] of Object.entries(headers)) req = req.set(name, value);
    const res = await req.send(body);
    // Las respuestas que crean o rotan la sesión traen el token CSRF nuevo.
    const token = (res.body as { csrfToken?: unknown }).csrfToken;
    if (typeof token === 'string') this.csrf = token;
    return res;
  }

  post(path: string, body: object = {}, headers: Record<string, string> = {}) {
    return this.send('post', path, body, headers);
  }

  delete(path: string) {
    return this.send('delete', path);
  }

  patch(path: string, body: object = {}) {
    return this.send('patch', path, body);
  }

  /** M8: las ediciones del admin reemplazan el recurso completo. */
  put(path: string, body: object = {}) {
    return this.send('put', path, body);
  }
}

/** Token del último correo enviado a `to` (del enlace `#token=…`). */
export function lastEmailToken(api: TestApi, to: string): string {
  const message = [...api.email.sent].reverse().find((m) => m.to === to);
  const token = message ? /#token=([A-Za-z0-9_-]{43})/.exec(message.text)?.[1] : undefined;
  if (!token) throw new Error(`No hay correo con enlace para ${to}`);
  return token;
}

/**
 * Como `lastEmailToken`, pero espera un poco: el correo puede estar enviándolo el worker de otra
 * API de prueba que lo tomó primero (comparten la base).
 */
export async function waitForEmailToken(api: TestApi, to: string): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      return lastEmailToken(api, to);
    } catch {
      await api.outbox.kick();
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  return lastEmailToken(api, to);
}

/** Registra, envía el correo y (opcionalmente) verifica. Devuelve el navegador sin sesión. */
export async function registerUser(
  api: TestApi,
  options: { email?: string; locale?: 'es-CR' | 'en'; verify?: boolean; name?: string } = {},
): Promise<{ email: string; browser: Browser }> {
  const email = options.email ?? uniqueEmail();
  const browser = new Browser(api);
  const res = await browser.post('/api/auth/register', {
    name: options.name ?? 'Ana Prueba',
    email,
    password: PASSWORD,
    locale: options.locale ?? 'es-CR',
  });
  if (res.status !== 202)
    throw new Error(`Registro falló: ${String(res.status)} ${JSON.stringify(res.body)}`);
  await api.outbox.idle();
  await api.outbox.kick();
  if (options.verify) {
    await browser.post('/api/auth/verify-email', { token: await waitForEmailToken(api, email) });
  }
  return { email, browser };
}

/** Navegador con sesión iniciada. */
export async function signIn(api: TestApi, email: string, browser = new Browser(api)): Promise<Browser> {
  const res = await browser.post('/api/auth/login', { email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`Login falló: ${String(res.status)} ${JSON.stringify(res.body)}`);
  return browser;
}

/** Valor de una cookie en la respuesta, con sus atributos. */
export function setCookie(res: { headers: Record<string, unknown> }, name: string): string | undefined {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? (raw as string[]) : typeof raw === 'string' ? [raw] : [];
  return list.find((cookie) => cookie.startsWith(`${name}=`));
}
