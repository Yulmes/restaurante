/**
 * Archivos de SEO del build (§4.2), después de `react-router build`:
 * - `sitemap.xml` con las rutas prerenderizadas de los dos idiomas y sus alternativas
 *   `xhtml:link` (es-CR, en, x-default);
 * - `robots.txt`, que bloquea cuenta, pedido, admin y el sistema de diseño en los dos idiomas;
 * - `catalog-version.json`, la versión publicada que el rebuild programado (D10, M10) compara
 *   con `GET /api/public/catalog-version`;
 * - `noindex` en el HTML del fallback SPA (cuenta, sistema de diseño): su `meta` solo se aplica al
 *   hidratar, y los buscadores leen el HTML crudo (§4.2).
 * Origen público: `VITE_SITE_URL` (M10); en local, el de Vite.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { catalogApiBase, fetchCatalogForBuild, publicPaths } from '../app/site/public-paths.ts';

const OUT = fileURLToPath(new URL('../build/client/', import.meta.url));
const SITE = (process.env['VITE_SITE_URL'] ?? 'http://127.0.0.1:5173').replace(/\/+$/, '');

const escapeXml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const DISALLOWED = [
  '/cuenta',
  '/en/account',
  '/pedido',
  '/en/order',
  '/admin',
  '/en/admin',
  '/_design',
  '/en/_design',
] as const;

export function sitemapXml(paths: ReturnType<typeof publicPaths>, site: string): string {
  const urls = paths.flatMap((path) =>
    [path.es, path.en].map((loc) => {
      const alternates = [
        ['es-CR', path.es],
        ['en', path.en],
        ['x-default', path.es],
      ]
        .map(
          ([lang, href]) =>
            `    <xhtml:link rel="alternate" hreflang="${lang ?? ''}" href="${escapeXml(`${site}${href ?? ''}`)}"/>`,
        )
        .join('\n');
      return `  <url>\n    <loc>${escapeXml(`${site}${loc}`)}</loc>\n${alternates}\n  </url>`;
    }),
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`;
}

/** Agrega `<meta name="robots" content="noindex">` al `<head>` si todavía no lo tiene. */
export function withNoindex(html: string): string {
  if (html.includes('<meta name="robots"')) return html;
  return html.replace('<head>', '<head><meta name="robots" content="noindex"/>');
}

export function robotsTxt(site: string): string {
  return [
    'User-agent: *',
    ...DISALLOWED.map((path) => `Disallow: ${path}`),
    '',
    `Sitemap: ${site}/sitemap.xml`,
    '',
  ].join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const catalog = await fetchCatalogForBuild(catalogApiBase());
  const paths = publicPaths(catalog);
  writeFileSync(`${OUT}sitemap.xml`, sitemapXml(paths, SITE));
  writeFileSync(`${OUT}robots.txt`, robotsTxt(SITE));
  writeFileSync(`${OUT}catalog-version.json`, `${JSON.stringify({ version: catalog.version })}\n`);
  const fallback = `${OUT}__spa-fallback.html`;
  writeFileSync(fallback, withNoindex(readFileSync(fallback, 'utf8')));
  console.log(
    `SEO: ${String(paths.length * 2)} URL en el sitemap, robots.txt y catalog-version ${catalog.version}.`,
  );
}
