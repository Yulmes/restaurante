/**
 * M9 · Límites de §8.4 (M3) contra PostgreSQL real.
 *
 * Nacieron como diagnóstico (M9-07 y M9-08). Con la autorización de R-M9-1 (alternativas 1 y 2)
 * se corrigieron, y estas pruebas fijan la garantía nueva:
 * - M9-07: el peso de la ventana anterior se calcula en enteros y se redondea hacia arriba;
 * - M9-08: un solo intento de login a la vez por cuenta+IP; la demora y el bloqueo se consultan
 *   con el intento ya reservado, antes de evaluar la contraseña.
 * El modelo de §8.4 (ventana fija con aproximación deslizante) y los límites no cambian: la cota
 * teórica de la aproximación (hasta ~2 × N en el peor caso) queda fuera del alcance (alternativa 3).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MINUTE } from '../src/lib/clock.ts';
import { LoginProtection } from '../src/modules/auth/login-protection.ts';
import { RateLimiter, windowStart } from '../src/modules/rate-limit/rate-limiter.ts';
import { Browser, buildApi, PASSWORD, registerUser, testConfig, type TestApi } from './http.ts';

let api: TestApi;
beforeAll(() => {
  api = buildApi();
});
afterAll(async () => {
  await api.close();
});

describe('aproximación deslizante (§8.4, M3)', () => {
  it('cuenta entera de la ventana anterior al empezar la nueva', async () => {
    const limiter = new RateLimiter(api.db, api.clock);
    const key = `diag:${randomUUID()}`;
    const window = 10 * MINUTE;
    const start = windowStart(api.clock.now(), window).getTime() + window;
    api.clock.set(new Date(start - 1));
    for (let i = 0; i < 10; i += 1) await limiter.hit(key, window);
    api.clock.set(new Date(start + 1));
    // Recién empezada la ventana siguiente, la anterior pesa entera:
    // 1 + ceil(10 × (w − 1 ms) / w) = 11. Antes de M9-07, con `floor`, daba 10.
    expect((await limiter.hit(key, window)).count).toBe(11);
  });

  it('M9-07: no acepta el doble del límite dentro de un intervalo real más corto que la ventana', async () => {
    const limiter = new RateLimiter(api.db, api.clock);
    const key = `diag:${randomUUID()}`;
    const window = 10 * MINUTE;
    const max = 10;
    const start = windowStart(api.clock.now(), window).getTime() + window;
    let accepted = 0;
    // Ráfaga al final de la ventana W0: las 10 entran.
    api.clock.set(new Date(start - 1));
    for (let i = 0; i < max; i += 1) if ((await limiter.hit(key, window)).count <= max) accepted += 1;
    expect(accepted).toBe(max);
    // Al 90 % de W1 la anterior pesa exactamente 10 × 0,1 = 1 (antes, 0,999… → 0): entran 9, no 10.
    api.clock.set(new Date(start + 0.9 * window));
    for (let i = 0; i < max; i += 1) if ((await limiter.hit(key, window)).count <= max) accepted += 1;
    // Antes de M9-07 entraban 20 en 0,9 × ventana + 1 ms.
    expect(accepted).toBe(19);
  });

  it('M9-07: peso de la ventana anterior en los bordes y en fracciones no exactas', async () => {
    const limiter = new RateLimiter(api.db, api.clock);
    const window = 10 * MINUTE;
    const base = windowStart(api.clock.now(), window).getTime() + 2 * window;
    const fill = async (key: string, n: number) => {
      api.clock.set(new Date(base - window / 2));
      for (let i = 0; i < n; i += 1) await limiter.hit(key, window);
    };
    const at = async (key: string, offset: number) => {
      api.clock.set(new Date(base + offset));
      return limiter.peek(key, window);
    };

    // Inicio exacto de la ventana: la anterior pesa entera.
    const k1 = `diag:${randomUUID()}`;
    await fill(k1, 10);
    expect(await at(k1, 0)).toEqual({ count: 10, resetInMs: window });
    // Mitad exacta: 10 × 0,5 = 5.
    expect((await at(k1, window / 2)).count).toBe(5);
    // Último milisegundo: todavía queda una fracción y cuenta 1 (con `floor` era 0).
    expect(await at(k1, window - 1)).toEqual({ count: 1, resetInMs: 1 });
    // Fracción no exacta: 3 × 0,5 = 1,5 → 2 (redondeo hacia arriba).
    const k2 = `diag:${randomUUID()}`;
    await fill(k2, 3);
    expect((await at(k2, window / 2)).count).toBe(2);
    // Sin ventana anterior cuenta solo la actual; dos ventanas atrás ya no pesa.
    const k3 = `diag:${randomUUID()}`;
    expect((await at(k3, window / 2)).count).toBe(0);
    await fill(k3, 7);
    expect((await at(k3, window + 1)).count).toBe(0);
    // `hit` suma el intento a la ventana actual y conserva el peso de la anterior: 1 + 4 × 0,75.
    const k4 = `diag:${randomUUID()}`;
    await fill(k4, 4);
    api.clock.set(new Date(base + window / 4));
    expect((await limiter.hit(k4, window)).count).toBe(1 + 3);
  });

  it('los incrementos simultáneos no se pierden (el contador es atómico)', async () => {
    const limiter = new RateLimiter(api.db, api.clock);
    const key = `diag:${randomUUID()}`;
    const results = await Promise.all(Array.from({ length: 25 }, () => limiter.hit(key, 10 * MINUTE)));
    const counts = results.map((r) => r.count).sort((a, b) => a - b);
    // Cada petición ve un conteo distinto: ninguna se cuenta dos veces ni se pierde.
    expect(new Set(counts).size).toBe(25);
    expect(Math.max(...counts)).toBeGreaterThanOrEqual(25);
  });
});

describe('protección del login por cuenta+IP (§8.4, M3)', () => {
  const failed = (browser: Browser, email: string) =>
    browser.post('/api/auth/login', { email, password: 'equivocada pero larga de verdad' });

  it('en serie: la demora progresiva corta en el 5.º intento', async () => {
    const { email } = await registerUser(api);
    const browser = new Browser(api);
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) statuses.push((await failed(browser, email)).status);
    expect(statuses).toEqual([401, 401, 401, 401, 429, 429]);
  });

  it('M9-08: en paralelo no se evalúan más contraseñas que en serie', async () => {
    const { email } = await registerUser(api);
    const browser = new Browser(api);
    await browser.refreshCsrf();
    const statuses = (await Promise.all(Array.from({ length: 12 }, () => failed(browser, email)))).map(
      (r) => r.status,
    );
    const evaluated = statuses.filter((s) => s === 401).length;
    // Antes de M9-08 se evaluaban más de 4. Ahora un intento simultáneo recibe 429 sin evaluar la
    // contraseña, y la demora del 4.º fallo queda escrita antes de liberar la reserva.
    expect(evaluated).toBeGreaterThanOrEqual(1);
    expect(evaluated).toBeLessThanOrEqual(4);
    expect(statuses.filter((s) => s === 429).length).toBe(12 - evaluated);
    expect(statuses.every((s) => s === 401 || s === 429)).toBe(true);
  });

  it('M9-08: la demora se aplica antes de evaluar la contraseña, aunque sea la correcta', async () => {
    const { email } = await registerUser(api);
    const browser = new Browser(api);
    for (let i = 0; i < 4; i += 1) expect((await failed(browser, email)).status).toBe(401);
    const res = await browser.post('/api/auth/login', { email, password: PASSWORD });
    expect(res.status).toBe(429);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    // Al vencer la demora, la contraseña correcta entra y reinicia los contadores.
    api.clock.advance(MINUTE);
    expect((await browser.post('/api/auth/login', { email, password: PASSWORD })).status).toBe(200);
    expect((await failed(browser, email)).status).toBe(401);
  });

  it('M9-08: logins correctos simultáneos de la misma cuenta+IP: entra al menos uno y ninguno da 5xx', async () => {
    const { email } = await registerUser(api);
    const browser = new Browser(api);
    await browser.refreshCsrf();
    const statuses = (
      await Promise.all(
        Array.from({ length: 5 }, () => browser.post('/api/auth/login', { email, password: PASSWORD })),
      )
    ).map((r) => r.status);
    expect(statuses.filter((s) => s === 200).length).toBeGreaterThanOrEqual(1);
    expect(statuses.every((s) => s === 200 || s === 429)).toBe(true);
    // La reserva se liberó: el login normal sigue funcionando y la sesión es válida.
    expect((await browser.post('/api/auth/login', { email, password: PASSWORD })).status).toBe(200);
    expect((await browser.get('/api/auth/me')).status).toBe(200);
  });

  it('M9-08: la misma cuenta desde otra IP no queda trabada por la reserva', async () => {
    const { email } = await registerUser(api);
    const a = new Browser(api);
    const b = new Browser(api);
    await Promise.all([a.refreshCsrf(), b.refreshCsrf()]);
    const [ra, rb] = await Promise.all([
      a.post('/api/auth/login', { email, password: PASSWORD }),
      b.post('/api/auth/login', { email, password: PASSWORD }),
    ]);
    expect([ra.status, rb.status]).toEqual([200, 200]);
  });
});

describe('reserva del intento de login (M9-08)', () => {
  const protection = () =>
    new LoginProtection({
      db: api.db,
      limiter: new RateLimiter(api.db, api.clock),
      clock: api.clock,
      config: testConfig(),
    });
  const newSubject = (login: LoginProtection) =>
    login.subject(`${randomUUID()}@marea-baja.test`, `ip-${randomUUID()}`);

  it('un segundo intento con la reserva tomada recibe 429; al liberarla, entra', async () => {
    const login = protection();
    const subject = newSubject(login);
    await login.before(subject);
    await expect(login.before(subject)).rejects.toMatchObject({ status: 429 });
    await login.release(subject);
    await expect(login.before(subject)).resolves.toEqual({ challengeRequired: false });
    await login.release(subject);
  });

  it('una reserva abandonada (proceso caído) vence sola a los 30 s', async () => {
    const login = protection();
    const subject = newSubject(login);
    await login.before(subject);
    api.clock.advance(29_000);
    await expect(login.before(subject)).rejects.toMatchObject({ status: 429 });
    api.clock.advance(1_000);
    await expect(login.before(subject)).resolves.toEqual({ challengeRequired: false });
    await login.release(subject);
  });

  it('si la demora corta el intento, la reserva queda liberada', async () => {
    const login = protection();
    const subject = newSubject(login);
    await api.db.loginLock.create({
      data: { subjectKey: subject.delayKey, lockedUntil: new Date(api.clock.now().getTime() + 5_000) },
    });
    await expect(login.before(subject)).rejects.toMatchObject({ status: 429 });
    expect(await api.db.loginLock.count({ where: { subjectKey: subject.inflightKey } })).toBe(0);
    await api.db.loginLock.deleteMany({ where: { subjectKey: subject.delayKey } });
  });
});
