/**
 * M9 · Diagnóstico de los límites de §8.4 (M3) contra PostgreSQL real.
 *
 * Estas pruebas **documentan el comportamiento actual**: no lo cambian. El algoritmo (ventana fija
 * con aproximación deslizante) y las garantías de §8.4 son decisiones aprobadas; corregirlas
 * requiere la autorización del propietario (ver `docs/m9/AUDITORIA_M9.md`, hallazgos de límites).
 * Si el algoritmo cambia con esa autorización, estas pruebas se reescriben con la garantía nueva.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MINUTE } from '../src/lib/clock.ts';
import { RateLimiter, windowStart } from '../src/modules/rate-limit/rate-limiter.ts';
import { Browser, buildApi, registerUser, type TestApi } from './http.ts';

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
    // Recién empezada la ventana siguiente, la anterior pesa casi entera: 1 + floor(10 × ~1) = 10.
    expect((await limiter.hit(key, window)).count).toBe(10);
  });

  it('DEBILIDAD: acepta hasta el doble del límite dentro de un intervalo real más corto que la ventana', async () => {
    const limiter = new RateLimiter(api.db, api.clock);
    const key = `diag:${randomUUID()}`;
    const window = 10 * MINUTE;
    const max = 10;
    const start = windowStart(api.clock.now(), window).getTime() + window;
    let accepted = 0;
    // Ráfaga al final de la ventana W0: las 10 entran.
    api.clock.set(new Date(start - 1));
    for (let i = 0; i < max; i += 1) if ((await limiter.hit(key, window)).count <= max) accepted += 1;
    // Al 90 % de W1 la anterior debería pesar 10 × 0,1 = 1, pero en coma flotante es 0,999… y
    // `Math.floor` la deja en 0: entran 10 más.
    api.clock.set(new Date(start + 0.9 * window));
    for (let i = 0; i < max; i += 1) if ((await limiter.hit(key, window)).count <= max) accepted += 1;
    // 20 aceptadas en 0,9 × ventana + 1 ms: el límite real fue el doble del nominal.
    expect(accepted).toBe(20);
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

  it('DEBILIDAD: en paralelo, la demora y el bloqueo se consultan antes de registrar el fallo y se saltean', async () => {
    const { email } = await registerUser(api);
    const browser = new Browser(api);
    await browser.refreshCsrf();
    const statuses = (await Promise.all(Array.from({ length: 12 }, () => failed(browser, email)))).map(
      (r) => r.status,
    );
    const evaluated = statuses.filter((s) => s === 401).length;
    // En serie se evalúan 4 contraseñas antes de la demora; en paralelo, más. El límite por IP
    // (30 / 15 min) sigue acotando el total, y el bloqueo de cuenta+IP llega igual al 10.º fallo.
    expect(evaluated).toBeGreaterThan(4);
    expect(statuses.every((s) => s === 401 || s === 429)).toBe(true);
  });
});
