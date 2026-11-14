import { describe, expect, it } from 'vitest';
import {
  emailTokenSchema,
  loginRequestSchema,
  registerRequestSchema,
  updateProfileRequestSchema,
} from './schemas.ts';

const codes = (result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) => Object.fromEntries((result.error?.issues ?? []).map((i) => [i.path.join('.'), i.message]));

describe('contratos de identidad', () => {
  it('normaliza el correo (espacios y mayúsculas) para el único lower(email)', () => {
    const parsed = registerRequestSchema.parse({
      name: '  Ana  ',
      email: '  Ana.Mora@Correo.CR ',
      password: 'doce-caracteres',
      locale: 'en',
    });
    expect(parsed).toEqual({
      name: 'Ana',
      email: 'ana.mora@correo.cr',
      password: 'doce-caracteres',
      locale: 'en',
    });
  });

  it('devuelve códigos de error traducibles por campo', () => {
    expect(
      codes(registerRequestSchema.safeParse({ name: '', email: 'no', password: 'corta', locale: 'fr' })),
    ).toEqual({
      name: 'required',
      email: 'invalidEmail',
      password: 'passwordTooShort',
      locale: expect.any(String) as string,
    });
  });

  it('exige 12 caracteres como mínimo y 128 como máximo, sin reglas de composición', () => {
    const base = { name: 'A', email: 'a@b.cr', locale: 'es-CR' };
    expect(registerRequestSchema.safeParse({ ...base, password: 'a'.repeat(11) }).success).toBe(false);
    expect(registerRequestSchema.safeParse({ ...base, password: 'solo letras min' }).success).toBe(true);
    expect(registerRequestSchema.safeParse({ ...base, password: 'a'.repeat(129) }).success).toBe(false);
  });

  it('el login no aplica la política: solo exige algo que comparar', () => {
    expect(loginRequestSchema.safeParse({ email: 'a@b.cr', password: 'x' }).success).toBe(true);
    expect(loginRequestSchema.safeParse({ email: 'a@b.cr', password: '' }).success).toBe(false);
  });

  it('los tokens de los enlaces son 32 bytes en base64url', () => {
    expect(emailTokenSchema.safeParse('A'.repeat(43)).success).toBe(true);
    expect(emailTokenSchema.safeParse('A'.repeat(42)).success).toBe(false);
    expect(emailTokenSchema.safeParse(`${'A'.repeat(42)}=`).success).toBe(false);
  });

  it('teléfono opcional: vacío → null; formato inválido → invalidPhone', () => {
    expect(updateProfileRequestSchema.parse({ name: 'A', phone: '', locale: 'en' }).phone).toBeNull();
    expect(updateProfileRequestSchema.parse({ name: 'A', phone: '+506 8888-8888', locale: 'en' }).phone).toBe(
      '+506 8888-8888',
    );
    expect(codes(updateProfileRequestSchema.safeParse({ name: 'A', phone: 'abc', locale: 'en' }))).toEqual({
      phone: 'invalidPhone',
    });
  });
});
