import { DAY, HOUR, MINUTE } from '../../lib/clock.ts';

/**
 * Límites y plazos de pagos (§8.4 y §7.3). Los límites de autorizar y de las operaciones de admin
 * vienen de la tabla "Políticas iniciales" de la propuesta; los plazos son de implementación
 * (ADR 0007).
 */
export const PAYMENT_LIMITS = {
  /** Autorizar pago: 30 / h por IP y 10 / h por pedido (§8.4). */
  authorizePerIp: { max: 30, windowMs: HOUR },
  authorizePerOrder: { max: 10, windowMs: HOUR },
  /** Contra entrega: mismo límite por pedido que autorizar (implementación). */
  cashPerOrder: { max: 10, windowMs: HOUR },
  /** Reembolsos y operaciones de staff/admin: 30 / 10 min por usuario, con AuditLog al exceder. */
  adminPerUser: { max: 30, windowMs: 10 * MINUTE },
} as const;

export const PAYMENT_TIMING = {
  idempotencyLockMs: 30 * 1000,
  idempotencyTtlMs: DAY,
  /**
   * Una operación `REQUESTED` más vieja que esto se considera interrumpida (la API se cayó entre
   * registrar la intención y llamar al procesador): la reconciliación la reintenta con la misma
   * clave. Más corta sería pisar una petición que todavía está en curso.
   */
  requestedStaleMs: 30 * 1000,
  /** Cada cuánto corre la reconciliación mientras la API está despierta. */
  reconcileEveryMs: 5 * 1000,
} as const;
