/** Reloj inyectable: las pruebas de expiración y de límites usan un reloj simulado (R-SEC-05). */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
