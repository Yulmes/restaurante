import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OUTPUT, compileLayout } from '../../../scripts/build-emails.ts';
import { MailpitProvider, RESEND_API_URL, ResendProvider, parseFrom } from './providers.ts';
import { EMAIL_TEMPLATES } from './templates/messages.ts';
import { escapeHtml, renderEmail } from './templates/render.ts';

describe('plantillas de correo (§8.5, ADR 0004)', () => {
  it('el HTML versionado coincide con la compilación de la plantilla MJML', async () => {
    expect(readFileSync(OUTPUT, 'utf8')).toBe(await compileLayout());
  });

  it.each(EMAIL_TEMPLATES.flatMap((t) => (['es-CR', 'en'] as const).map((l) => [t, l] as const)))(
    '%s en %s: HTML con tablas, texto plano, enlace y pie de demostración',
    (template, locale) => {
      const email = renderEmail(template, locale, { name: 'Ana', actionUrl: 'https://web.test/x#token=abc' });
      expect(email.html).toContain(`lang="${locale}"`);
      expect(email.html).toContain('<table');
      expect(email.html).toContain('href="https://web.test/x#token=abc"');
      expect(email.html).not.toMatch(/\{\{\w+\}\}/);
      expect(email.text).toContain('https://web.test/x#token=abc');
      expect(email.text).toMatch(
        locale === 'en' ? /fictional demo restaurant/ : /restaurante ficticio de demostración/,
      );
      expect(email.subject).toMatch(/Marea Baja$/);
    },
  );

  it('escapa los datos del usuario en el HTML', () => {
    const email = renderEmail('email-verification', 'es-CR', {
      name: '<script>alert("x")</script>',
      actionUrl: 'https://web.test/a?b=1&c="2"',
    });
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
    expect(email.html).toContain('href="https://web.test/a?b=1&amp;c=&quot;2&quot;"');
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  it('rechaza enlaces que no son http(s)', () => {
    expect(() =>
      renderEmail('password-reset', 'en', { name: 'A', actionUrl: 'javascript:alert(1)' }),
    ).toThrow();
  });
});

describe('proveedores de correo', () => {
  const message = { to: 'ana@x.cr', subject: 'S', html: '<p>H</p>', text: 'T' };

  it('parseFrom separa nombre y dirección', () => {
    expect(parseFrom('Marea Baja <no-reply@x.test>')).toEqual({
      name: 'Marea Baja',
      email: 'no-reply@x.test',
    });
    expect(parseFrom('solo@x.test')).toEqual({ email: 'solo@x.test' });
  });

  it('Mailpit: usa /api/v1/send y devuelve el id aceptado', async () => {
    let seen: { url: string; body: unknown } | undefined;
    // Los proveedores siempre llaman con una URL en texto y un cuerpo JSON en texto.
    const fetchImpl = ((url: string, init?: { body?: string }) => {
      seen = { url, body: JSON.parse(init?.body ?? 'null') };
      return Promise.resolve(Response.json({ ID: 'abc123' }));
    }) as unknown as typeof fetch;
    const result = await new MailpitProvider('http://mailpit:8025/', 'Marea Baja <n@x.test>', fetchImpl).send(
      message,
    );
    expect(result).toEqual({ accepted: true, providerMessageId: 'abc123' });
    expect(seen?.url).toBe('http://mailpit:8025/api/v1/send');
    expect(seen?.body).toMatchObject({
      From: { Email: 'n@x.test', Name: 'Marea Baja' },
      To: [{ Email: 'ana@x.cr' }],
    });
  });

  it('Resend: SENT solo con respuesta aceptada y id (§8.5)', async () => {
    let auth = '';
    const ok = ((url: string, init?: RequestInit) => {
      expect(url).toBe(RESEND_API_URL);
      auth = new Headers(init?.headers).get('authorization') ?? '';
      return Promise.resolve(Response.json({ id: 're_1' }));
    }) as unknown as typeof fetch;
    expect(await new ResendProvider('re_key', 'onboarding@resend.dev', ok).send(message)).toEqual({
      accepted: true,
      providerMessageId: 're_1',
    });
    expect(auth).toBe('Bearer re_key');

    const refused = (() =>
      Promise.resolve(
        Response.json({ name: 'validation_error', message: 'domain not verified' }, { status: 403 }),
      )) as typeof fetch;
    const result = await new ResendProvider('re_key', 'x@y.z', refused).send(message);
    expect(result.accepted).toBe(false);
    expect(result.error).toContain('403');

    const down = (() => Promise.reject(new TypeError('fetch failed'))) as typeof fetch;
    expect((await new ResendProvider('k', 'x@y.z', down).send(message)).accepted).toBe(false);
  });
});
