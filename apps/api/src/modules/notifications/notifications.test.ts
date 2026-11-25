import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ORDER_OUTPUT, OUTPUT, compileLayout, compileOrderLayout } from '../../../scripts/build-emails.ts';
import {
  DeliverableRecipients,
  DemoInboxProvider,
  MailpitProvider,
  MemoryEmailProvider,
  RESEND_API_URL,
  ResendProvider,
  parseFrom,
} from './providers.ts';
import { TOKEN_EMAIL_TEMPLATES } from './templates/messages.ts';
import { ORDER_EMAIL_TEMPLATES } from './templates/order-messages.ts';
import { escapeHtml, renderEmail, renderInboxEmail } from './templates/render.ts';

describe('plantillas de correo (§8.5, ADR 0004)', () => {
  it('el HTML versionado coincide con la compilación de la plantilla MJML', async () => {
    expect(readFileSync(OUTPUT, 'utf8')).toBe(await compileLayout());
  });

  it.each(TOKEN_EMAIL_TEMPLATES.flatMap((t) => (['es-CR', 'en'] as const).map((l) => [t, l] as const)))(
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

describe('correos de pedidos (M7, §8.5)', () => {
  const data = {
    name: 'Ana',
    actionUrl: 'https://web.test/cuenta/pedidos/00000000-0000-4000-8000-000000000000',
    orderCode: 'MB-ABC234',
    amount: '₡8 900',
    fulfillmentType: 'DELIVERY' as const,
  };

  it('el HTML versionado del layout de pedidos coincide con su compilación MJML', async () => {
    expect(readFileSync(ORDER_OUTPUT, 'utf8')).toBe(await compileOrderLayout());
  });

  it.each(ORDER_EMAIL_TEMPLATES.flatMap((t) => (['es-CR', 'en'] as const).map((l) => [t, l] as const)))(
    '%s en %s: código, enlace al pedido, texto plano y pie de demostración',
    (template, locale) => {
      const email = renderEmail(template, locale, data);
      expect(email.html).toContain(`lang="${locale}"`);
      expect(email.html).toContain('<table');
      expect(email.html).toContain('MB-ABC234');
      expect(email.html).toContain(`href="${data.actionUrl}"`);
      expect(email.html).not.toMatch(/\{\{\w+\}\}|\{(name|code|amount|fulfillment)\}/);
      expect(email.subject).toContain('MB-ABC234');
      expect(email.subject).toMatch(/Marea Baja$/);
      expect(email.text).toContain(data.actionUrl);
      expect(email.text).toMatch(
        locale === 'en' ? /fictional demo restaurant/ : /restaurante ficticio de demostración/,
      );
    },
  );

  it('el reembolso lleva el monto y el aviso al staff, la modalidad en el idioma del correo', () => {
    expect(renderEmail('order-refunded', 'es-CR', data).subject).toBe(
      'Devolvimos ₡8 900 de tu pedido MB-ABC234 · Marea Baja',
    );
    expect(renderEmail('staff-new-order', 'es-CR', data).text).toContain('(delivery)');
    expect(renderEmail('staff-new-order', 'en', { ...data, fulfillmentType: 'PICKUP' }).text).toContain(
      '(pickup)',
    );
  });

  it('escapa el nombre y exige el código del pedido', () => {
    const email = renderEmail('order-confirmed', 'es-CR', { ...data, name: '<b>Ana</b>' });
    expect(email.html).not.toContain('<b>Ana</b>');
    expect(email.html).toContain('&lt;b&gt;Ana&lt;/b&gt;');
    expect(() => renderEmail('order-confirmed', 'es-CR', { name: 'A', actionUrl: data.actionUrl })).toThrow();
  });

  it('la versión de la bandeja nunca trae enlaces (ni el de un solo uso)', () => {
    const order = renderInboxEmail('order-ready', 'en', data);
    expect(order.subject).toBe('Your order MB-ABC234 is ready for pickup · Marea Baja');
    expect(JSON.stringify(order)).not.toMatch(/https?:/);
    const token = renderInboxEmail('password-reset', 'es-CR', {
      name: 'Ana',
      actionUrl: 'https://web.test/cuenta/restablecer#token=secreto',
    });
    expect(JSON.stringify(token)).not.toMatch(/secreto|https?:/);
    expect(token.subject).toBe('Restablecé tu contraseña · Marea Baja');
  });
});

describe('DEMO_ONLY (M7, §8.5)', () => {
  const message = { to: 'Ana@X.cr', subject: 'S', html: '<p>H</p>', text: 'T' };

  it('DeliverableRecipients manda solo a la lista (sin distinguir mayúsculas) y deja el resto DEMO_ONLY', async () => {
    const inner = new MemoryEmailProvider();
    const provider = new DeliverableRecipients(inner, ['ana@x.cr']);
    expect(await provider.send(message)).toMatchObject({ accepted: true });
    expect(await provider.send({ ...message, to: 'otra@x.cr' })).toEqual({ accepted: false, demoOnly: true });
    expect(inner.sent.map((m) => m.to)).toEqual(['Ana@X.cr']);
  });

  it('DemoInboxProvider no envía nada', async () => {
    expect(await new DemoInboxProvider().send()).toEqual({ accepted: false, demoOnly: true });
  });
});
