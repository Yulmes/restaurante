import { describe, expect, it } from 'vitest';
import { localeFromPathname, pathForLocale } from './locale.ts';

describe('localeFromPathname', () => {
  it('usa es-CR para rutas sin prefijo', () => {
    expect(localeFromPathname('/')).toBe('es-CR');
    expect(localeFromPathname('/_design')).toBe('es-CR');
    expect(localeFromPathname('/english')).toBe('es-CR');
  });

  it('usa en para /en y sus subrutas', () => {
    expect(localeFromPathname('/en')).toBe('en');
    expect(localeFromPathname('/en/_design')).toBe('en');
  });
});

describe('pathForLocale', () => {
  it('lleva a la misma página en el otro idioma', () => {
    expect(pathForLocale('/_design', 'en')).toBe('/en/_design');
    expect(pathForLocale('/en/_design', 'es-CR')).toBe('/_design');
    expect(pathForLocale('/', 'en')).toBe('/en');
    expect(pathForLocale('/en', 'es-CR')).toBe('/');
  });

  it('no cambia la ruta si ya está en el idioma pedido', () => {
    expect(pathForLocale('/_design', 'es-CR')).toBe('/_design');
    expect(pathForLocale('/en/_design', 'en')).toBe('/en/_design');
  });
});
