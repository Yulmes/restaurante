/**
 * Integración de identidad (M3, §8, §11): registro, verificación, login/logout, sesiones
 * (expiración, rotación, revocación), recuperación, perfil y cambio de contraseña.
 */
import { publicUserSchema, sessionResponseSchema, apiErrorBodySchema } from '@marea-baja/shared';
import { dictionary } from '@zxcvbn-ts/language-common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DAY, MINUTE } from '../src/lib/clock.ts';
import { sha256 } from '../src/lib/crypto.ts';
import request from 'supertest';
import {
  Browser,
  PASSWORD,
  WEB_ORIGIN,
  buildApi,
  lastEmailToken,
  registerUser,
  setCookie,
  signIn,
  uniqueEmail,
  type TestApi,
} from './http.ts';

let api: TestApi;
beforeAll(() => {
  api = buildApi();
});
afterAll(async () => {
  await api.close();
});

const errorCode = (body: unknown) => apiErrorBodySchema.parse(body).error.code;

describe('registro', () => {
  it('crea un cliente sin verificar, en su idioma, con Argon2id, y encola el correo en esa misma transacción', async () => {
    const email = uniqueEmail();
    const browser = new Browser(api);
    const res = await browser.post('/api/auth/register', {
      name: 'Ana Mora',
      email: `  ${email.toUpperCase()} `,
      password: PASSWORD,
      locale: 'en',
    });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ status: 'pending' });

    const user = await api.db.user.findFirstOrThrow({
      where: { email },
      include: { roles: { include: { role: true } }, emails: true },
    });
    expect(user.locale).toBe('en');
    expect(user.emailVerifiedAt).toBeNull();
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user.roles.map((r) => r.role.key)).toEqual(['CUSTOMER']);
    expect(user.emails).toHaveLength(1);

    await api.outbox.idle();
    await api.outbox.kick();
    const sent = api.email.sent.filter((m) => m.to === email);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.subject).toBe('Confirm your email · Marea Baja');
    expect(sent[0]?.text).toMatch(/http:\/\/web\.test\/en\/account\/verify#token=[A-Za-z0-9_-]{43}/);

    const outbox = await api.db.emailOutbox.findFirstOrThrow({ where: { to: email } });
    expect(outbox.status).toBe('SENT');
    expect(outbox.providerMessageId).toMatch(/^memory-/);
    // El enlace con el token se borra de la fila al enviar: en la base solo queda el hash.
    expect(outbox.payload).toEqual({});
    const token = lastEmailToken(api, email);
    expect(await api.db.emailVerificationToken.count({ where: { tokenHash: sha256(token) } })).toBe(1);
  });

  it('no revela si el correo ya existe: misma respuesta, sin usuario ni correo nuevos', async () => {
    const { email } = await registerUser(api);
    const before = api.email.sent.length;
    const res = await new Browser(api).post('/api/auth/register', {
      name: 'Otra persona',
      email,
      password: PASSWORD,
      locale: 'es-CR',
    });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ status: 'pending' });
    expect(await api.db.user.count({ where: { email } })).toBe(1);
    await api.outbox.kick();
    expect(api.email.sent.length).toBe(before);
  });

  it('valida los datos con códigos por campo y rechaza contraseñas comunes', async () => {
    const browser = new Browser(api);
    const bad = await browser.post('/api/auth/register', {
      name: '',
      email: 'no',
      password: 'corta',
      locale: 'es-CR',
    });
    expect(bad.status).toBe(400);
    expect(bad.body).toMatchObject({
      error: {
        code: 'VALIDATION_FAILED',
        fields: { name: 'required', email: 'invalidEmail', password: 'passwordTooShort' },
      },
    });
    const list = dictionary['passwords-common'] as readonly string[];
    const commonPassword = list.slice(0, 10_000).find((p) => p.length >= 12) ?? '';
    const common = await browser.post('/api/auth/register', {
      name: 'A',
      email: uniqueEmail(),
      password: commonPassword,
      locale: 'es-CR',
    });
    expect(common.status).toBe(400);
    expect(common.body).toMatchObject({ error: { fields: { password: 'passwordTooCommon' } } });
  });

  it('limita a 5 registros por hora por IP (§8.4)', async () => {
    const browser = new Browser(api);
    for (let i = 0; i < 5; i += 1) {
      const ok = await browser.post('/api/auth/register', {
        name: 'A',
        email: uniqueEmail(),
        password: PASSWORD,
        locale: 'es-CR',
      });
      expect(ok.status).toBe(202);
    }
    const res = await browser.post('/api/auth/register', {
      name: 'A',
      email: uniqueEmail(),
      password: PASSWORD,
      locale: 'es-CR',
    });
    expect(res.status).toBe(429);
    expect(errorCode(res.body)).toBe('RATE_LIMITED');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });
});

describe('verificación del correo', () => {
  it('verifica una sola vez; un enlace vencido o reutilizado no sirve', async () => {
    const { email, browser } = await registerUser(api);
    const token = lastEmailToken(api, email);
    const ok = await browser.post('/api/auth/verify-email', { token });
    expect(ok.status).toBe(200);
    expect(publicUserSchema.parse((ok.body as { user: unknown }).user).emailVerified).toBe(true);

    const again = await browser.post('/api/auth/verify-email', { token });
    expect(again.status).toBe(400);
    expect(errorCode(again.body)).toBe('INVALID_OR_EXPIRED_TOKEN');

    const other = await registerUser(api);
    api.clock.advance(DAY + MINUTE);
    const expired = await other.browser.post('/api/auth/verify-email', {
      token: lastEmailToken(api, other.email),
    });
    expect(expired.status).toBe(400);
  });

  it('reenviar exige sesión, invalida el enlace anterior y respeta 1 por minuto', async () => {
    const { email } = await registerUser(api);
    const first = lastEmailToken(api, email);
    const guest = await new Browser(api).post('/api/auth/resend-verification');
    expect(guest.status).toBe(401);

    const browser = await signIn(api, email);
    expect((await browser.post('/api/auth/resend-verification')).status).toBe(202);
    await api.outbox.idle();
    await api.outbox.kick();
    const second = lastEmailToken(api, email);
    expect(second).not.toBe(first);

    const tooSoon = await browser.post('/api/auth/resend-verification');
    expect(tooSoon.status).toBe(429);

    expect((await browser.post('/api/auth/verify-email', { token: first })).status).toBe(400);
    const verified = await browser.post('/api/auth/verify-email', { token: second });
    expect(verified.status).toBe(200);

    api.clock.advance(2 * MINUTE);
    const already = await browser.post('/api/auth/resend-verification');
    expect(already.status).toBe(409);
    expect(errorCode(already.body)).toBe('EMAIL_ALREADY_VERIFIED');
  });

  it('verificar con la sesión del mismo usuario rota el token de la sesión (§8.2)', async () => {
    const { email } = await registerUser(api);
    const browser = await signIn(api, email);
    const res = await browser.post('/api/auth/verify-email', { token: lastEmailToken(api, email) });
    expect(res.status).toBe(200);
    expect(sessionResponseSchema.parse(res.body).user.emailVerified).toBe(true);
    expect(setCookie(res, 'mb_session')).toBeDefined();
    expect((await browser.get('/api/auth/me')).status).toBe(200);
  });
});

describe('login, sesión y logout', () => {
  it('crea la sesión con cookie HttpOnly, SameSite=Lax y Path=/; solo el hash del token va a la base', async () => {
    const { email } = await registerUser(api);
    const browser = new Browser(api);
    const res = await browser.post('/api/auth/login', { email, password: PASSWORD });
    expect(res.status).toBe(200);
    const body = sessionResponseSchema.parse(res.body);
    expect(body.user).toMatchObject({ email, emailVerified: false, roles: ['CUSTOMER'], locale: 'es-CR' });
    const cookie = setCookie(res, 'mb_session') ?? '';
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).not.toMatch(/Secure/);
    const token = /^mb_session=([^;]+)/.exec(cookie)?.[1] ?? '';
    expect(await api.db.session.count({ where: { tokenHash: sha256(token) } })).toBe(1);
    expect(await api.db.session.count({ where: { tokenHash: token } })).toBe(0);

    const me = await browser.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(publicUserSchema.parse((me.body as { user: unknown }).user).email).toBe(email);
  });

  it('el mensaje es el mismo para un correo inexistente y para una contraseña incorrecta', async () => {
    const { email } = await registerUser(api);
    const wrong = await new Browser(api).post('/api/auth/login', {
      email,
      password: 'otra contraseña larga',
    });
    const missing = await new Browser(api).post('/api/auth/login', {
      email: uniqueEmail('nadie'),
      password: PASSWORD,
    });
    expect(wrong.status).toBe(401);
    expect(missing.status).toBe(401);
    const strip = (b: unknown) => ({ ...apiErrorBodySchema.parse(b).error, requestId: '' });
    expect(strip(wrong.body)).toEqual(strip(missing.body));
  });

  it('logout revoca la sesión actual', async () => {
    const { email } = await registerUser(api);
    const browser = await signIn(api, email);
    expect((await browser.post('/api/auth/logout')).status).toBe(204);
    expect((await browser.get('/api/auth/me')).status).toBe(401);
  });

  it('"cerrar todas las sesiones" revoca las de todos los dispositivos', async () => {
    const { email } = await registerUser(api);
    const phone = await signIn(api, email);
    const laptop = await signIn(api, email);
    expect((await laptop.post('/api/auth/logout-all')).status).toBe(204);
    expect((await phone.get('/api/auth/me')).status).toBe(401);
    expect((await laptop.get('/api/auth/me')).status).toBe(401);
  });

  it('vence por inactividad (7 días) y de forma absoluta (30 días)', async () => {
    const { email } = await registerUser(api);
    const idle = await signIn(api, email);
    api.clock.advance(7 * DAY + MINUTE);
    expect((await idle.get('/api/auth/me')).status).toBe(401);

    // Con uso cada 6 días nunca vence por inactividad, pero a los 30 días vence igual.
    const active = await signIn(api, email);
    for (let i = 0; i < 4; i += 1) {
      api.clock.advance(6 * DAY);
      expect((await active.get('/api/auth/me')).status).toBe(200);
    }
    api.clock.advance(6 * DAY + MINUTE);
    expect((await active.get('/api/auth/me')).status).toBe(401);
  });

  it('rota el token cada 24 h de uso: el anterior deja de valer', async () => {
    const { email } = await registerUser(api);
    const browser = await signIn(api, email);
    const session = await api.db.session.findFirstOrThrow({
      where: { user: { email } },
      orderBy: { createdAt: 'desc' },
    });
    api.clock.advance(DAY + MINUTE);
    const res = await browser.get('/api/auth/me');
    expect(res.status).toBe(200);
    expect(setCookie(res, 'mb_session')).toBeDefined();
    const after = await api.db.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(after.tokenHash).not.toBe(session.tokenHash);
    expect(after.rotatedAt).not.toBeNull();
  });

  it('en producción la cookie es __Host- y Secure', async () => {
    const prod = buildApi({ config: { production: true } });
    try {
      const { email } = await registerUser(api);
      // Supertest no reenvía cookies `Secure` por http: la cookie de invitado se manda a mano.
      const csrf = await request(prod.app).get('/api/auth/csrf');
      const guest = setCookie(csrf, '__Host-mb_csrf') ?? '';
      expect(guest).toMatch(/Secure/);
      const res = await request(prod.app)
        .post('/api/auth/login')
        .set('Origin', WEB_ORIGIN)
        .set('Cookie', guest.split(';')[0] ?? '')
        .set('X-CSRF-Token', (csrf.body as { csrfToken: string }).csrfToken)
        .send({ email, password: PASSWORD });
      expect(res.status).toBe(200);
      const cookie = setCookie(res, '__Host-mb_session') ?? '';
      expect(cookie).toMatch(/Secure/);
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).not.toMatch(/Domain=/);
    } finally {
      await prod.close();
    }
  });

  it('un usuario bloqueado no inicia sesión y su sesión abierta deja de valer', async () => {
    const { email } = await registerUser(api);
    const browser = await signIn(api, email);
    await api.db.user.updateMany({ where: { email }, data: { blockedAt: api.clock.now() } });
    expect((await browser.get('/api/auth/me')).status).toBe(401);
    const res = await new Browser(api).post('/api/auth/login', { email, password: PASSWORD });
    expect(res.status).toBe(403);
    expect(errorCode(res.body)).toBe('ACCOUNT_BLOCKED');
  });
});

describe('recuperación de contraseña', () => {
  it('siempre responde igual; el correo sale solo si la cuenta existe, en su idioma', async () => {
    const { email } = await registerUser(api, { locale: 'en' });
    const browser = new Browser(api);
    const before = api.email.sent.length;
    const existing = await browser.post('/api/auth/forgot-password', { email });
    const missing = await browser.post('/api/auth/forgot-password', { email: uniqueEmail('nadie') });
    expect(existing.status).toBe(202);
    expect(missing.status).toBe(202);
    expect(existing.body).toEqual(missing.body);
    await api.outbox.idle();
    await api.outbox.kick();
    const sent = api.email.sent.slice(before);
    expect(sent.map((m) => m.to)).toEqual([email]);
    expect(sent[0]?.text).toMatch(/\/en\/account\/reset-password#token=/);
  });

  it('el restablecimiento cambia la contraseña, revoca todas las sesiones y el enlace es de un solo uso', async () => {
    const { email } = await registerUser(api);
    const session = await signIn(api, email);
    await new Browser(api).post('/api/auth/forgot-password', { email });
    await api.outbox.idle();
    await api.outbox.kick();
    const token = lastEmailToken(api, email);
    const newPassword = 'otra frase nueva para la cuenta';

    const res = await new Browser(api).post('/api/auth/reset-password', { token, password: newPassword });
    expect(res.status).toBe(204);
    expect((await session.get('/api/auth/me')).status).toBe(401);
    expect((await new Browser(api).post('/api/auth/login', { email, password: PASSWORD })).status).toBe(401);
    expect((await new Browser(api).post('/api/auth/login', { email, password: newPassword })).status).toBe(
      200,
    );
    const reused = await new Browser(api).post('/api/auth/reset-password', {
      token,
      password: 'una tercera frase larga',
    });
    expect(reused.status).toBe(400);
    expect(errorCode(reused.body)).toBe('INVALID_OR_EXPIRED_TOKEN');
  });

  it('el enlace vence a los 30 minutos', async () => {
    const { email } = await registerUser(api);
    await new Browser(api).post('/api/auth/forgot-password', { email });
    await api.outbox.idle();
    await api.outbox.kick();
    api.clock.advance(31 * MINUTE);
    const res = await new Browser(api).post('/api/auth/reset-password', {
      token: lastEmailToken(api, email),
      password: 'una frase larga y nueva',
    });
    expect(res.status).toBe(400);
  });

  it('límite silencioso de 3 correos por hora por cuenta y 429 a las 5 solicitudes por IP', async () => {
    const { email } = await registerUser(api);
    const before = api.email.sent.filter((m) => m.to === email).length;
    const ips = ['192.0.2.10', '192.0.2.11', '192.0.2.12', '192.0.2.13'];
    for (const ip of ips) {
      expect((await new Browser(api, ip).post('/api/auth/forgot-password', { email })).status).toBe(202);
    }
    await api.outbox.idle();
    await api.outbox.kick();
    expect(api.email.sent.filter((m) => m.to === email).length - before).toBe(3);

    const browser = new Browser(api);
    for (let i = 0; i < 5; i += 1) {
      expect((await browser.post('/api/auth/forgot-password', { email: uniqueEmail() })).status).toBe(202);
    }
    expect((await browser.post('/api/auth/forgot-password', { email: uniqueEmail() })).status).toBe(429);
  });
});

describe('perfil', () => {
  it('actualiza nombre, teléfono e idioma; exige sesión y datos válidos', async () => {
    const { email } = await registerUser(api);
    expect((await new Browser(api).patch('/api/account/profile', { name: 'X', locale: 'en' })).status).toBe(
      401,
    );
    const browser = await signIn(api, email);
    const res = await browser.patch('/api/account/profile', {
      name: 'Ana Mora Vargas',
      phone: '+506 8888-1234',
      locale: 'en',
    });
    expect(res.status).toBe(200);
    expect(publicUserSchema.parse((res.body as { user: unknown }).user)).toMatchObject({
      name: 'Ana Mora Vargas',
      phone: '+506 8888-1234',
      locale: 'en',
    });
    const bad = await browser.patch('/api/account/profile', { name: '', phone: 'abc', locale: 'fr' });
    expect(bad.status).toBe(400);
    expect(bad.body).toMatchObject({ error: { fields: { name: 'required', phone: 'invalidPhone' } } });
  });

  it('cambiar la contraseña exige la actual, cierra las demás sesiones y rota la actual', async () => {
    const { email } = await registerUser(api);
    const other = await signIn(api, email);
    const browser = await signIn(api, email);
    const wrong = await browser.post('/api/account/password', {
      currentPassword: 'no es la actual',
      newPassword: 'frase nueva y larga 2026',
    });
    expect(wrong.status).toBe(400);
    expect(wrong.body).toMatchObject({ error: { fields: { currentPassword: 'currentPasswordIncorrect' } } });

    const ok = await browser.post('/api/account/password', {
      currentPassword: PASSWORD,
      newPassword: 'frase nueva y larga 2026',
    });
    expect(ok.status).toBe(200);
    expect(setCookie(ok, 'mb_session')).toBeDefined();
    expect((await browser.get('/api/auth/me')).status).toBe(200);
    expect((await other.get('/api/auth/me')).status).toBe(401);
  });
});

describe('idioma de la cuenta (D2, M3)', () => {
  const localeOf = (body: unknown) => publicUserSchema.parse((body as { user: unknown }).user).locale;

  it('el registro guarda el idioma de la página: español e inglés', async () => {
    const es = await registerUser(api, { locale: 'es-CR' });
    const en = await registerUser(api, { locale: 'en' });
    expect((await api.db.user.findFirstOrThrow({ where: { email: es.email } })).locale).toBe('es_CR');
    expect((await api.db.user.findFirstOrThrow({ where: { email: en.email } })).locale).toBe('en');
    expect(
      localeOf(
        (await new Browser(api).post('/api/auth/login', { email: es.email, password: PASSWORD })).body,
      ),
    ).toBe('es-CR');
    expect(
      localeOf(
        (await new Browser(api).post('/api/auth/login', { email: en.email, password: PASSWORD })).body,
      ),
    ).toBe('en');
  });

  it('el cambio desde el perfil persiste después de cerrar sesión y volver a entrar', async () => {
    const { email } = await registerUser(api, { locale: 'es-CR' });
    const browser = await signIn(api, email);
    const changed = await browser.patch('/api/account/profile', { name: 'Ana', locale: 'en' });
    expect(localeOf(changed.body)).toBe('en');
    expect((await browser.post('/api/auth/logout')).status).toBe(204);

    const again = await new Browser(api).post('/api/auth/login', { email, password: PASSWORD });
    expect(localeOf(again.body)).toBe('en');
    const back = await signIn(api, email);
    expect(localeOf((await back.patch('/api/account/profile', { name: 'Ana', locale: 'es-CR' })).body)).toBe(
      'es-CR',
    );
    expect(localeOf((await back.get('/api/auth/me')).body)).toBe('es-CR');
  });

  it('una cuenta sin preferencia guardada usa es-CR (valor por defecto de la base)', async () => {
    const email = uniqueEmail('sin-idioma');
    const { hashPassword } = await import('../src/modules/auth/passwords.ts');
    const customer = await api.db.role.findUniqueOrThrow({ where: { key: 'CUSTOMER' } });
    // Sin `locale`: la columna toma su valor por defecto.
    await api.db.user.create({
      data: {
        email,
        name: 'Sin idioma',
        passwordHash: await hashPassword(PASSWORD),
        roles: { create: { roleId: customer.id } },
      },
    });
    const res = await new Browser(api).post('/api/auth/login', { email, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(localeOf(res.body)).toBe('es-CR');
  });

  it('un idioma inválido se rechaza con un código por campo y no cambia la preferencia', async () => {
    const { email } = await registerUser(api, { locale: 'en' });
    const browser = await signIn(api, email);
    for (const locale of ['fr', 'es_CR', 'EN', '']) {
      const res = await browser.patch('/api/account/profile', { name: 'Ana', locale });
      expect(res.status).toBe(400);
      expect(errorCode(res.body)).toBe('VALIDATION_FAILED');
      expect(apiErrorBodySchema.parse(res.body).error.fields).toHaveProperty('locale');
    }
    expect((await api.db.user.findFirstOrThrow({ where: { email } })).locale).toBe('en');
    const register = await new Browser(api).post('/api/auth/register', {
      name: 'X',
      email: uniqueEmail(),
      password: PASSWORD,
      locale: 'fr',
    });
    expect(register.status).toBe(400);
  });
});

describe('forma de los errores y cabeceras (§8.7)', () => {
  it('404 con código, requestId y X-Request-Id, sin trazas', async () => {
    const res = await new Browser(api).get('/api/no-existe');
    expect(res.status).toBe(404);
    const body = apiErrorBodySchema.parse(res.body);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(res.headers['x-request-id']).toBe(body.error.requestId);
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.ts/);
  });

  it('JSON mal formado → 400 VALIDATION_FAILED', async () => {
    const browser = new Browser(api);
    await browser.refreshCsrf();
    const res = await browser.agent
      .post('/api/auth/login')
      .set('Origin', 'http://web.test')
      .set('X-CSRF-Token', browser.csrf)
      .set('content-type', 'application/json')
      .send('{"email":');
    expect(res.status).toBe(400);
    expect(errorCode(res.body)).toBe('VALIDATION_FAILED');
  });

  it('health responde solo {"status":"ok"} y Helmet agrega sus cabeceras', async () => {
    const res = await new Browser(api).get('/api/health');
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('los logs no contienen contraseñas, tokens, cookies ni correos en claro', async () => {
    const { email } = await registerUser(api);
    await signIn(api, email);
    const output = api.logs.join('');
    expect(output).not.toContain(PASSWORD);
    expect(output).not.toContain(email);
    expect(output).not.toMatch(/mb_session=/);
  });
});
