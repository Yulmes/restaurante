import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, isLocale, localeSchema } from './locales.ts';

describe('locales', () => {
  it('soporta exactamente es-CR y en', () => {
    expect(SUPPORTED_LOCALES).toEqual(['es-CR', 'en']);
  });

  it('usa es-CR como idioma predeterminado', () => {
    expect(DEFAULT_LOCALE).toBe('es-CR');
    expect(SUPPORTED_LOCALES).toContain(DEFAULT_LOCALE);
  });

  it('reconoce los idiomas soportados', () => {
    expect(isLocale('es-CR')).toBe(true);
    expect(isLocale('en')).toBe(true);
  });

  it('rechaza idiomas no soportados y valores que no son texto', () => {
    for (const value of ['es', 'es-cr', 'en-US', 'fr', '', null, undefined, 42]) {
      expect(isLocale(value)).toBe(false);
    }
    expect(localeSchema.safeParse('pt-BR').success).toBe(false);
  });
});
