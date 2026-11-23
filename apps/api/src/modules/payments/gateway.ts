import type { DemoScenario, PaymentFailureCode } from '@marea-baja/shared';

/**
 * Interfaz del procesador de pagos (§7.4): `authorize`, `capture`, `void`, `refund` y `retrieve`.
 * El módulo de pagos solo conoce esta interfaz. En la demo la implementa `MockGateway`; usar un
 * procesador real en otro proyecto sería otra implementación, sin tocar el servicio.
 *
 * Cada llamada lleva una **clave de idempotencia determinística**: repetirla devuelve el resultado
 * de la primera, nunca cobra dos veces (§7.3, punto 2).
 */
export type GatewayResult =
  /** Aprobada (autorizada, capturada, anulada o reembolsada según la operación). */
  | { outcome: 'SUCCEEDED'; ref: string }
  /** Rechazada: no se movió nada y se puede volver a intentar con otro intento. */
  | { outcome: 'DECLINED'; code: PaymentFailureCode; ref: string | null }
  /** El procesador la recibió pero todavía no la resolvió (se consulta con `retrieve`). */
  | { outcome: 'PENDING'; ref: string }
  /** Sin respuesta (tiempo agotado): el resultado real se averigua con `retrieve`. */
  | { outcome: 'UNKNOWN' };

export type RetrieveResult = GatewayResult | { outcome: 'NOT_FOUND' };

export interface AuthorizeInput {
  amountMinor: number;
  currency: 'CRC' | 'USD';
  /** Referencia legible (código del pedido). */
  reference: string;
  idempotencyKey: string;
  /** Solo la demo: el escenario elegido en el selector (§7.4). */
  scenario: DemoScenario;
}

export interface PaymentGateway {
  authorize(input: AuthorizeInput): Promise<GatewayResult>;
  capture(input: { ref: string; amountMinor: number; idempotencyKey: string }): Promise<GatewayResult>;
  void(input: { ref: string; idempotencyKey: string }): Promise<GatewayResult>;
  refund(input: { ref: string; amountMinor: number; idempotencyKey: string }): Promise<GatewayResult>;
  /** Resultado de una operación por su clave de idempotencia (reconciliación). */
  retrieve(idempotencyKey: string): Promise<RetrieveResult>;
}
