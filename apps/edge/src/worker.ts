import { SECURITY_HEADERS } from '@marea-baja/shared';

/**
 * Worker de Marea Baja (M10, ADR 0010; §5).
 *
 * - **Assets:** Cloudflare sirve el HTML prerenderizado y los archivos sin invocar al Worker
 *   (`run_worker_first` solo incluye `/api/*`). Si no hay archivo, entra aquí: las rutas de la SPA
 *   reciben `__spa-fallback.html` (como `apps/web/scripts/serve-build.ts`), y los archivos que no
 *   existen, 404.
 * - **`/api/*` (D-M10-2):** proxy a la API de Render. Borra todo lo que el cliente haya mandado como
 *   IP o secreto, pone `X-Client-IP` con la IP que entrega Cloudflare en `CF-Connecting-IP` y agrega
 *   `X-Origin-Auth`. Nunca devuelve el secreto ni lo registra.
 * - **Cron Trigger cada 30 min (D-M10-1):** `POST /api/internal/tasks` con el secreto de origen y el
 *   de tareas. Registra solo el estado y los conteos.
 */
export interface Env {
  /** Origen de la API en Render, `https://….onrender.com`. */
  API_ORIGIN: string;
  /** Secreto de origen actual (la API acepta además el siguiente, para rotar). */
  ORIGIN_SECRET: string;
  /** Secreto del endpoint interno de tareas. */
  TASKS_SECRET: string;
  ASSETS: { fetch: (request: Request) => Promise<Response> };
}

/** Lo que el cliente nunca puede fijar: la API solo confía en lo que pone este Worker. */
export const UNTRUSTED_REQUEST_HEADERS = [
  'x-client-ip',
  'x-origin-auth',
  'x-tasks-auth',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
  'forwarded',
  'true-client-ip',
  'cf-connecting-ip',
  'cf-connecting-ipv6',
  'x-request-id',
  // Propias de la conexión.
  'connection',
  'keep-alive',
  'proxy-connection',
  'transfer-encoding',
  'upgrade',
  'te',
  'host',
];

/** IP de las invocaciones del Cron Trigger (no hay cliente). Válida para la API y fácil de reconocer. */
export const CRON_CLIENT_IP = '0.0.0.0';

export const SPA_FALLBACK_PATH = '/__spa-fallback';

function apiBase(env: Env): URL | null {
  try {
    const url = new URL(env.API_ORIGIN);
    return url.protocol === 'https:' || url.hostname === '127.0.0.1' || url.hostname === 'localhost'
      ? url
      : null;
  } catch {
    return null;
  }
}

function plain(status: number, text: string): Response {
  return new Response(text, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      ...SECURITY_HEADERS,
    },
  });
}

export async function proxyApi(request: Request, env: Env): Promise<Response> {
  const base = apiBase(env);
  if (!base || !env.ORIGIN_SECRET) return plain(503, 'Service unavailable');
  const clientIp = request.headers.get('cf-connecting-ip');
  if (!clientIp) return plain(400, 'Bad request');

  const incoming = new URL(request.url);
  const target = new URL(`${incoming.pathname}${incoming.search}`, base);
  const headers = new Headers(request.headers);
  for (const name of UNTRUSTED_REQUEST_HEADERS) headers.delete(name);
  headers.set('x-client-ip', clientIp);
  headers.set('x-origin-auth', env.ORIGIN_SECRET);
  headers.set('x-request-id', crypto.randomUUID());

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  try {
    return await fetch(target, {
      method: request.method,
      headers,
      ...(hasBody ? { body: request.body, duplex: 'half' } : {}),
      redirect: 'manual',
    });
  } catch {
    // Sin detalles: ni la URL de Render ni el error del runtime.
    return plain(502, 'Bad gateway');
  }
}

/** Rutas de la SPA sin archivo (cuenta, pedido, admin…): el fallback, con las cabeceras de seguridad. */
export async function spaFallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const lastSegment = url.pathname.split('/').pop() ?? '';
  // Un archivo que no existe (con extensión) es 404; una ruta de la app, el fallback.
  if (lastSegment.includes('.')) return plain(404, 'Not found');
  if (request.method !== 'GET' && request.method !== 'HEAD') return plain(405, 'Method not allowed');
  const asset = await env.ASSETS.fetch(
    new Request(new URL(SPA_FALLBACK_PATH, url), { method: request.method }),
  );
  if (!asset.ok) return plain(404, 'Not found');
  const response = new Response(asset.body, { status: 200, headers: asset.headers });
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, value);
  response.headers.set('cache-control', 'no-cache');
  return response;
}

export interface TasksRunLog {
  status: number;
  ok: boolean;
  report?: unknown;
}

/** D-M10-1: una vuelta de tareas. Lanza si falla, para que el cron quede marcado como fallido. */
export async function runTasks(env: Env): Promise<TasksRunLog> {
  const base = apiBase(env);
  if (!base || !env.ORIGIN_SECRET || !env.TASKS_SECRET) throw new Error('tasks: configuración incompleta');
  const response = await fetch(new URL('/api/internal/tasks', base), {
    method: 'POST',
    headers: {
      'x-origin-auth': env.ORIGIN_SECRET,
      'x-tasks-auth': env.TASKS_SECRET,
      'x-client-ip': CRON_CLIENT_IP,
      'x-request-id': crypto.randomUUID(),
    },
  });
  const report: unknown = await response.json().catch(() => undefined);
  // El informe es solo de conteos (la API no devuelve datos); el secreto nunca se registra.
  const log: TasksRunLog = { status: response.status, ok: response.ok, report };
  console.log(JSON.stringify({ event: 'internal-tasks', ...log }));
  if (!response.ok) throw new Error(`tasks: la API respondió ${String(response.status)}`);
  return log;
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/api' || pathname.startsWith('/api/')) return proxyApi(request, env);
    return spaFallback(request, env);
  },

  async scheduled(_controller: unknown, env: Env): Promise<void> {
    await runTasks(env);
  },
};

export default worker;
