import type { Logger } from 'pino';
import { HOUR, type Clock } from '../../lib/clock.ts';
import type { OutboxResult, OutboxWorker } from '../notifications/outbox.ts';
import type { OperationsService } from '../orders/operations.ts';
import { ORDER_TIMING } from '../orders/policies.ts';
import { PAYMENT_TIMING } from '../payments/policies.ts';
import type { PaymentService } from '../payments/service.ts';
import type { RateLimiter } from '../rate-limit/rate-limiter.ts';

/**
 * Tareas periódicas de la API (ADR 0010, D-M10-1): reconciliación de pagos (§7.3), barridos de
 * pedidos (§7.1), reintentos del outbox (§8.5) y purga de las ventanas de límites (§8.4).
 *
 * Dos formas de correrlas, con las mismas guardas:
 * - **temporizadores** dentro del proceso, como en M6–M7, pero solo mientras `gate()` lo permita
 *   (en producción: actividad reciente, ver `activity.ts`);
 * - **una vuelta completa** (`runAll`) desde el endpoint interno, que dispara el Cron Trigger del
 *   Worker cada 30 min, o a mano.
 *
 * Cada tarea es de "un vuelo a la vez": si ya corre, quien llega espera la misma ejecución en lugar
 * de empezar otra. Todas son idempotentes y seguras frente a peticiones simultáneas (bloquean filas
 * y solo cambian lo que sigue abierto), así que un disparo perdido no pierde trabajo: lo hace el
 * siguiente.
 */
export const RECONCILE_MAX_PASSES = 5;
/** Tiempo máximo de la reconciliación dentro de una vuelta; el resto queda para la siguiente. */
export const RECONCILE_BUDGET_MS = 20_000;
export const PURGE_OLDER_THAN_MS = 24 * HOUR;

export interface TaskOutcome {
  ok: boolean;
}

export interface TasksReport {
  ok: boolean;
  durationMs: number;
  sweep: TaskOutcome & { expired: number; unconfirmed: number };
  reconcile: TaskOutcome & { resolved: number; pending: number; passes: number };
  outbox: TaskOutcome & OutboxResult;
  purge: TaskOutcome & { removed: number };
}

export class TasksBusyError extends Error {
  constructor() {
    super('Tasks already running');
    this.name = 'TasksBusyError';
  }
}

interface SweepResult {
  expired: number;
  unconfirmed: number;
}
interface ReconcileResult {
  resolved: number;
  pending: number;
}

/** Una ejecución a la vez; quien llega mientras corre recibe la misma promesa. */
class SingleFlight<T> {
  #current: Promise<T> | null = null;

  run(task: () => Promise<T>): Promise<T> {
    this.#current ??= task().finally(() => {
      this.#current = null;
    });
    return this.#current;
  }

  get busy(): boolean {
    return this.#current !== null;
  }
}

export interface BackgroundTasksDeps {
  payments: Pick<PaymentService, 'reconcile'>;
  operations: Pick<OperationsService, 'sweep'>;
  outbox: Pick<OutboxWorker, 'drain' | 'kick'>;
  limiter: Pick<RateLimiter, 'purgeOlderThan'>;
  clock: Clock;
  logger: Logger;
}

export class BackgroundTasks {
  readonly #d: BackgroundTasksDeps;
  readonly #reconcile = new SingleFlight<ReconcileResult>();
  readonly #sweep = new SingleFlight<SweepResult>();
  readonly #purge = new SingleFlight<number>();
  #round: Promise<TasksReport> | null = null;
  readonly #timers: NodeJS.Timeout[] = [];

  constructor(deps: BackgroundTasksDeps) {
    this.#d = deps;
  }

  reconcile(): Promise<ReconcileResult> {
    return this.#reconcile.run(() => this.#d.payments.reconcile(this.#d.logger));
  }

  sweep(): Promise<SweepResult> {
    return this.#sweep.run(() => this.#d.operations.sweep(this.#d.logger));
  }

  purge(): Promise<number> {
    return this.#purge.run(() => this.#d.limiter.purgeOlderThan(PURGE_OLDER_THAN_MS));
  }

  /**
   * Una vuelta completa: barrido → reconciliación (hasta 5 pasadas mientras resuelva algo y quede
   * tiempo) → outbox → purga. Una tarea que falla no corta las demás. Si ya hay una vuelta en curso,
   * lanza `TasksBusyError` (el endpoint responde 409).
   */
  runAll(): Promise<TasksReport> {
    if (this.#round) return Promise.reject(new TasksBusyError());
    this.#round = this.#runAll().finally(() => {
      this.#round = null;
    });
    return this.#round;
  }

  async #runAll(): Promise<TasksReport> {
    const started = this.#d.clock.now().getTime();
    const sweep = await this.#attempt('sweep', () => this.sweep(), { expired: 0, unconfirmed: 0 });

    const reconcile = await this.#attempt(
      'reconcile',
      async () => {
        const total = { resolved: 0, pending: 0, passes: 0 };
        const deadline = started + RECONCILE_BUDGET_MS;
        while (total.passes < RECONCILE_MAX_PASSES) {
          const pass = await this.reconcile();
          total.passes += 1;
          total.resolved += pass.resolved;
          total.pending = pass.pending;
          if (pass.resolved === 0 || this.#d.clock.now().getTime() >= deadline) break;
        }
        return total;
      },
      { resolved: 0, pending: 0, passes: 0 },
    );

    const outbox = await this.#attempt('outbox', () => this.#d.outbox.drain(), {
      sent: 0,
      retried: 0,
      failed: 0,
      demoOnly: 0,
    });
    const purge = await this.#attempt('purge', async () => ({ removed: await this.purge() }), {
      removed: 0,
    });

    return {
      ok: sweep.ok && reconcile.ok && outbox.ok && purge.ok,
      durationMs: this.#d.clock.now().getTime() - started,
      sweep,
      reconcile,
      outbox,
      purge,
    };
  }

  async #attempt<T extends object>(name: string, task: () => Promise<T>, empty: T): Promise<T & TaskOutcome> {
    try {
      return { ok: true, ...(await task()) };
    } catch (error) {
      // Solo el nombre de la tarea y el error; nunca datos de pedidos, pagos ni correos.
      this.#d.logger.error({ err: error, task: name }, 'background task failed');
      return { ok: false, ...empty };
    }
  }

  /**
   * Temporizadores en el proceso (M6–M7). Cada uno corre solo si `gate()` lo permite. En producción
   * el gate es la actividad reciente (D-M10-1); en desarrollo, siempre.
   */
  startTimers(gate: () => boolean): void {
    const every = (ms: number, task: () => Promise<unknown>, name: string) => {
      const timer = setInterval(() => {
        if (!gate()) return;
        task().catch((error: unknown) => {
          this.#d.logger.error({ err: error, task: name }, 'background task failed');
        });
      }, ms);
      timer.unref();
      this.#timers.push(timer);
    };
    every(PAYMENT_TIMING.reconcileEveryMs, () => this.reconcile(), 'reconcile');
    every(ORDER_TIMING.sweepEveryMs, () => this.sweep(), 'sweep');
    every(OUTBOX_RETRY_EVERY_MS, () => this.#d.outbox.kick(), 'outbox');
    every(HOUR, () => this.purge(), 'purge');
  }

  stopTimers(): void {
    for (const timer of this.#timers.splice(0)) clearInterval(timer);
  }

  /** Espera la vuelta en curso (apagado ordenado y pruebas). */
  async idle(): Promise<void> {
    await this.#round?.catch(() => undefined);
  }
}

/** Reintentos del outbox (§8.5): el envío inicial es inmediato (`kick()` después del commit). */
export const OUTBOX_RETRY_EVERY_MS = 30_000;
