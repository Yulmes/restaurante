import { describe, expect, it } from 'vitest';
import { createLogger, maskEmail } from './logger.ts';

function capture(): { lines: string[]; write: (line: string) => void } {
  const lines: string[] = [];
  return { lines, write: (line) => lines.push(line) };
}

describe('logger (§8.7, R-SEC-10)', () => {
  it('nunca escribe cookies, tokens, contraseñas ni secretos', () => {
    const out = capture();
    const logger = createLogger({ level: 'info' }, out);
    logger.info(
      {
        req: {
          headers: {
            cookie: 'mb_session=SECRETO-COOKIE',
            authorization: 'Bearer SECRETO-AUTH',
            'x-csrf-token': 'SECRETO-CSRF',
            'x-origin-auth': 'SECRETO-ORIGEN',
          },
        },
        res: { headers: { 'set-cookie': 'mb_session=SECRETO-SET' } },
        body: {
          password: 'SECRETO-PASS',
          currentPassword: 'SECRETO-ACTUAL',
          newPassword: 'SECRETO-NUEVA',
          token: 'SECRETO-TOKEN',
          turnstileToken: 'SECRETO-TURNSTILE',
          csrfSecret: 'SECRETO-CSRFSECRET',
          secret: 'SECRETO-GENERICO',
        },
        user: { passwordHash: 'SECRETO-HASH', tokenHash: 'SECRETO-TOKENHASH' },
      },
      'prueba',
    );
    const output = out.lines.join('');
    expect(output).not.toMatch(/SECRETO-/);
    expect(output).toContain('[redactado]');
  });

  it('enmascara el correo', () => {
    const out = capture();
    createLogger({ level: 'info' }, out).info({ email: 'ana.mora@correo.cr' }, 'login');
    expect(out.lines.join('')).not.toContain('ana.mora');
    expect(out.lines.join('')).toContain('a***@correo.cr');
  });

  it('maskEmail conserva solo la inicial y el dominio', () => {
    expect(maskEmail('ana@x.cr')).toBe('a***@x.cr');
    expect(maskEmail('sin-arroba')).toBe('***');
  });
});
