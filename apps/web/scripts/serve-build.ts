/**
 * Sirve el build de producción como lo hará el hosting estático (M10, §5): archivos de
 * `build/client`, el `index.html` prerenderizado de cada ruta, el fallback SPA para el resto y
 * `/api/*` en el mismo origen (proxy a `API_PROXY_TARGET`). Solo para pruebas y revisión local:
 *
 *   npm run preview -w @marea-baja/web     (PORT, API_PROXY_TARGET)
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { constants, createBrotliCompress, createGzip } from 'node:zlib';

const COMPRESSIBLE = /^(text\/|application\/(json|xml)|image\/svg\+xml)/;

const ROOT = fileURLToPath(new URL('../build/client/', import.meta.url));
const PORT = Number(process.env['PORT'] ?? 4173);
const API = new URL(process.env['API_PROXY_TARGET'] ?? 'http://127.0.0.1:3000');

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

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    const upstream = request(
      { hostname: API.hostname, port: API.port, path: req.url, method: req.method, headers: req.headers },
      (response) => {
        res.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(res);
      },
    );
    upstream.on('error', () => {
      res.writeHead(502).end();
    });
    req.pipe(upstream);
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
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Build servido en http://127.0.0.1:${String(PORT)} (API: ${API.origin})`);
});
