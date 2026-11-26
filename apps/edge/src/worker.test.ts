import { SECURITY_HEADERS } from '@marea-baja/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { CRON_CLIENT_IP, runTasks, type Env } from './worker.ts';

/**
 * Pruebas del Worker con `fetch` y `ASSETS` simulados (ADR 0010, D-M10-2 y D-M10-1).
 *
 * Límite: lo que Cloudflare pone en `CF-Connecting-IP` antes de llegar al Worker no se puede probar
 * aquí. Estas pruebas parten de que ese valor es el de Cloudflare; la prueba real (un cliente que
 * manda su propio `CF-Connecting-IP` a la URL pública) está en docs/m10/POST_DEPLOY.md.
 */
const ORIGIN_SECRET = 'secreto-de-origen-de-prueba-con-32-caracteres';
const TASKS_SECRET = 'secreto-de-tareas-de-prueba-con-32-caracteres';

interface Captured {
  url: string;
  method: string;
  headers: Headers;
  body: string;
}

let captured: Captured[] = [];

function firstCall(): Captured {
  const call = captured[0];
  if (!call) throw new Error('no hubo ninguna llamada a la API');
  return call;
}
let upstream: () => Response | Promise<Response> = () => new Response('{"ok":true}', { status: 200 });

beforeEach(() => {
  captured = [];
  upstream = () => new Response('{"ok":true}', { status: 200 });
  vi.stubGlobal('fetch', async (input: URL | string, init: RequestInit = {}) => {
    const body = init.body ? await new Response(init.body).text() : '';
    captured.push({
      url: String(input),
      method: init.method ?? 'GET',
      headers: new Headers(init.headers),
      body,
    });
    return upstream();
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const assets = {
  fetch: vi.fn((request: Request) => {
    const { pathname } = new URL(request.url);
    if (pathname === '/__spa-fallback') {
      return Promise.resolve(
        new Response('<!doctype html><title>SPA</title>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }),
      );
    }
    return Promise.resolve(new Response('not found', { status: 404 }));
  }),
};

function env(overrides: Partial<Env> = {}): Env {
  return {
    API_ORIGIN: 'https://marea-baja-api.onrender.com',
    ORIGIN_SECRET,
    TASKS_SECRET,
    ASSETS: assets,
    ...overrides,
  };
}

const call = (input: string, init: RequestInit = {}, e = env()) =>
  worker.fetch(new Request(`https://marea-baja.workers.dev${input}`, init), e);

describe('proxy /api/* (D-M10-2)', () => {
  it('reenvía a la API con la IP de Cloudflare y el secreto de origen', async () => {
    const res = await call('/api/public/catalog?locale=es-CR', {
      headers: { 'cf-connecting-ip': '203.0.113.7', accept: 'application/json', cookie: 'a=b' },
    });
    expect(res.status).toBe(200);
    expect(captured).toHaveLength(1);
    const sent = firstCall();
    expect(sent.url).toBe('https://marea-baja-api.onrender.com/api/public/catalog?locale=es-CR');
    expect(sent.headers.get('x-client-ip')).toBe('203.0.113.7');
    expect(sent.headers.get('x-origin-auth')).toBe(ORIGIN_SECRET);
    expect(sent.headers.get('accept')).toBe('application/json');
    expect(sent.headers.get('cookie')).toBe('a=b');
    expect(sent.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('descarta las cabeceras de IP y de secreto que manda el cliente', async () => {
    await call('/api/auth/session', {
      headers: {
        'cf-connecting-ip': '2001:db8::7',
        'x-client-ip': '198.51.100.66',
        'x-origin-auth': 'falso',
        'x-tasks-auth': 'falso',
        'x-forwarded-for': '198.51.100.67, 198.51.100.68',
        'x-real-ip': '198.51.100.69',
        forwarded: 'for=198.51.100.70',
        'true-client-ip': '198.51.100.71',
        'x-request-id': '11111111-1111-4111-8111-111111111111',
      },
    });
    const sent = firstCall();
    expect(sent.headers.get('x-client-ip')).toBe('2001:db8::7');
    expect(sent.headers.get('x-origin-auth')).toBe(ORIGIN_SECRET);
    for (const name of ['x-tasks-auth', 'x-forwarded-for', 'x-real-ip', 'forwarded', 'true-client-ip']) {
      expect(sent.headers.get(name), name).toBeNull();
    }
    expect(sent.headers.get('x-request-id')).not.toBe('11111111-1111-4111-8111-111111111111');
    expect(JSON.stringify([...sent.headers])).not.toContain('198.51.100');
  });

  it('reenvía el método, el cuerpo y la respuesta (cookies incluidas) sin seguir redirecciones', async () => {
    upstream = () =>
      new Response('{"user":null}', {
        status: 201,
        headers: {
          'set-cookie': '__Host-mb_session=x; Path=/; Secure; HttpOnly',
          'content-type': 'application/json',
        },
      });
    const res = await call('/api/auth/login', {
      method: 'POST',
      body: '{"email":"a@b.c"}',
      headers: { 'cf-connecting-ip': '203.0.113.8', 'content-type': 'application/json' },
    });
    expect(captured[0]).toMatchObject({ method: 'POST', body: '{"email":"a@b.c"}' });
    expect(res.status).toBe(201);
    expect(res.headers.get('set-cookie')).toContain('__Host-mb_session');
  });

  it('sin la IP de Cloudflare no reenvía nada (400)', async () => {
    const res = await call('/api/auth/session', { headers: { 'x-client-ip': '203.0.113.9' } });
    expect(res.status).toBe(400);
    expect(captured).toHaveLength(0);
  });

  it('sin configuración, o con una API que no es https, responde 503 sin llamar', async () => {
    for (const e of [
      env({ API_ORIGIN: '' }),
      env({ ORIGIN_SECRET: '' }),
      env({ API_ORIGIN: 'http://api.example' }),
    ]) {
      const res = await call('/api/health', { headers: { 'cf-connecting-ip': '203.0.113.10' } }, e);
      expect(res.status).toBe(503);
    }
    expect(captured).toHaveLength(0);
  });

  it('si la API no responde, 502 sin detalles del origen', async () => {
    upstream = () => {
      throw new TypeError('connect failed to marea-baja-api.onrender.com');
    };
    const res = await call('/api/health', { headers: { 'cf-connecting-ip': '203.0.113.11' } });
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain('onrender');
    expect(text).not.toContain(ORIGIN_SECRET);
  });
});

describe('fallback de la SPA (D-M10-5)', () => {
  it('las rutas sin archivo reciben el fallback con las cabeceras de seguridad', async () => {
    const res = await call('/cuenta/ingresar');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<title>SPA</title>');
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) expect(res.headers.get(name)).toBe(value);
    expect(captured).toHaveLength(0);
  });

  it('un archivo que no existe es 404, no el fallback', async () => {
    expect((await call('/assets/no-existe.js')).status).toBe(404);
    expect((await call('/carta/no-existe.data')).status).toBe(404);
  });

  it('solo GET y HEAD', async () => {
    expect((await call('/cuenta', { method: 'POST' })).status).toBe(405);
  });
});

describe('Cron Trigger de tareas (D-M10-1)', () => {
  it('llama al endpoint interno con los dos secretos y la IP de las invocaciones internas', async () => {
    upstream = () => new Response('{"ok":true,"sweep":{"ok":true,"expired":1}}', { status: 200 });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await worker.scheduled({}, env());
    const sent = firstCall();
    expect(sent.url).toBe('https://marea-baja-api.onrender.com/api/internal/tasks');
    expect(sent.method).toBe('POST');
    expect(sent.headers.get('x-origin-auth')).toBe(ORIGIN_SECRET);
    expect(sent.headers.get('x-tasks-auth')).toBe(TASKS_SECRET);
    expect(sent.headers.get('x-client-ip')).toBe(CRON_CLIENT_IP);
    // El log lleva el estado y los conteos, nunca los secretos.
    const logged = log.mock.calls.map((args) => String(args[0])).join('\n');
    expect(logged).toContain('"expired":1');
    expect(logged).not.toContain(ORIGIN_SECRET);
    expect(logged).not.toContain(TASKS_SECRET);
  });

  it('si la API falla, el cron queda marcado como fallido', async () => {
    upstream = () => new Response('{"ok":false}', { status: 500 });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await expect(runTasks(env())).rejects.toThrow('500');
  });

  it('sin secretos no llama', async () => {
    await expect(runTasks(env({ TASKS_SECRET: '' }))).rejects.toThrow('configuración');
    expect(captured).toHaveLength(0);
  });
});
