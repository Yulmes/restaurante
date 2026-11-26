/**
 * CSP con hashes por página (ADR 0010, D-M10-5; R-M9-2). Corre después del build:
 *
 *   node scripts/csp.ts           inserta el <meta> en cada HTML y escribe `_headers`
 *   node scripts/csp.ts --check   verifica que cada HTML tenga su <meta> al día (CI)
 *
 * Por qué así:
 * - cada página prerenderizada trae sus propios scripts en línea (el contexto de React Router, el
 *   `streamController` de esa ruta, el import del módulo…). Sus hashes cambian por página y por
 *   build: nunca se escriben a mano;
 * - `_headers` de Cloudflare admite 100 reglas y la carta crece con cada plato en dos idiomas, así
 *   que los hashes van en un `<meta http-equiv>` dentro de cada HTML, y `_headers` lleva una sola
 *   regla `/*` con lo que un `<meta>` no puede expresar (`frame-ancestors`, ver `SECURITY_HEADERS`);
 * - JSON-LD (`application/ld+json`) no se ejecuta: no necesita hash.
 *
 * Límites de la CSP en `<meta>` (documentados en SECURITY.md): no admite `frame-ancestors`,
 * `report-uri` ni la variante `Report-Only`, y solo rige desde donde aparece. Por eso va primero en
 * `<head>`, después del `charset`. La validación es la E2E `e2e/produccion/csp.spec.ts`, que falla
 * con cualquier violación.
 *
 * Emergencia: `CSP_META=off` genera el build sin el `<meta>` (sigue `_headers`). Ver DEPLOYMENT.md.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assetHeadersFile } from '@marea-baja/shared';

export const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';

/**
 * Zod 4 decide si compila validadores (`new Function`) al **definir** cada esquema de objeto, o
 * sea, al cargar los módulos. Con la CSP estricta, el navegador reporta esa prueba como violación
 * aunque Zod la atrape. Zod lee `globalThis.__zod_globalConfig` al cargarse: este script clásico, en
 * `<head>`, corre antes que cualquier módulo y le pide no compilar (`jitless`; la validación es la
 * misma). Va con su hash, como el resto.
 */
export const ZOD_SETUP_SCRIPT =
  '<script>globalThis.__zod_globalConfig=Object.assign(globalThis.__zod_globalConfig||{},{jitless:true});</script>';
const EXECUTABLE_TYPES = new Set(['', 'module', 'text/javascript', 'application/javascript']);
const META_PATTERN = /<meta http-equiv="Content-Security-Policy" content="[^"]*"\s*\/?>/gi;
const SCRIPT_PATTERN = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const STYLE_PATTERN = /<style\b([^>]*)>([\s\S]*?)<\/style>/gi;

export function sha256(content: string): string {
  return `'sha256-${createHash('sha256').update(content, 'utf8').digest('base64')}'`;
}

function attr(attrs: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attrs);
  if (!match) return null;
  return match[2] ?? match[3] ?? match[4] ?? '';
}

/** Hashes de los scripts ejecutables en línea y de los `<style>` en línea, en orden de aparición. */
export function inlineHashes(html: string): { scripts: string[]; styles: string[] } {
  const withoutMeta = html.replace(META_PATTERN, '');
  const scripts: string[] = [];
  for (const [, attrs = '', body = ''] of withoutMeta.matchAll(SCRIPT_PATTERN)) {
    if (attr(attrs, 'src') !== null) continue;
    const type = (attr(attrs, 'type') ?? '').trim().toLowerCase();
    if (!EXECUTABLE_TYPES.has(type)) continue;
    scripts.push(sha256(body));
  }
  const styles = [...withoutMeta.matchAll(STYLE_PATTERN)].map(([, , body = '']) => sha256(body));
  return { scripts: unique(scripts), styles: unique(styles) };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/** La política de la página. Turnstile solo hace falta en el login, que es parte de la SPA. */
export function policyFor(hashes: { scripts: string[]; styles: string[] }): string {
  return [
    "default-src 'self'",
    ['script-src', "'self'", ...hashes.scripts, TURNSTILE_ORIGIN].join(' '),
    ['style-src', "'self'", ...hashes.styles].join(' '),
    "img-src 'self' data:",
    // Vite incrusta como `data:` los subconjuntos tipográficos pequeños (el signo de colón, M1).
    "font-src 'self' data:",
    "connect-src 'self'",
    `frame-src ${TURNSTILE_ORIGIN}`,
    "manifest-src 'self'",
    "worker-src 'none'",
  ].join('; ');
}

export function metaTag(policy: string): string {
  return `<meta http-equiv="Content-Security-Policy" content="${policy}"/>`;
}

function insertAfterCharset(html: string, fragment: string): string {
  const charset = /<meta charset="utf-8"\s*\/?>/i.exec(html);
  const anchor = charset ?? /<head[^>]*>/i.exec(html);
  if (!anchor) throw new Error('HTML sin <head>');
  const at = anchor.index + anchor[0].length;
  return `${html.slice(0, at)}${fragment}${html.slice(at)}`;
}

/**
 * Inserta (o reemplaza) el `<meta>` y el script de configuración de Zod justo después del
 * `charset`, antes de cualquier otro script. Los hashes se calculan sobre el HTML ya con el script.
 */
export function withCsp(html: string): string {
  const clean = html.replace(META_PATTERN, '').replaceAll(ZOD_SETUP_SCRIPT, '');
  const withSetup = insertAfterCharset(clean, ZOD_SETUP_SCRIPT);
  return insertAfterCharset(withSetup, metaTag(policyFor(inlineHashes(withSetup))));
}

/** Problemas de una página ya procesada: sin `<meta>`, repetido, después de un script o desactualizado. */
export function checkHtml(html: string): string[] {
  const metas = [...html.matchAll(META_PATTERN)];
  const [meta] = metas;
  if (!meta) return ['sin <meta> de CSP'];
  if (metas.length > 1) return ['más de un <meta> de CSP'];
  const metaAt = meta.index;
  const firstScript = html.search(/<script\b/i);
  const problems: string[] = [];
  if (firstScript !== -1 && firstScript < metaAt) problems.push('el <meta> de CSP va después de un script');
  if (html.indexOf(ZOD_SETUP_SCRIPT) !== firstScript)
    problems.push('falta el script de Zod antes de los demás');
  const expected = metaTag(policyFor(inlineHashes(html)));
  if (meta[0] !== expected) problems.push('los hashes no coinciden con los scripts de la página');
  return problems;
}

export function htmlFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return htmlFiles(path);
    return name.endsWith('.html') ? [path] : [];
  });
}

function main(): void {
  const root = fileURLToPath(new URL('../build/client/', import.meta.url));
  const files = htmlFiles(root);
  if (files.length === 0) throw new Error('No hay HTML en build/client: corré el build primero.');

  if (process.argv.includes('--check')) {
    const failures = files.flatMap((file) =>
      checkHtml(readFileSync(file, 'utf8')).map((problem) => `${file.slice(root.length)}: ${problem}`),
    );
    if (failures.length > 0) {
      console.error(`CSP: ${String(failures.length)} problema(s):\n${failures.join('\n')}`);
      process.exit(1);
    }
    console.log(`CSP: ${String(files.length)} HTML con su <meta> al día.`);
    return;
  }

  writeFileSync(join(root, '_headers'), assetHeadersFile());
  if (process.env['CSP_META'] === 'off') {
    console.warn('CSP: CSP_META=off, se omite el <meta> (modo de emergencia).');
    return;
  }
  for (const file of files) writeFileSync(file, withCsp(readFileSync(file, 'utf8')));
  console.log(`CSP: <meta> con hashes en ${String(files.length)} HTML y _headers escrito.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
