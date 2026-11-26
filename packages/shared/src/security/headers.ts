/**
 * Cabeceras de seguridad de la web pública (ADR 0010, D-M10-5; R-M9-2).
 *
 * La CSP con los hashes de cada página va en un `<meta>` dentro de cada HTML (lo escribe
 * `apps/web/scripts/csp.ts` después del build). Aquí va lo que un `<meta>` no puede expresar
 * (`frame-ancestors`) y el resto de las cabeceras. Se aplican en dos lugares, con la misma lista:
 * - `_headers` de los assets (regla única `/*`), para lo que Cloudflare sirve sin invocar al Worker;
 * - el Worker, para lo que genera él (el fallback de la SPA), porque `_headers` no se le aplica.
 * El navegador aplica todas las CSP a la vez: un recurso tiene que pasar las dos.
 */
export const HEADER_CSP = [
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': HEADER_CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

/** Contenido de `_headers` para los assets de Cloudflare: una sola regla para todo el sitio. */
export function assetHeadersFile(): string {
  const lines = Object.entries(SECURITY_HEADERS).map(([name, value]) => `  ${name}: ${value}`);
  return ['/*', ...lines, ''].join('\n');
}
