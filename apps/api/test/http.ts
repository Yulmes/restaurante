/**
 * Ayudas para las pruebas de integración de la API (Supertest + PostgreSQL real, §11).
 * Cada prueba usa correos e IP únicos, así los límites y los datos no se cruzan entre casos.
 */
import { randomUUID } from 'node:crypto';
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
}

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    production: false,
    webOrigin: WEB_ORIGIN,
    publicWebUrl: WEB_ORIGIN,
    appSecret: 'clave-de-pruebas-de-al-menos-32-caracteres',
    emailFrom: 'Marea Baja <no-reply@marea-baja.test>',
    turnstileDefaults: { threshold: 50, windowMinutes: 60 },
    ...overrides,
  };
}

export interface TestApi {
  app: ReturnType<typeof createApp>['app'];
  outbox: ReturnType<typeof createApp>['outbox'];
  db: PrismaClient;
  clock: TestClock;
  email: MemoryEmailProvider;
  logs: string[];
  close(): Promise<void>;
}

export function buildApi(options: { config?: Partial<AppConfig>; extraRoutes?: Router } = {}): TestApi {
  const db = createPrismaClient(appUrl());
  const clock = new TestClock();
  const email = new MemoryEmailProvider();
  const logs: string[] = [];
  const logger = createLogger({ level: 'info' }, { write: (line: string) => logs.push(line) });
  const { app, outbox } = createApp({
    config: testConfig(options.config),
    db,
    logger,
    clock,
    email,
    botCheck: new FakeBotCheck(),
    clientIp: (req) => req.get('x-test-ip') ?? '198.51.100.1',
    ...(options.extraRoutes ? { extraRoutes: options.extraRoutes } : {}),
  });
  return { app, outbox, db, clock, email, logs, close: () => db.$disconnect() };
}

let ipCounter = 0;
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

  async send(method: 'post' | 'patch', path: string, body: object = {}) {
    if (!this.csrf) await this.refreshCsrf();
    const res = await this.agent[method](path)
      .set('x-test-ip', this.ip)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', this.csrf)
      .send(body);
    // Las respuestas que crean o rotan la sesión traen el token CSRF nuevo.
    const token = (res.body as { csrfToken?: unknown }).csrfToken;
    if (typeof token === 'string') this.csrf = token;
    return res;
  }

  post(path: string, body: object = {}) {
    return this.send('post', path, body);
  }

  patch(path: string, body: object = {}) {
    return this.send('patch', path, body);
  }
}

/** Token del último correo enviado a `to` (del enlace `#token=…`). */
export function lastEmailToken(api: TestApi, to: string): string {
  const message = [...api.email.sent].reverse().find((m) => m.to === to);
  const token = message ? /#token=([A-Za-z0-9_-]{43})/.exec(message.text)?.[1] : undefined;
  if (!token) throw new Error(`No hay correo con enlace para ${to}`);
  return token;
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
    await browser.post('/api/auth/verify-email', { token: lastEmailToken(api, email) });
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
