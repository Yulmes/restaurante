/**
 * Arranque de la API: `npm run dev -w @marea-baja/api` (o `node src/server.ts`).
 * Valida el entorno (si falta algo, no arranca), conecta la base y procesa el outbox cada 30 s.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.ts';
import { appConfigFromEnv } from './config/app-config.ts';
import { EnvValidationError, loadEnv, type Env } from './config/env.ts';
import { createLogger } from './config/logger.ts';
import { createPrismaClient } from './db/client.ts';
import { HOUR, systemClock } from './lib/clock.ts';
import { FakeBotCheck, TurnstileBotCheck, type BotCheck } from './modules/bot-check/bot-check.ts';
import {
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

function emailProvider(): EmailProvider {
  switch (env.EMAIL_PROVIDER) {
    case 'resend':
      return new ResendProvider(env.RESEND_API_KEY ?? '', env.EMAIL_FROM);
    case 'memory':
      return new MemoryEmailProvider();
    case 'mailpit':
      return new MailpitProvider(env.MAILPIT_URL, env.EMAIL_FROM);
  }
}

const botCheck: BotCheck =
  env.BOT_CHECK_PROVIDER === 'turnstile'
    ? new TurnstileBotCheck(env.TURNSTILE_SECRET_KEY ?? '')
    : new FakeBotCheck();

const db = createPrismaClient(env.DATABASE_URL);
const { app, outbox, limiter } = createApp({
  config,
  db,
  logger,
  clock: systemClock,
  email: emailProvider(),
  botCheck,
});

outbox.start();
// Limpieza de ventanas de límites de más de 24 h (§8.4), una vez por hora mientras la API está despierta.
setInterval(() => {
  limiter.purgeOlderThan(24 * HOUR).catch((error: unknown) => {
    logger.error({ err: error }, 'rate limit purge failed');
  });
}, HOUR).unref();

const server = app.listen(env.API_PORT, () => {
  logger.info(
    { port: env.API_PORT, emailProvider: env.EMAIL_PROVIDER, botCheck: env.BOT_CHECK_PROVIDER },
    'API lista',
  );
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'apagando');
  outbox.stop();
  server.close();
  await outbox.idle();
  await db.$disconnect();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
