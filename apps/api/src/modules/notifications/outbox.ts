import { resolveLocale, type Locale } from '@marea-baja/shared';
import type { Logger } from 'pino';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.ts';
import type { Clock } from '../../lib/clock.ts';
import { MINUTE } from '../../lib/clock.ts';
import type { EmailProvider } from './providers.ts';
import { renderEmail, type EmailData } from './templates/render.ts';
import { EMAIL_TEMPLATES, type EmailTemplate } from './templates/messages.ts';

/**
 * Outbox de correos (§8.5). El correo se inserta en `EmailOutbox` **en la misma transacción**
 * que el evento: si la operación se revierte, el correo no existe. El envío ocurre después del
 * commit, con reintentos exponenciales (máximo 5 intentos).
 *
 * El enlace con el token de un solo uso viaja en `payload` solo hasta el envío: al quedar en
 * `SENT` o `FAILED`, el enlace se borra de la fila (en la base el token solo existe como hash).
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
      payload: { name: email.data.name, actionUrl: email.data.actionUrl },
      nextAttemptAt: now,
      createdAt: now,
    },
  });
}

/** Espera tras el intento n (1, 2, 4, 8 min…). */
export function retryDelayMs(attempt: number): number {
  return 2 ** Math.max(0, attempt - 1) * MINUTE;
}

function isTemplate(value: string): value is EmailTemplate {
  return (EMAIL_TEMPLATES as readonly string[]).includes(value);
}

function readPayload(payload: unknown): EmailData | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const { name, actionUrl } = payload as Record<string, unknown>;
  return typeof name === 'string' && typeof actionUrl === 'string' ? { name, actionUrl } : null;
}

export interface OutboxResult {
  sent: number;
  retried: number;
  failed: number;
}

/**
 * Procesa los correos pendientes. `FOR UPDATE SKIP LOCKED` evita que dos procesos tomen el mismo
 * correo. Cada correo se reclama y se cierra en transacciones cortas: el envío ocurre fuera.
 */
export async function processOutbox(
  deps: { db: PrismaClient; provider: EmailProvider; clock: Clock; logger: Logger },
  limit = 20,
): Promise<OutboxResult> {
  const result: OutboxResult = { sent: 0, retried: 0, failed: 0 };
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

    const data = readPayload(claimed.payload);
    const outcome =
      data && isTemplate(claimed.template)
        ? await deps.provider.send({
            to: claimed.to,
            ...renderEmail(claimed.template, fromPrismaLocale(claimed.locale), data),
          })
        : { accepted: false, error: 'Plantilla o datos inválidos' };

    const finished = deps.clock.now();
    if (outcome.accepted) {
      await deps.db.emailOutbox.update({
        where: { id: claimed.id },
        data: {
          status: 'SENT',
          sentAt: finished,
          providerMessageId: outcome.providerMessageId ?? null,
          lastError: null,
          payload: {},
        },
      });
      result.sent += 1;
    } else if (claimed.attempts >= OUTBOX_MAX_ATTEMPTS || !data) {
      await deps.db.emailOutbox.update({
        where: { id: claimed.id },
        data: { status: 'FAILED', lastError: outcome.error?.slice(0, 500) ?? null, payload: {} },
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
          await this.#run();
        } catch (error) {
          this.#logger.error({ err: error }, 'outbox cycle failed');
        }
      } while (this.#takeAgain());
    })().finally(() => {
      this.#running = null;
    });
    return this.#running;
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
