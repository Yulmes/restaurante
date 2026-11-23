import { rateLimited } from '../../http/errors.ts';
import { DAY, HOUR, MINUTE } from '../../lib/clock.ts';
import type { RateLimiter } from '../rate-limit/rate-limiter.ts';

/**
 * Límites y plazos del pedido (M5). La propuesta no fija límites para el carrito ni para crear
 * pedidos (§8.4 solo cubre autorizar pagos, M6): estos son **valores de implementación**,
 * documentados en el ADR 0006. Complementan el freno global de ráfagas (300 / 5 min por IP).
 */
export const ORDER_LIMITS = {
  /** Cotizar y editar el carrito: por IP (los invitados también cotizan). */
  cartPerIp: { max: 240, windowMs: 10 * MINUTE },
  /** Fusiones del carrito: por cuenta. */
  mergePerAccount: { max: 30, windowMs: 10 * MINUTE },
  /** Crear pedidos: por cuenta y por IP. */
  ordersPerAccount: { max: 20, windowMs: HOUR },
  ordersPerIp: { max: 60, windowMs: HOUR },
  /** Altas, cambios y bajas de direcciones: por cuenta. */
  addressesPerAccount: { max: 60, windowMs: HOUR },
} as const;

export const ORDER_TIMING = {
  /** Un pedido sin pagar se cancela a los 30 min (§7.1); el job que lo aplica es de M7. */
  pendingPaymentTtlMs: 30 * MINUTE,
  /** Mismo usuario y carrito idéntico en menos de 60 s → el pedido existente (§7.3, punto 5). */
  duplicateWindowMs: 60 * 1000,
  /** Mientras la primera petición con una `Idempotency-Key` se procesa, la clave queda tomada. */
  idempotencyLockMs: 30 * 1000,
  /** Cuánto se recuerda una `Idempotency-Key` con su respuesta. */
  idempotencyTtlMs: DAY,
  /** Cuánto se recuerda una `mergeKey` ya fusionada (idempotencia de la fusión, §7.5). */
  mergeKeyTtlMs: 30 * DAY,
} as const;

export async function enforceLimit(
  limiter: RateLimiter,
  key: string,
  rule: { max: number; windowMs: number },
): Promise<void> {
  const state = await limiter.hit(key, rule.windowMs);
  if (state.count > rule.max) throw rateLimited(state.resetInMs / 1000);
}
