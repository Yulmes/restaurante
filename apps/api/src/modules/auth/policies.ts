import { DAY, HOUR, MINUTE } from '../../lib/clock.ts';

/**
 * Políticas iniciales de límites y bloqueos (§8.4, tabla "Políticas iniciales").
 * Los valores marcados como "implementación" no los fija la propuesta y se documentan en
 * SECURITY.md.
 */
export const AUTH_LIMITS = {
  /** Freno global de ráfagas en memoria, por IP (express-rate-limit). */
  burst: { max: 300, windowMs: 5 * MINUTE },
  login: {
    perIp: { max: 30, windowMs: 15 * MINUTE },
    /** Ventana de fallos por cuenta+IP (implementación: igual que la de la IP). */
    accountIpWindowMs: 15 * MINUTE,
    /** Demora progresiva desde el 4.º fallo: 2ⁿ s con n = fallos − 3, máximo 60 s. */
    delayFromFailure: 4,
    maxDelayMs: 60_000,
    /** 10 fallos → bloqueo de cuenta+IP: 15 min, luego 1 h y 4 h. */
    lockAfterFailures: 10,
    lockDurationsMs: [15 * MINUTE, HOUR, 4 * HOUR] as const,
    /** Tras 24 h sin bloqueos, el escalamiento vuelve al primer nivel (implementación). */
    lockLevelMemoryMs: DAY,
  },
  register: { perIp: { max: 5, windowMs: HOUR } },
  forgotPassword: {
    perIp: { max: 5, windowMs: HOUR },
    /** Silencioso: la respuesta es idéntica, pero no sale otro correo. */
    perEmail: { max: 3, windowMs: HOUR },
  },
  resendVerification: {
    perIp: { max: 10, windowMs: HOUR },
    perAccountShort: { max: 1, windowMs: MINUTE },
    perAccountDaily: { max: 5, windowMs: DAY },
  },
  profile: {
    /** Cambio de contraseña con la actual: mismo freno por IP que el login (implementación). */
    changePasswordPerIp: { max: 30, windowMs: 15 * MINUTE },
  },
} as const;

/** Vigencia de los enlaces de un solo uso (§8.7). */
export const TOKEN_TTL = {
  emailVerificationMs: DAY,
  passwordResetMs: 30 * MINUTE,
} as const;

export function loginDelayMs(failures: number): number {
  if (failures < AUTH_LIMITS.login.delayFromFailure) return 0;
  const n = failures - (AUTH_LIMITS.login.delayFromFailure - 1);
  return Math.min(2 ** n * 1000, AUTH_LIMITS.login.maxDelayMs);
}

export function lockDurationMs(level: number): number {
  const durations = AUTH_LIMITS.login.lockDurationsMs;
  return durations[Math.min(level, durations.length) - 1] ?? durations[durations.length - 1] ?? HOUR;
}
