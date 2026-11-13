import { describe, expect, it } from 'vitest';
import { sanitizeAuditData } from './audit.ts';

describe('sanitizador del AuditLog (§8.6, §11)', () => {
  it('deja solo los campos de la lista blanca y enmascara el correo', () => {
    expect(
      sanitizeAuditData('user', {
        email: 'ana.mora@correo.cr',
        name: 'Ana',
        roles: ['CUSTOMER', 'STAFF'],
        passwordHash: '$argon2id$…',
        tokenHash: 'abc',
        address: 'Barrio Escalante, casa 12',
        phone: '8888-8888',
      }),
    ).toEqual({ email: 'a***@correo.cr', name: 'Ana', roles: ['CUSTOMER', 'STAFF'] });
  });

  it('descarta objetos anidados y convierte fechas a ISO', () => {
    expect(
      sanitizeAuditData('user', { name: { nested: 'x' }, blocked: new Date('2026-11-13T12:00:00Z') }),
    ).toEqual({ name: null, blocked: '2026-11-13T12:00:00.000Z' });
  });

  it('null o ausente → null', () => {
    expect(sanitizeAuditData('user', null)).toBeNull();
    expect(sanitizeAuditData('user', undefined)).toBeNull();
  });
});
