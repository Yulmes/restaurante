import { describe, expect, it } from 'vitest';
import { publicUserSchema } from '../auth/schemas.ts';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, isLocale, localeSchema, resolveLocale } from './locales.ts';

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

  it('resolveLocale conserva un idioma válido y cae en es-CR ante cualquier otro valor (M3)', () => {
    expect(resolveLocale('es-CR')).toBe('es-CR');
    expect(resolveLocale('en')).toBe('en');
    for (const value of ['fr', 'EN', 'es_CR', '', null, undefined, 42, {}]) {
      expect(resolveLocale(value)).toBe(DEFAULT_LOCALE);
    }
  });

  it('una preferencia inválida en el usuario se lee como es-CR, sin invalidar el resto', () => {
    const user = {
      id: '0b8f7a7e-1b1e-4c55-9a59-1d2f3a4b5c6d',
      name: 'Ana',
      email: 'ana@x.cr',
      phone: null,
      emailVerified: true,
      roles: ['CUSTOMER'],
    };
    expect(publicUserSchema.parse({ ...user, locale: 'fr' }).locale).toBe('es-CR');
    expect(publicUserSchema.parse({ ...user, locale: undefined }).locale).toBe('es-CR');
    expect(publicUserSchema.parse({ ...user, locale: 'en' }).locale).toBe('en');
  });
});
