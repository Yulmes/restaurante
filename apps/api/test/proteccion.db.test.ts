/**
 * Integración de las defensas (§8.3, §8.4, D8) con reloj simulado (R-SEC-04, R-SEC-05):
 * CSRF, límites por IP, demora y bloqueo de cuenta+IP, y Turnstile condicional.
 */
import { apiErrorBodySchema } from '@marea-baja/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HOUR, MINUTE } from '../src/lib/clock.ts';
import { TURNSTILE_DUMMY_TOKEN } from '../src/modules/bot-check/bot-check.ts';
import { Browser, PASSWORD, WEB_ORIGIN, buildApi, registerUser, uniqueEmail, type TestApi } from './http.ts';

let api: TestApi;
beforeAll(() => {
  api = buildApi();
});
afterAll(async () => {
  await api.close();
});

const error = (body: unknown) => apiErrorBodySchema.parse(body).error;

describe('CSRF (§8.3)', () => {
  it('sin token → 403', async () => {
    const res = await request(api.app)
      .post('/api/auth/login')
      .set('Origin', WEB_ORIGIN)
      .send({ email: 'a@b.cr', password: 'x' });
    expect(res.status).toBe(403);
    expect(error(res.body).code).toBe('CSRF_FAILED');
  });

  it('token de otro navegador → 403', async () => {
    const mine = new Browser(api);
    const other = new Browser(api);
    await mine.refreshCsrf();
    const otherToken = await other.refreshCsrf();
    const res = await mine.agent
      .post('/api/auth/login')
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', otherToken)
      .send({ email: 'a@b.cr', password: 'x' });
    expect(res.status).toBe(403);
  });

  it('token de otra sesión → 403', async () => {
    const a = await registerUser(api);
    const b = await registerUser(api);
    const sessionA = new Browser(api);
    await sessionA.post('/api/auth/login', { email: a.email, password: PASSWORD });
    const sessionB = new Browser(api);
    await sessionB.post('/api/auth/login', { email: b.email, password: PASSWORD });
    const res = await sessionA.agent
      .patch('/api/account/profile')
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', sessionB.csrf)
      .send({ name: 'X', locale: 'en' });
    expect(res.status).toBe(403);
    expect(error(res.body).code).toBe('CSRF_FAILED');
  });

  it('Origin ajeno → 403 aunque el token sea correcto', async () => {
    const browser = new Browser(api);
    const token = await browser.refreshCsrf();
    const res = await browser.agent
      .post('/api/auth/login')
      .set('Origin', 'https://atacante.example')
      .set('X-CSRF-Token', token)
      .send({ email: 'a@b.cr', password: 'x' });
    expect(res.status).toBe(403);
  });

  it('sin Origin solo pasa con Sec-Fetch-Site: same-origin', async () => {
    const browser = new Browser(api);
    const token = await browser.refreshCsrf();
    const cross = await browser.agent
      .post('/api/auth/forgot-password')
      .set('X-CSRF-Token', token)
      .send({ email: uniqueEmail() });
    expect(cross.status).toBe(403);
    const same = await browser.agent
      .post('/api/auth/forgot-password')
      .set('X-CSRF-Token', token)
      .set('Sec-Fetch-Site', 'same-origin')
      .send({ email: uniqueEmail() });
    expect(same.status).toBe(202);
  });
});

describe('login: límites y bloqueos (§8.4)', () => {
  it('demora progresiva desde el 4.º fallo, vía Retry-After', async () => {
    const { email } = await registerUser(api);
    const browser = new Browser(api);
    for (let i = 1; i <= 3; i += 1) {
      const res = await browser.post('/api/auth/login', { email, password: `mala ${String(i)} contraseña` });
      expect(res.status).toBe(401);
      expect(res.headers['retry-after']).toBeUndefined();
    }
    const fourth = await browser.post('/api/auth/login', { email, password: 'cuarta mala contraseña' });
    expect(fourth.status).toBe(401);
    expect(fourth.headers['retry-after']).toBe('2');
    // Durante la demora, ni siquiera la contraseña correcta se evalúa.
    const during = await browser.post('/api/auth/login', { email, password: PASSWORD });
    expect(during.status).toBe(429);
    api.clock.advance(2_100);
    expect((await browser.post('/api/auth/login', { email, password: PASSWORD })).status).toBe(200);
  });

  it('10 fallos bloquean cuenta+IP 15 min; otra IP sigue entrando; escala a 1 h', async () => {
    const { email } = await registerUser(api);
    const attacker = new Browser(api);
    // Los fallos se cuentan con la aproximación deslizante de §8.4: si caen repartidos entre dos
    // ventanas, el conteo estimado puede quedar por debajo del real. Para medir exactamente el
    // umbral de 10, la prueba empieza al inicio de una ventana de 15 min.
    const alignToWindow = () => {
      const now = api.clock.now().getTime();
      api.clock.advance(Math.ceil(now / (15 * MINUTE)) * 15 * MINUTE - now + 1);
    };
    alignToWindow();
    const fail = async () => {
      const res = await attacker.post('/api/auth/login', { email, password: 'contraseña equivocada' });
      // Solo se espera la demora progresiva (401); el bloqueo (429) se verifica antes de vencer.
      if (res.status === 401) api.clock.advance(Number(res.headers['retry-after'] ?? 0) * 1000 + 100);
      return res;
    };
    for (let i = 1; i <= 9; i += 1) expect((await fail()).status).toBe(401);
    const tenth = await fail();
    expect(tenth.status).toBe(429);
    expect(Number(tenth.headers['retry-after'])).toBe(15 * 60);

    // El dueño, desde su red, no queda bloqueado.
    expect((await new Browser(api).post('/api/auth/login', { email, password: PASSWORD })).status).toBe(200);
    // El atacante sí, hasta que vence el bloqueo.
    expect((await attacker.post('/api/auth/login', { email, password: PASSWORD })).status).toBe(429);
    api.clock.advance(15 * MINUTE);
    alignToWindow();

    for (let i = 1; i <= 9; i += 1) expect((await fail()).status).toBe(401);
    const escalated = await fail();
    expect(escalated.status).toBe(429);
    expect(Number(escalated.headers['retry-after'])).toBe(60 * 60);
    api.clock.advance(HOUR);
  });

  it('un login exitoso reinicia los contadores de cuenta+IP', async () => {
    const { email } = await registerUser(api);
    const browser = new Browser(api);
    for (let i = 0; i < 3; i += 1)
      await browser.post('/api/auth/login', { email, password: 'equivocada otra vez' });
    expect((await browser.post('/api/auth/login', { email, password: PASSWORD })).status).toBe(200);
    const res = await browser.post('/api/auth/login', { email, password: 'equivocada otra vez' });
    expect(res.status).toBe(401);
    expect(res.headers['retry-after']).toBeUndefined();
  });

  it('30 intentos por IP cada 15 min; el 31.º → 429', async () => {
    const browser = new Browser(api);
    for (let i = 0; i < 30; i += 1) {
      const res = await browser.post('/api/auth/login', { email: uniqueEmail(), password: 'cualquier cosa' });
      expect(res.status).toBe(401);
    }
    const res = await browser.post('/api/auth/login', { email: uniqueEmail(), password: 'cualquier cosa' });
    expect(res.status).toBe(429);
    expect(error(res.body).code).toBe('RATE_LIMITED');
  });
});

describe('Turnstile condicional (D8)', () => {
  async function withThreshold(threshold: number, fn: () => Promise<void>): Promise<void> {
    const original = await api.db.restaurantSettings.findUniqueOrThrow({ where: { id: 1 } });
    await api.db.restaurantSettings.update({
      where: { id: 1 },
      data: { turnstileGlobalThreshold: threshold },
    });
    try {
      await fn();
    } finally {
      await api.db.restaurantSettings.update({
        where: { id: 1 },
        data: { turnstileGlobalThreshold: original.turnstileGlobalThreshold },
      });
    }
  }

  it('no aparece por debajo del umbral; al superarlo, desde cualquier IP, lo exige sin evaluar la contraseña', async () => {
    await withThreshold(3, async () => {
      const { email } = await registerUser(api);
      // Fallos desde IP distintas: el umbral es global de la cuenta.
      for (let i = 0; i < 2; i += 1) {
        const res = await new Browser(api).post('/api/auth/login', {
          email,
          password: 'equivocada desde lejos',
        });
        expect(error(res.body).challengeRequired).toBeUndefined();
      }
      const third = await new Browser(api).post('/api/auth/login', {
        email,
        password: 'equivocada desde lejos',
      });
      expect(third.status).toBe(401);
      expect(error(third.body).challengeRequired).toBe(true);

      const owner = new Browser(api);
      const noToken = await owner.post('/api/auth/login', { email, password: PASSWORD });
      expect(noToken.status).toBe(403);
      expect(error(noToken.body)).toMatchObject({ code: 'CHALLENGE_REQUIRED', challengeRequired: true });

      const badToken = await owner.post('/api/auth/login', {
        email,
        password: PASSWORD,
        turnstileToken: 'falso',
      });
      expect(badToken.status).toBe(403);
      expect(error(badToken.body).code).toBe('CHALLENGE_FAILED');

      // Con token inválido no se evalúa la contraseña: tampoco suma un fallo de cuenta+IP.
      const ok = await owner.post('/api/auth/login', {
        email,
        password: PASSWORD,
        turnstileToken: TURNSTILE_DUMMY_TOKEN,
      });
      expect(ok.status).toBe(200);
    });
  });

  it('se activa igual para un correo inexistente, sin revelar que no existe', async () => {
    await withThreshold(2, async () => {
      const ghost = uniqueEmail('fantasma');
      await new Browser(api).post('/api/auth/login', { email: ghost, password: 'lo que sea largo' });
      const second = await new Browser(api).post('/api/auth/login', {
        email: ghost,
        password: 'lo que sea largo',
      });
      expect(error(second.body).challengeRequired).toBe(true);
      const third = await new Browser(api).post('/api/auth/login', {
        email: ghost,
        password: 'lo que sea largo',
      });
      expect(third.status).toBe(403);
      expect(error(third.body).code).toBe('CHALLENGE_REQUIRED');
    });
  });

  it('el umbral sale de RestaurantSettings y la ventana vence (configurable, §8.4)', async () => {
    await withThreshold(2, async () => {
      const { email } = await registerUser(api);
      await new Browser(api).post('/api/auth/login', { email, password: 'equivocada uno dos' });
      await new Browser(api).post('/api/auth/login', { email, password: 'equivocada uno dos' });
      expect((await new Browser(api).post('/api/auth/login', { email, password: PASSWORD })).status).toBe(
        403,
      );
      api.clock.advance(2 * HOUR + MINUTE);
      expect((await new Browser(api).post('/api/auth/login', { email, password: PASSWORD })).status).toBe(
        200,
      );
    });
  });
});
