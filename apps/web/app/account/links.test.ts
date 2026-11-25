import { describe, expect, it } from 'vitest';
import { accountPathFor, safeNextPath, tokenFromHash } from './links.ts';

describe('idioma de la cuenta al iniciar sesión (M3)', () => {
  it('abre la cuenta en el idioma guardado', () => {
    expect(accountPathFor('es-CR')).toBe('/cuenta');
    expect(accountPathFor('en')).toBe('/en/account');
  });

  it('sin preferencia o con un valor inválido, abre la de es-CR', () => {
    for (const value of [undefined, null, '', 'fr', 'EN', 'es_CR'])
      expect(accountPathFor(value)).toBe('/cuenta');
  });
});

describe('destino después de iniciar sesión (M5)', () => {
  it('acepta solo páginas del pedido de este sitio', () => {
    expect(safeNextPath('/pedido/finalizar')).toBe('/pedido/finalizar');
    expect(safeNextPath('/en/order/checkout')).toBe('/en/order/checkout');
    expect(safeNextPath('/pedido')).toBe('/pedido');
    // M8: también las secciones del admin, del mismo sitio.
    expect(safeNextPath('/admin/carta')).toBe('/admin/carta');
    expect(safeNextPath('/en/admin/menu')).toBe('/en/admin/menu');
  });

  it('ignora otros orígenes, esquemas y rutas', () => {
    for (const value of [
      null,
      '',
      '//evil.example/pedido',
      'https://evil.example/pedido',
      '/\\evil.example',
      '/cuenta',
      '/pedido/../cuenta',
      '/admin/../cuenta',
      '//admin',
      '/administrador',
      'javascript:alert(1)',
      '/pedidos-falsos',
    ])
      expect(safeNextPath(value)).toBeNull();
  });
});

describe('token de los enlaces de correo', () => {
  it('acepta solo 43 caracteres base64url en #token=', () => {
    const token = 'A'.repeat(43);
    expect(tokenFromHash(`#token=${token}`)).toBe(token);
    expect(tokenFromHash('#token=corto')).toBeNull();
    expect(tokenFromHash('')).toBeNull();
  });
});
