/**
 * Arranque de la API: `npm run dev -w @marea-baja/api` (o `node src/server.ts`).
 * Valida el entorno (si falta algo, no arranca), conecta la base y arranca las tareas periódicas
 * (outbox, reconciliación de pagos, barridos y purga; ver `modules/tasks/background.ts`).
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.ts';
import { appConfigFromEnv } from './config/app-config.ts';
import { EnvValidationError, loadEnv, type Env } from './config/env.ts';
import { createLogger } from './config/logger.ts';
import { createPrismaClient } from './db/client.ts';
import { systemClock } from './lib/clock.ts';
import { FakeBotCheck, TurnstileBotCheck, type BotCheck } from './modules/bot-check/bot-check.ts';
import {
  DeliverableRecipients,
  DemoInboxProvider,
  MailpitProvider,
  MemoryEmailProvider,
  ResendProvider,
  type EmailProvider,
} from './modules/notifications/providers.ts';

const rootEnvFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile);

let env: Env;
try {
  env = loadEnv();
} catch (error) {
  if (error instanceof EnvValidationError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}

const production = env.NODE_ENV === 'production';
const logger = createLogger({ level: env.LOG_LEVEL ?? (production ? 'info' : 'debug'), pretty: !production });
const config = appConfigFromEnv(env);

function baseEmailProvider(): EmailProvider {
  switch (env.EMAIL_PROVIDER) {
    case 'resend':
      return new ResendProvider(env.RESEND_API_KEY ?? '', env.EMAIL_FROM);
    case 'memory':
      return new MemoryEmailProvider();
    case 'mailpit':
      return new MailpitProvider(env.MAILPIT_URL, env.EMAIL_FROM);
    case 'demo':
      return new DemoInboxProvider();
  }
}

/** M7 (§8.5, C9): con `EMAIL_DELIVERABLE_TO`, el resto de los destinatarios queda `DEMO_ONLY`. */
function emailProvider(): EmailProvider {
  const base = baseEmailProvider();
  return env.EMAIL_DELIVERABLE_TO.length > 0
    ? new DeliverableRecipients(base, env.EMAIL_DELIVERABLE_TO)
    : base;
}

const botCheck: BotCheck =
  env.BOT_CHECK_PROVIDER === 'turnstile'
    ? new TurnstileBotCheck(env.TURNSTILE_SECRET_KEY ?? '')
    : new FakeBotCheck();

const db = createPrismaClient(env.DATABASE_URL);
const { app, outbox, tasks, activity } = createApp({
  config,
  db,
  logger,
  clock: systemClock,
  email: emailProvider(),
  botCheck,
});

// Tareas periódicas (ADR 0010, D-M10-1): reconciliación de pagos cada 5 s (M6), barridos de pedidos
// cada minuto (M7), reintentos del outbox cada 30 s y purga de límites cada hora. En producción solo
// corren con actividad reciente (5 min), para que Neon pueda suspenderse; el resto lo cubre el
// endpoint interno que dispara el Cron Trigger del Worker cada 30 min.
tasks.startTimers(production ? () => activity.isActive() : () => true);

const server = app.listen(env.API_PORT, () => {
  logger.info(
    {
      port: env.API_PORT,
      emailProvider: env.EMAIL_PROVIDER,
      botCheck: env.BOT_CHECK_PROVIDER,
      demoPayments: env.DEMO_PAYMENTS_ENABLED,
      ordersOutsideHours: env.ORDERS_ALLOW_OUTSIDE_HOURS,
      demoEmailVerification: env.DEMO_EMAIL_VERIFICATION_ENABLED,
      originProtected: env.ORIGIN_SECRETS.length > 0,
      tasksEndpoint: env.TASKS_SECRETS.length > 0,
    },
    'API lista',
  );
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'apagando');
  tasks.stopTimers();
  outbox.stop();
  server.close();
  await tasks.idle();
  await outbox.idle();
  await db.$disconnect();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
