import { resolveLocale, type Locale } from '@marea-baja/shared';
import type { Logger } from 'pino';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.ts';
import type { Clock } from '../../lib/clock.ts';
import { MINUTE } from '../../lib/clock.ts';
import type { EmailProvider } from './providers.ts';
import {
  isEmailTemplate,
  isOrderTemplate,
  renderEmail,
  type EmailData,
  type EmailTemplate,
} from './templates/render.ts';

/**
 * Outbox de correos (§8.5). El correo se inserta en `EmailOutbox` **en la misma transacción**
 * que el evento: si la operación se revierte, el correo no existe. El envío ocurre después del
 * commit, con reintentos exponenciales (máximo 5 intentos).
 *
 * El enlace con el token de un solo uso viaja en `payload` solo hasta el envío: al quedar en
 * `SENT`, `DEMO_ONLY` o `FAILED`, el enlace se borra de la fila (en la base el token solo existe
 * como hash). Los correos de pedidos (M7) conservan su `payload` (nombre, código del pedido, enlace
 * a la página del pedido, monto del reembolso): no tiene secretos y la bandeja de demostración lo
 * necesita para mostrar el correo.
 *
 * Estados honestos (§8.5): `SENT` solo si el proveedor lo aceptó; `DEMO_ONLY` si el destinatario
 * no puede recibir correo real y no se intentó enviarlo; `FAILED` con el error tras 5 intentos.
 */
export const OUTBOX_MAX_ATTEMPTS = 5;

type Db = Prisma.TransactionClient;

export interface OutboxEmail {
  userId: string | null;
  to: string;
  locale: Locale;
  template: EmailTemplate;
  data: EmailData;
}

const prismaLocale = (locale: Locale): 'es_CR' | 'en' => (locale === 'es-CR' ? 'es_CR' : 'en');
const fromPrismaLocale = (locale: string): Locale => resolveLocale(locale.replace('_', '-'));

export async function enqueueEmail(db: Db, email: OutboxEmail, now: Date): Promise<void> {
  await db.emailOutbox.create({
    data: {
      userId: email.userId,
      to: email.to,
      locale: prismaLocale(email.locale),
      template: email.template,
      payload: payloadOf(email.data),
      nextAttemptAt: now,
      createdAt: now,
    },
  });
}

/** Espera tras el intento n (1, 2, 4, 8 min…). */
export function retryDelayMs(attempt: number): number {
  return 2 ** Math.max(0, attempt - 1) * MINUTE;
}

function payloadOf(data: EmailData): Prisma.InputJsonObject {
  return {
    name: data.name,
    actionUrl: data.actionUrl,
    ...(data.orderCode ? { orderCode: data.orderCode } : {}),
    ...(data.amount ? { amount: data.amount } : {}),
    ...(data.fulfillmentType ? { fulfillmentType: data.fulfillmentType } : {}),
  };
}

/** Lee el `payload` guardado. Lo que falta o tiene otro tipo se ignora. */
export function readPayload(payload: unknown): Partial<EmailData> {
  if (typeof payload !== 'object' || payload === null) return {};
  const raw = payload as Record<string, unknown>;
  const text = (key: string) => (typeof raw[key] === 'string' ? raw[key] : undefined);
  const fulfillment = text('fulfillmentType');
  const data: Partial<EmailData> = {};
  const name = text('name');
  const actionUrl = text('actionUrl');
  const orderCode = text('orderCode');
  const amount = text('amount');
  if (name !== undefined) data.name = name;
  if (actionUrl !== undefined) data.actionUrl = actionUrl;
  if (orderCode !== undefined) data.orderCode = orderCode;
  if (amount !== undefined) data.amount = amount;
  if (fulfillment === 'PICKUP' || fulfillment === 'DELIVERY') data.fulfillmentType = fulfillment;
  return data;
}

function completePayload(payload: unknown): EmailData | null {
  const data = readPayload(payload);
  return data.name !== undefined && data.actionUrl !== undefined
    ? { ...data, name: data.name, actionUrl: data.actionUrl }
    : null;
}

/** Al cerrar el correo: los de enlace de un solo uso pierden el enlace; los de pedidos lo conservan. */
function closedPayload(template: string, payload: unknown): Prisma.InputJsonObject {
  if (!isOrderTemplate(template)) return {};
  const data = completePayload(payload);
  return data ? payloadOf(data) : {};
}

export interface OutboxResult {
  sent: number;
  retried: number;
  failed: number;
  demoOnly: number;
}

/**
 * Procesa los correos pendientes. `FOR UPDATE SKIP LOCKED` evita que dos procesos tomen el mismo
 * correo. Cada correo se reclama y se cierra en transacciones cortas: el envío ocurre fuera.
 */
export async function processOutbox(
  deps: { db: PrismaClient; provider: EmailProvider; clock: Clock; logger: Logger },
  limit = 20,
): Promise<OutboxResult> {
  const result: OutboxResult = { sent: 0, retried: 0, failed: 0, demoOnly: 0 };
  for (let i = 0; i < limit; i += 1) {
    const now = deps.clock.now();
    const claimed = await deps.db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "EmailOutbox"
        WHERE status = 'QUEUED' AND "nextAttemptAt" <= ${now}
        ORDER BY "createdAt"
        FOR UPDATE SKIP LOCKED
        LIMIT 1`;
      const id = rows[0]?.id;
      if (!id) return null;
      // Reclamo: el próximo intento queda en el futuro mientras este se envía.
      return tx.emailOutbox.update({
        where: { id },
        data: {
          attempts: { increment: 1 },
          nextAttemptAt: new Date(now.getTime() + retryDelayMs(OUTBOX_MAX_ATTEMPTS)),
        },
      });
    });
    if (!claimed) break;

    const data = completePayload(claimed.payload);
    let outcome: Awaited<ReturnType<EmailProvider['send']>>;
    try {
      outcome =
        data && isEmailTemplate(claimed.template)
          ? await deps.provider.send({
              to: claimed.to,
              ...renderEmail(claimed.template, fromPrismaLocale(claimed.locale), data),
            })
          : { accepted: false, error: 'Plantilla o datos inválidos' };
    } catch {
      outcome = { accepted: false, error: 'Plantilla o datos inválidos' };
    }

    const finished = deps.clock.now();
    if (outcome.accepted) {
      await deps.db.emailOutbox.update({
        where: { id: claimed.id },
        data: {
          status: 'SENT',
          sentAt: finished,
          providerMessageId: outcome.providerMessageId ?? null,
          lastError: null,
          payload: closedPayload(claimed.template, claimed.payload),
        },
      });
      result.sent += 1;
    } else if (outcome.demoOnly && data) {
      // §8.5: el destinatario no puede recibir correo real; no se intentó enviarlo.
      await deps.db.emailOutbox.update({
        where: { id: claimed.id },
        data: {
          status: 'DEMO_ONLY',
          sentAt: finished,
          lastError: null,
          payload: closedPayload(claimed.template, claimed.payload),
        },
      });
      result.demoOnly += 1;
    } else if (claimed.attempts >= OUTBOX_MAX_ATTEMPTS || !data) {
      await deps.db.emailOutbox.update({
        where: { id: claimed.id },
        data: {
          status: 'FAILED',
          lastError: outcome.error?.slice(0, 500) ?? null,
          payload: closedPayload(claimed.template, claimed.payload),
        },
      });
      deps.logger.warn({ outboxId: claimed.id, template: claimed.template }, 'email failed permanently');
      result.failed += 1;
    } else {
      await deps.db.emailOutbox.update({
        where: { id: claimed.id },
        data: {
          lastError: outcome.error?.slice(0, 500) ?? null,
          nextAttemptAt: new Date(finished.getTime() + retryDelayMs(claimed.attempts)),
        },
      });
      result.retried += 1;
    }
  }
  return result;
}

/**
 * Corre `processOutbox` después de cada commit que encoló correos y cada 30 s mientras la API
 * está despierta (§4.3: jobs sin servidor de colas). Nunca corre dos veces a la vez.
 */
export class OutboxWorker {
  readonly #run: () => Promise<OutboxResult>;
  readonly #logger: Logger;
  #running: Promise<void> | null = null;
  #again = false;
  #timer: NodeJS.Timeout | undefined;
  /** M10: conteos de los ciclos que corrieron mientras alguien esperaba con `drain()`. */
  readonly #collectors = new Set<OutboxResult>();

  constructor(run: () => Promise<OutboxResult>, logger: Logger) {
    this.#run = run;
    this.#logger = logger;
  }

  /** Pide un ciclo; si ya hay uno en curso, se repite al terminar. */
  kick(): Promise<void> {
    if (this.#running) {
      this.#again = true;
      return this.#running;
    }
    this.#running = (async () => {
      do {
        this.#again = false;
        try {
          const result = await this.#run();
          for (const total of this.#collectors) {
            total.sent += result.sent;
            total.retried += result.retried;
            total.failed += result.failed;
            total.demoOnly += result.demoOnly;
          }
        } catch (error) {
          this.#logger.error({ err: error }, 'outbox cycle failed');
        }
      } while (this.#takeAgain());
    })().finally(() => {
      this.#running = null;
    });
    return this.#running;
  }

  /**
   * M10 (ADR 0010, D-M10-1): corre un ciclo como `kick()` y devuelve los conteos de los ciclos que
   * terminaron mientras esperaba. Lo usa el endpoint interno de tareas.
   */
  async drain(): Promise<OutboxResult> {
    const total: OutboxResult = { sent: 0, retried: 0, failed: 0, demoOnly: 0 };
    this.#collectors.add(total);
    try {
      await this.kick();
    } finally {
      this.#collectors.delete(total);
    }
    return total;
  }

  /** `kick()` puede haber pedido otro ciclo mientras corría este. */
  #takeAgain(): boolean {
    return this.#again;
  }

  start(intervalMs = 30_000): void {
    this.#timer = setInterval(() => void this.kick(), intervalMs);
    this.#timer.unref();
  }

  stop(): void {
    clearInterval(this.#timer);
  }

  /** Espera a que termine el ciclo en curso (pruebas y apagado ordenado). */
  async idle(): Promise<void> {
    await this.#running;
  }
}
