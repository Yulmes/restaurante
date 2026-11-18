/**
 * Sirve el build de producción como lo hará el hosting estático (M10, §5): archivos de
 * `build/client`, el `index.html` prerenderizado de cada ruta, el fallback SPA para el resto y
 * `/api/*` en el mismo origen (proxy a `API_PROXY_TARGET`). Solo para pruebas y revisión local:
 *
 *   npm run preview -w @marea-baja/web      HTTP/1.1 sin TLS, http://127.0.0.1:4173 (referencia histórica)
 *   npm run preview:h2 -w @marea-baja/web   HTTP/2 con TLS, https://127.0.0.1:4173 (como el CDN)
 *
 * Variables: PORT, API_PROXY_TARGET. Los dos modos sirven los mismos archivos, con la misma
 * compresión, el mismo fallback y el mismo proxy: solo cambia el transporte. El modo HTTP/2 no
 * acepta HTTP/1.1 (sin respaldo silencioso) y usa el certificado local de `dev-cert.ts`.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, request, type IncomingMessage, type ServerResponse } from 'node:http';
import { createSecureServer, type Http2ServerRequest } from 'node:http2';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { constants, createBrotliCompress, createGzip } from 'node:zlib';
import { ensureDevCert } from './dev-cert.ts';

const COMPRESSIBLE = /^(text\/|application\/(json|xml)|image\/svg\+xml)/;

const ROOT = fileURLToPath(new URL('../build/client/', import.meta.url));
const PORT = Number(process.env['PORT'] ?? 4173);
const API = new URL(process.env['API_PROXY_TARGET'] ?? 'http://127.0.0.1:3000');
const HTTP2 = process.argv.includes('--http2');

// Encabezados propios de la conexión: HTTP/2 los prohíbe, así que en ese modo no se reenvían.
const CONNECTION_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'transfer-encoding',
  'upgrade',
  'te',
]);

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.data': 'text/x-script; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

type Req = IncomingMessage | Http2ServerRequest;
// La API de compatibilidad de http2 replica la de http: se usa como ServerResponse.
type Res = ServerResponse;

function resolveFile(pathname: string): string | null {
  const safe = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  const candidates = [join(ROOT, safe), join(ROOT, safe, 'index.html')];
  for (const candidate of candidates) {
    // Nunca fuera de build/client.
    if (!candidate.startsWith(ROOT.endsWith(sep) ? ROOT : `${ROOT}${sep}`)) continue;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function proxyHeaders(req: Req): Record<string, string | string[] | undefined> {
  if (!HTTP2) return req.headers;
  // HTTP/2: sin pseudo-encabezados (`:path`, …); `:authority` pasa a ser `host`, como en HTTP/1.1.
  const headers = Object.fromEntries(
    Object.entries(req.headers).filter(([k]) => !k.startsWith(':') && !CONNECTION_HEADERS.has(k)),
  );
  return { ...headers, host: String(req.headers[':authority'] ?? req.headers.host ?? '') };
}

function handler(req: Req, res: Res): void {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    const upstream = request(
      {
        hostname: API.hostname,
        port: API.port,
        path: req.url,
        method: req.method,
        headers: proxyHeaders(req),
      },
      (response) => {
        const headers = HTTP2
          ? Object.fromEntries(Object.entries(response.headers).filter(([k]) => !CONNECTION_HEADERS.has(k)))
          : response.headers;
        res.writeHead(response.statusCode ?? 502, headers);
        response.pipe(res);
      },
    );
    upstream.on('error', () => {
      res.writeHead(502).end();
    });
    (req as IncomingMessage).pipe(upstream);
    return;
  }
  const file = resolveFile(url.pathname) ?? join(ROOT, '__spa-fallback.html');
  const type = TYPES[extname(file)] ?? 'application/octet-stream';
  // Como el hosting (Cloudflare comprime HTML, JS, CSS y JSON): Brotli o gzip según el navegador.
  // Sin esto, Lighthouse mide bytes sin comprimir que en producción no existen.
  const accept = req.headers['accept-encoding'] ?? '';
  const encoding = COMPRESSIBLE.test(type)
    ? accept.includes('br')
      ? 'br'
      : accept.includes('gzip')
        ? 'gzip'
        : null
    : null;
  res.writeHead(200, {
    'content-type': type,
    vary: 'accept-encoding',
    ...(encoding ? { 'content-encoding': encoding } : {}),
  });
  const stream = createReadStream(file);
  // Calidad 5: la habitual para comprimir al vuelo (la 11 por defecto es lenta y retrasa la hidratación).
  if (encoding === 'br')
    stream.pipe(createBrotliCompress({ params: { [constants.BROTLI_PARAM_QUALITY]: 5 } })).pipe(res);
  else if (encoding === 'gzip') stream.pipe(createGzip()).pipe(res);
  else stream.pipe(res);
}

const server = HTTP2
  ? await (async () => {
      const tls = await ensureDevCert();
      // allowHTTP1: false → un cliente sin HTTP/2 no se conecta (no hay respaldo silencioso).
      return createSecureServer({ key: tls.key, cert: tls.cert, allowHTTP1: false }, (req, res) => {
        handler(req, res as unknown as Res);
      }).on('session', (session) => {
        const alpn = (session.socket as { alpnProtocol?: string | false }).alpnProtocol;
        if (alpn !== 'h2') console.warn(`Sesión con protocolo inesperado: ${String(alpn)}`);
      });
    })()
  : createServer(handler);

server.listen(PORT, '127.0.0.1', () => {
  const origin = `${HTTP2 ? 'https' : 'http'}://127.0.0.1:${String(PORT)}`;
  console.log(
    `Build servido en ${origin} con ${HTTP2 ? 'HTTP/2 (TLS local)' : 'HTTP/1.1'} (API: ${API.origin})`,
  );
});
