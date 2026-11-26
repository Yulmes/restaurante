import express from 'express';
import { pino } from 'pino';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../generated/prisma/client.ts';
import { errorHandler } from '../../http/errors.ts';
import { requestContext } from '../../http/request-context.ts';
import type { Clock } from '../../lib/clock.ts';
import type { OutboxResult } from '../notifications/outbox.ts';
import { ActivityMonitor, countsAsActivity } from './activity.ts';
import {
  BackgroundTasks,
  OUTBOX_RETRY_EVERY_MS,
  RECONCILE_MAX_PASSES,
  TasksBusyError,
} from './background.ts';
import { readyRouter } from './routes.ts';

const silent = pino({ level: 'silent' });

class FakeClock implements Clock {
  ms = 1_800_000_000_000;
  now(): Date {
    return new Date(this.ms);
  }
}

function fakes(
  overrides: Partial<Record<'reconcile' | 'sweep' | 'drain' | 'purge', () => Promise<unknown>>> = {},
) {
  const calls = { reconcile: 0, sweep: 0, drain: 0, kick: 0, purge: 0 };
  const clock = new FakeClock();
  const tasks = new BackgroundTasks({
    payments: {
      reconcile: () => {
        calls.reconcile += 1;
        return (overrides.reconcile?.() ?? Promise.resolve({ resolved: 0, pending: 0 })) as Promise<{
          resolved: number;
          pending: number;
        }>;
      },
    },
    operations: {
      sweep: () => {
        calls.sweep += 1;
        return (overrides.sweep?.() ?? Promise.resolve({ expired: 1, unconfirmed: 2 })) as Promise<{
          expired: number;
          unconfirmed: number;
        }>;
      },
    },
    outbox: {
      drain: () => {
        calls.drain += 1;
        return (overrides.drain?.() ??
          Promise.resolve({ sent: 3, retried: 0, failed: 0, demoOnly: 1 })) as Promise<OutboxResult>;
      },
      kick: () => {
        calls.kick += 1;
        return Promise.resolve();
      },
    },
    limiter: {
      purgeOlderThan: () => {
        calls.purge += 1;
        return (overrides.purge?.() ?? Promise.resolve(7)) as Promise<number>;
      },
    },
    clock,
    logger: silent,
  });
  return { tasks, calls, clock };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('BackgroundTasks.runAll (D-M10-1)', () => {
  it('corre las cuatro tareas y devuelve solo conteos', async () => {
    const { tasks } = fakes();
    const report = await tasks.runAll();
    expect(report).toEqual({
      ok: true,
      durationMs: 0,
      sweep: { ok: true, expired: 1, unconfirmed: 2 },
      reconcile: { ok: true, resolved: 0, pending: 0, passes: 1 },
      outbox: { ok: true, sent: 3, retried: 0, failed: 0, demoOnly: 1 },
      purge: { ok: true, removed: 7 },
    });
  });

  it('una tarea que falla no corta las demás y el informe lo marca', async () => {
    const { tasks, calls } = fakes({ sweep: () => Promise.reject(new Error('base caída')) });
    const report = await tasks.runAll();
    expect(report.ok).toBe(false);
    expect(report.sweep).toEqual({ ok: false, expired: 0, unconfirmed: 0 });
    expect(report.reconcile.ok).toBe(true);
    expect(report.outbox.ok).toBe(true);
    expect(calls).toMatchObject({ reconcile: 1, drain: 1, purge: 1 });
  });

  it('repite la reconciliación mientras resuelva algo, con un tope de pasadas', async () => {
    const { tasks, calls } = fakes({ reconcile: () => Promise.resolve({ resolved: 1, pending: 1 }) });
    const report = await tasks.runAll();
    expect(calls.reconcile).toBe(RECONCILE_MAX_PASSES);
    expect(report.reconcile).toMatchObject({ resolved: RECONCILE_MAX_PASSES, passes: RECONCILE_MAX_PASSES });
  });

  it('una vuelta a la vez; al terminar se puede volver a correr', async () => {
    let release: () => void = () => undefined;
    const blocked = new Promise<{ expired: number; unconfirmed: number }>((resolve) => {
      release = () => {
        resolve({ expired: 0, unconfirmed: 0 });
      };
    });
    const { tasks } = fakes({ sweep: () => blocked });
    const first = tasks.runAll();
    await expect(tasks.runAll()).rejects.toBeInstanceOf(TasksBusyError);
    release();
    await first;
    await expect(tasks.runAll()).resolves.toMatchObject({ ok: true });
  });

  it('cada tarea es de un vuelo: dos llamadas simultáneas comparten la misma ejecución', async () => {
    let release: () => void = () => undefined;
    const { tasks, calls } = fakes({
      reconcile: () =>
        new Promise((resolve) => {
          release = () => {
            resolve({ resolved: 2, pending: 0 });
          };
        }),
    });
    const a = tasks.reconcile();
    const b = tasks.reconcile();
    release();
    expect(await a).toEqual(await b);
    expect(calls.reconcile).toBe(1);
  });
});

describe('temporizadores según la actividad (D-M10-1)', () => {
  it('sin actividad no corre nada; con actividad, cada tarea a su ritmo', async () => {
    vi.useFakeTimers();
    const { tasks, calls } = fakes();
    let active = false;
    tasks.startTimers(() => active);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(calls).toEqual({ reconcile: 0, sweep: 0, drain: 0, kick: 0, purge: 0 });

    active = true;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls.reconcile).toBe(12); // cada 5 s
    expect(calls.sweep).toBe(1); // cada minuto
    expect(calls.kick).toBe(60_000 / OUTBOX_RETRY_EVERY_MS); // reintentos del outbox cada 30 s
    tasks.stopTimers();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls.reconcile).toBe(12);
  });

  it('un error en el temporizador no lo detiene', async () => {
    vi.useFakeTimers();
    let fail = true;
    const { tasks, calls } = fakes({
      sweep: () => (fail ? Promise.reject(new Error('x')) : Promise.resolve({ expired: 0, unconfirmed: 0 })),
    });
    tasks.startTimers(() => true);
    await vi.advanceTimersByTimeAsync(60_000);
    fail = false;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls.sweep).toBe(2);
    tasks.stopTimers();
  });
});

describe('actividad reciente', () => {
  it('qué rutas cuentan', () => {
    for (const path of [
      '/api/health',
      '/api/health/ready',
      '/api/public/catalog-version',
      '/api/internal/tasks',
    ]) {
      expect(countsAsActivity(path), path).toBe(false);
    }
    for (const path of ['/api/auth/session', '/api/public/catalog', '/api/orders', '/api/health/x']) {
      expect(countsAsActivity(path), path).toBe(true);
    }
    expect(countsAsActivity('/carta')).toBe(false);
  });

  it('vale 5 minutos desde la última petición', () => {
    const clock = new FakeClock();
    const monitor = new ActivityMonitor(clock);
    expect(monitor.isActive()).toBe(false);
    monitor.touch();
    clock.ms += 5 * 60_000 - 1;
    expect(monitor.isActive()).toBe(true);
    clock.ms += 1;
    expect(monitor.isActive()).toBe(false);
  });
});

describe('/api/health/ready (D-M10-6)', () => {
  function appWith(db: Pick<PrismaClient, '$queryRaw'>) {
    const app = express();
    app.use(requestContext(silent));
    app.use('/api', readyRouter(db as PrismaClient));
    app.use(errorHandler);
    return app;
  }

  it('200 si la base responde', async () => {
    const res = await request(appWith({ $queryRaw: (() => Promise.resolve([{ '?column?': 1 }])) as never }))
      .get('/api/health/ready')
      .expect(200);
    expect(res.body).toEqual({ status: 'ready' });
  });

  it('503 sin detalles si la base no responde', async () => {
    const failing = () =>
      Promise.reject(new Error('connect ECONNREFUSED postgresql://usuario:clave@neon.example/marea'));
    const res = await request(appWith({ $queryRaw: failing as never }))
      .get('/api/health/ready')
      .expect(503);
    expect(res.body).toEqual({ status: 'unavailable' });
    expect(JSON.stringify(res.body)).not.toContain('neon');
  });
});
