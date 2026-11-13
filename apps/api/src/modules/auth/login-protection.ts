import type { PrismaClient } from '../../generated/prisma/client.ts';
import type { AppConfig } from '../../config/app-config.ts';
import { AppError, rateLimited } from '../../http/errors.ts';
import { MINUTE, type Clock } from '../../lib/clock.ts';
import { hmac } from '../../lib/crypto.ts';
import type { RateLimiter } from '../rate-limit/rate-limiter.ts';
import { AUTH_LIMITS, lockDurationMs, loginDelayMs } from './policies.ts';

/**
 * Protección del login (§8.4):
 * - por IP: 30 intentos / 15 min;
 * - por cuenta+IP: demora progresiva desde el 4.º fallo y bloqueo temporal tras 10 fallos
 *   (15 min, luego 1 h y 4 h). Nunca es permanente y no afecta a otras IP;
 * - por cuenta (todas las IP): al superar el umbral global, **no bloquea**: exige Turnstile (D8).
 * Todo funciona igual para correos inexistentes, así las respuestas no revelan si la cuenta existe.
 */
export interface LoginSubject {
  ipKey: string;
  accountKey: string;
  accountIpKey: string;
  lockKey: string;
  delayKey: string;
}

export class LoginProtection {
  readonly #db: PrismaClient;
  readonly #limiter: RateLimiter;
  readonly #clock: Clock;
  readonly #config: AppConfig;

  constructor(deps: { db: PrismaClient; limiter: RateLimiter; clock: Clock; config: AppConfig }) {
    this.#db = deps.db;
    this.#limiter = deps.limiter;
    this.#clock = deps.clock;
    this.#config = deps.config;
  }

  subject(email: string, ipHash: string): LoginSubject {
    const account = hmac(this.#config.appSecret, `email:${email}`);
    return {
      ipKey: `login:ip:${ipHash}`,
      accountKey: `login:acct:${account}`,
      accountIpKey: `login:acct-ip:${account}:${ipHash}`,
      lockKey: `lock:${account}:${ipHash}`,
      delayKey: `delay:${account}:${ipHash}`,
    };
  }

  /** Umbral global vigente: `RestaurantSettings` (ajustable en M8) o los valores del entorno. */
  async challengePolicy(): Promise<{ threshold: number; windowMs: number }> {
    const settings = await this.#db.restaurantSettings.findUnique({
      where: { id: 1 },
      select: { turnstileGlobalThreshold: true, turnstileWindowMinutes: true },
    });
    const threshold = settings?.turnstileGlobalThreshold ?? this.#config.turnstileDefaults.threshold;
    const minutes = settings?.turnstileWindowMinutes ?? this.#config.turnstileDefaults.windowMinutes;
    return { threshold, windowMs: minutes * MINUTE };
  }

  /**
   * Antes de evaluar la contraseña: límite por IP, bloqueo y demora de cuenta+IP.
   * Devuelve si la cuenta exige el desafío.
   */
  async before(subject: LoginSubject): Promise<{ challengeRequired: boolean }> {
    const perIp = await this.#limiter.hit(subject.ipKey, AUTH_LIMITS.login.perIp.windowMs);
    if (perIp.count > AUTH_LIMITS.login.perIp.max) throw rateLimited(perIp.resetInMs / 1000);

    const now = this.#clock.now();
    const locks = await this.#db.loginLock.findMany({
      where: { subjectKey: { in: [subject.lockKey, subject.delayKey] }, lockedUntil: { gt: now } },
      select: { lockedUntil: true },
    });
    const until = Math.max(0, ...locks.map((lock) => lock.lockedUntil.getTime()));
    if (until > now.getTime()) throw rateLimited((until - now.getTime()) / 1000);

    const policy = await this.challengePolicy();
    const global = await this.#limiter.peek(subject.accountKey, policy.windowMs);
    return { challengeRequired: global.count >= policy.threshold };
  }

  /** Registra un fallo y lanza la respuesta que corresponde. */
  async failure(subject: LoginSubject): Promise<never> {
    const policy = await this.challengePolicy();
    const global = await this.#limiter.hit(subject.accountKey, policy.windowMs);
    const challengeRequired = global.count >= policy.threshold;
    const local = await this.#limiter.hit(subject.accountIpKey, AUTH_LIMITS.login.accountIpWindowMs);
    const now = this.#clock.now();

    if (local.count >= AUTH_LIMITS.login.lockAfterFailures) {
      const previous = await this.#db.loginLock.findUnique({ where: { subjectKey: subject.lockKey } });
      const recent =
        previous !== null &&
        now.getTime() - previous.updatedAt.getTime() < AUTH_LIMITS.login.lockLevelMemoryMs;
      const level = recent ? previous.level + 1 : 1;
      const lockedUntil = new Date(now.getTime() + lockDurationMs(level));
      await this.#db.loginLock.upsert({
        where: { subjectKey: subject.lockKey },
        create: { subjectKey: subject.lockKey, lockedUntil, level },
        update: { lockedUntil, level },
      });
      await this.#limiter.reset(subject.accountIpKey);
      throw rateLimited(lockDurationMs(level) / 1000);
    }

    const delay = loginDelayMs(local.count);
    if (delay > 0) {
      const lockedUntil = new Date(now.getTime() + delay);
      await this.#db.loginLock.upsert({
        where: { subjectKey: subject.delayKey },
        create: { subjectKey: subject.delayKey, lockedUntil, level: 1 },
        update: { lockedUntil },
      });
    }
    const seconds = Math.ceil(delay / 1000);
    throw new AppError(
      401,
      'INVALID_CREDENTIALS',
      'Invalid email or password',
      {
        ...(challengeRequired ? { challengeRequired: true } : {}),
        ...(delay > 0 ? { retryAfterSeconds: seconds } : {}),
      },
      delay > 0 ? { 'Retry-After': String(seconds) } : {},
    );
  }

  /** Un login exitoso reinicia los contadores y bloqueos de cuenta+IP (§8.4). */
  async success(subject: LoginSubject): Promise<void> {
    await this.#limiter.reset(subject.accountIpKey);
    await this.#db.loginLock.deleteMany({
      where: { subjectKey: { in: [subject.lockKey, subject.delayKey] } },
    });
  }
}
