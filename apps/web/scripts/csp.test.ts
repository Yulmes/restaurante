import { describe, expect, it } from 'vitest';
import {
  checkHtml,
  inlineHashes,
  policyFor,
  sha256,
  TURNSTILE_ORIGIN,
  withCsp,
  ZOD_SETUP_SCRIPT,
} from './csp.ts';

const PAGE = [
  '<!DOCTYPE html><html lang="es-CR"><head><meta charSet="utf-8"/><title>Carta</title>',
  '<style>.a{color:red}</style>',
  '<script type="application/ld+json">{"@type":"Menu"}</script>',
  '</head><body><div id="root"></div>',
  '<script>window.__reactRouterContext = {"basename":"/"};</script>',
  '<script type="module">import "/assets/manifest.js";</script>',
  '<script src="/assets/entry.js" type="module"></script>',
  '<script>window.__reactRouterContext = {"basename":"/"};</script>',
  '</body></html>',
].join('');

describe('CSP por página (D-M10-5)', () => {
  it('calcula los hashes de los scripts ejecutables en línea y de los estilos, sin JSON-LD ni externos', () => {
    const hashes = inlineHashes(PAGE);
    expect(hashes.scripts).toEqual([
      sha256('window.__reactRouterContext = {"basename":"/"};'),
      sha256('import "/assets/manifest.js";'),
    ]);
    expect(hashes.styles).toEqual([sha256('.a{color:red}')]);
  });

  it('el hash es el SHA-256 en base64 del contenido exacto', () => {
    // Valor conocido: sha256("alert(1)") en base64.
    expect(sha256('alert(1)')).toBe("'sha256-bhHHL3z2vDgxUt0W3dWQOrprscmda2Y5pLsLg4GF+pI='");
  });

  it('la política es estricta: sin unsafe-inline ni comodines, con Turnstile solo en script y frame', () => {
    const policy = policyFor(inlineHashes(PAGE));
    expect(policy).not.toContain('unsafe-inline');
    expect(policy).not.toContain('unsafe-eval');
    expect(policy).not.toMatch(/\*/);
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain(`frame-src ${TURNSTILE_ORIGIN}`);
    expect(policy).toContain("connect-src 'self'");
  });

  it('inserta el <meta> después del charset y antes de cualquier script; repetir no lo duplica', () => {
    const once = withCsp(PAGE);
    expect(once.indexOf('Content-Security-Policy')).toBeLessThan(once.indexOf('<script'));
    // El primer script es el de la configuración de Zod, con su hash en la política.
    expect(once.indexOf('<script')).toBe(once.indexOf(ZOD_SETUP_SCRIPT));
    const setupBody = ZOD_SETUP_SCRIPT.replace(/^<script>/, '').replace(/<\/script>$/, '');
    expect(once).toContain(sha256(setupBody));
    expect(once.indexOf('<meta charSet="utf-8"/>')).toBeLessThan(once.indexOf('Content-Security-Policy'));
    expect(withCsp(once)).toBe(once);
    expect(checkHtml(once)).toEqual([]);
  });

  it('la verificación detecta una página sin <meta>, un script nuevo y un script cambiado', () => {
    expect(checkHtml(PAGE)).toEqual(['sin <meta> de CSP']);
    const processed = withCsp(PAGE);
    const added = processed.replace('</body>', '<script>evil()</script></body>');
    expect(checkHtml(added)).toEqual(['los hashes no coinciden con los scripts de la página']);
    const changed = processed.replace('"basename":"/"', '"basename":"/x"');
    expect(checkHtml(changed)).toEqual(['los hashes no coinciden con los scripts de la página']);
  });

  it('la verificación detecta un <meta> repetido o puesto después de un script', () => {
    const processed = withCsp(PAGE);
    const meta = /<meta http-equiv="Content-Security-Policy"[^>]*>/.exec(processed)?.[0] ?? 'sin-meta';
    expect(checkHtml(processed.replace('</head>', `${meta}</head>`))).toEqual(['más de un <meta> de CSP']);
    const late = processed.replace(meta, '').replace('</body>', `${meta}</body>`);
    expect(checkHtml(late)).toContain('el <meta> de CSP va después de un script');
  });
});
