import type { AdminPayment, DemoScenario, Order, RefundRequest, RoleKey } from '@marea-baja/shared';
import type { Logger } from 'pino';
import type { AppConfig } from '../../config/app-config.ts';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.ts';
import { AppError } from '../../http/errors.ts';
import type { Clock } from '../../lib/clock.ts';
import { recordAudit } from '../audit/audit.ts';
import { hashJson } from '../cart/service.ts';
import { HttpIdempotency } from '../idempotency/http-idempotency.ts';
import { orderInclude, toOrder } from '../orders/service.ts';
import type { GatewayResult, PaymentGateway } from './gateway.ts';
import { assertTransition, refundedStatus, type PaymentStatus } from './machine.ts';
import { PAYMENT_TIMING } from './policies.ts';

/**
 * Pagos (M6, §7.2–7.4). Reglas que sostiene este servicio:
 *
 * 1. **El monto sale del pedido en la base**, nunca del cuerpo. No existe ningún endpoint que
 *    reciba un estado: el frontend no puede marcar nada como pagado.
 * 2. **Intención antes de la llamada externa:** cada operación (`AUTHORIZE`, `CAPTURE`, `VOID`,
 *    `REFUND`) se registra como `PaymentOperation REQUESTED`, con una clave determinística, y se
 *    confirma **antes** de llamar al procesador. Si la API se cae a mitad de camino, la
 *    reconciliación encuentra la operación y la repite con la misma clave: nunca se cobra dos veces.
 * 3. **Un pago por pedido** y el pago bloqueado con `SELECT … FOR UPDATE` en cada cambio:
 *    `authorize` solo en `REQUIRES_PAYMENT`; mientras está en `PROCESSING`, otro intento → 409.
 * 4. **Σ reembolsos ≤ capturado**, contando también los reembolsos en curso (§7.2).
 * 5. Cada cambio de estado pasa por la máquina de `machine.ts`.
 *
 * Límites de M6 (D-M6-2): capturar, anular y reembolsar se exponen solo para staff y admin, sin
 * interfaz, y **no cambian el estado del pedido**: M7 los conecta con el Pase (confirmar → capture,
 * cancelar → void) y M8 agrega la pantalla de reembolsos. El correo "Pedido recibido" es de M7
 * (D-M6-3).
 */
const AUTHORIZE_SCOPE = 'payments.authorize';
const REFUND_SCOPE = 'payments.refund';

type Tx = Prisma.TransactionClient;

export interface PaymentActor {
  userId: string;
  role: RoleKey;
}

interface LockedPayment {
  id: string;
  orderId: string;
  method: 'DEMO_CARD' | 'CASH_ON_DELIVERY';
  status: PaymentStatus;
  currency: 'CRC' | 'USD';
  amountAuthorizedMinor: number;
  amountCapturedMinor: number;
  amountRefundedMinor: number;
  gatewayRef: string | null;
  order: { code: string; status: string; expiresAt: Date | null; totalMinor: number };
}

const lockedPaymentSelect = {
  id: true,
  orderId: true,
  method: true,
  status: true,
  currency: true,
  amountAuthorizedMinor: true,
  amountCapturedMinor: true,
  amountRefundedMinor: true,
  gatewayRef: true,
  order: { select: { code: true, status: true, expiresAt: true, totalMinor: true } },
} as const satisfies Prisma.PaymentSelect;

const notFound = () => new AppError(404, 'NOT_FOUND', 'Order not found');
const notAllowed = () =>
  new AppError(409, 'PAYMENT_NOT_ALLOWED', 'The payment cannot do that in its current state');
const inProgress = () => new AppError(409, 'PAYMENT_IN_PROGRESS', 'A payment operation is in progress');

/** Datos auditables del pago (lista blanca `payment` del AuditLog). */
function auditSnapshot(payment: {
  status: string;
  method: string;
  amountAuthorizedMinor: number;
  amountCapturedMinor: number;
  amountRefundedMinor: number;
  order: { code: string };
}): Record<string, unknown> {
  return {
    orderCode: payment.order.code,
    status: payment.status,
    method: payment.method,
    amountAuthorizedMinor: payment.amountAuthorizedMinor,
    amountCapturedMinor: payment.amountCapturedMinor,
    amountRefundedMinor: payment.amountRefundedMinor,
  };
}

export class PaymentService {
  readonly #db: PrismaClient;
  readonly #clock: Clock;
  readonly #config: AppConfig;
  readonly #gateway: PaymentGateway;
  readonly #idempotency: HttpIdempotency;

  constructor(deps: { db: PrismaClient; clock: Clock; config: AppConfig; gateway: PaymentGateway }) {
    this.#db = deps.db;
    this.#clock = deps.clock;
    this.#config = deps.config;
    this.#gateway = deps.gateway;
    this.#idempotency = new HttpIdempotency(deps.db, deps.clock, {
      lockMs: PAYMENT_TIMING.idempotencyLockMs,
      ttlMs: PAYMENT_TIMING.idempotencyTtlMs,
    });
  }

  // ─── Cliente ─────────────────────────────────────────────────────────────────

  /**
   * `POST /orders/:id/payments/authorize` (§7.3): tarjeta demo con el escenario elegido. Responde
   * el pedido con el estado del pago: aprobado, rechazado (se puede reintentar) o en proceso.
   */
  async authorize(
    userId: string,
    orderId: string,
    key: string,
    scenario: DemoScenario,
  ): Promise<{ status: number; body: { order: Order } }> {
    if (!this.#config.demoPaymentsEnabled) {
      throw new AppError(403, 'DEMO_PAYMENTS_DISABLED', 'Demo card payments are disabled');
    }
    const claim = await this.#idempotency.claim<{ order: Order }>(
      AUTHORIZE_SCOPE,
      userId,
      key,
      hashJson({ orderId, scenario }),
    );
    if ('replay' in claim) return claim.replay;

    let intent: {
      opId: string;
      opKey: string;
      amountMinor: number;
      currency: 'CRC' | 'USD';
      code: string;
    } | null;
    try {
      intent = await this.#db.$transaction(async (tx) => {
        const now = this.#clock.now();
        const payment = await this.#lock(tx, orderId, userId);
        // Una clave por intento del cliente: tras un rechazo, el siguiente intento usa otra.
        const opKey = `${payment.id}:authorize:${key}`;
        // El mismo intento ya se registró (la respuesta se perdió y la clave se liberó): no se
        // abre otra operación; se responde el estado actual, que la reconciliación termina.
        const previous = await tx.paymentOperation.findUnique({
          where: { idempotencyKey: opKey },
          select: { id: true },
        });
        if (previous) return null;
        this.#assertPayable(payment, now);
        if (payment.method !== 'DEMO_CARD') throw notAllowed();
        assertTransition(payment.status, 'PROCESSING');
        await tx.payment.update({
          where: { id: payment.id },
          data: { status: 'PROCESSING', version: { increment: 1 } },
        });
        const op = await tx.paymentOperation.create({
          data: {
            paymentId: payment.id,
            type: 'AUTHORIZE',
            status: 'REQUESTED',
            idempotencyKey: opKey,
            amountMinor: payment.order.totalMinor,
            createdAt: now,
            updatedAt: now,
          },
        });
        await tx.paymentAttempt.create({
          data: {
            paymentId: payment.id,
            idempotencyKey: opKey,
            demoScenario: scenario,
            result: 'UNKNOWN',
            createdAt: now,
          },
        });
        return {
          opId: op.id,
          opKey,
          amountMinor: payment.order.totalMinor,
          currency: payment.currency,
          code: payment.order.code,
        };
      });
    } catch (error) {
      await this.#idempotency.release(claim.id);
      throw error;
    }

    if (!intent) {
      const body = { order: await this.#orderView(this.#db, orderId) };
      await this.#idempotency.complete(this.#db, claim.id, 200, body);
      return { status: 200, body };
    }
    const opened = intent;
    const result = await this.#call(() =>
      this.#gateway.authorize({
        amountMinor: opened.amountMinor,
        currency: opened.currency,
        reference: opened.code,
        idempotencyKey: opened.opKey,
        scenario,
      }),
    );

    try {
      return await this.#db.$transaction(async (tx) => {
        await this.#applyAuthorize(tx, opened.opId, result, { userId, role: 'CUSTOMER' });
        const body = { order: await this.#orderView(tx, orderId) };
        await this.#idempotency.complete(tx, claim.id, 200, body);
        return { status: 200, body };
      });
    } catch (error) {
      // La operación quedó registrada: la reconciliación la termina.
      await this.#idempotency.release(claim.id);
      throw error;
    }
  }

  /**
   * `POST /orders/:id/payments/cash-on-delivery` (D-M6-1): el cliente paga al recibir o al retirar
   * el pedido. No pasa por el procesador. Repetirlo devuelve el mismo resultado.
   */
  async payOnDelivery(userId: string, orderId: string): Promise<Order> {
    return this.#db.$transaction(async (tx) => {
      const now = this.#clock.now();
      const payment = await this.#lock(tx, orderId, userId);
      const already = payment.method === 'CASH_ON_DELIVERY' && payment.status === 'PENDING_COLLECTION';
      if (!already) {
        this.#assertPayable(payment, now);
        assertTransition(payment.status, 'PENDING_COLLECTION');
        await tx.payment.update({
          where: { id: payment.id },
          data: { method: 'CASH_ON_DELIVERY', status: 'PENDING_COLLECTION', version: { increment: 1 } },
        });
        await this.#toPendingConfirmation(
          tx,
          orderId,
          { userId, role: 'CUSTOMER' },
          'payment.cash_on_delivery',
        );
      }
      return this.#orderView(tx, orderId);
    });
  }

  // ─── Staff y admin (D-M6-2: API sin interfaz en M6) ──────────────────────────

  async adminView(orderId: string): Promise<AdminPayment> {
    return this.#adminView(this.#db, orderId);
  }

  /** Captura lo autorizado (staff o admin). En M7 la dispara la confirmación del pedido. */
  async capture(
    actor: PaymentActor,
    orderId: string,
    requestId: string,
  ): Promise<{ status: number; body: { payment: AdminPayment } }> {
    const intent = await this.#db.$transaction(async (tx) => {
      const payment = await this.#lock(tx, orderId);
      if (
        payment.method !== 'DEMO_CARD' ||
        payment.status !== 'AUTHORIZED' ||
        payment.order.status !== 'PENDING_CONFIRMATION' ||
        !payment.gatewayRef
      ) {
        throw notAllowed();
      }
      const op = await this.#openOperation(
        tx,
        payment.id,
        'CAPTURE',
        `${payment.id}:capture`,
        payment.amountAuthorizedMinor,
      );
      return { opId: op.id, opKey: op.idempotencyKey, ref: payment.gatewayRef, amountMinor: op.amountMinor };
    });
    const result = await this.#call(() =>
      this.#gateway.capture({
        ref: intent.ref,
        amountMinor: intent.amountMinor,
        idempotencyKey: intent.opKey,
      }),
    );
    return this.#finishAdminOperation(orderId, intent.opId, (tx) =>
      this.#applyCapture(tx, intent.opId, result, actor, requestId),
    );
  }

  /**
   * Anula: libera una autorización no capturada (vía el procesador) o cancela el cobro contra
   * entrega pendiente (sin procesador). En M7 la dispara la cancelación antes de confirmar.
   */
  async voidPayment(
    actor: PaymentActor,
    orderId: string,
    reason: string | null,
    requestId: string,
  ): Promise<{ status: number; body: { payment: AdminPayment } }> {
    const intent = await this.#db.$transaction(async (tx) => {
      const payment = await this.#lock(tx, orderId);
      if (payment.order.status !== 'PENDING_CONFIRMATION') throw notAllowed();
      if (payment.method === 'CASH_ON_DELIVERY' && payment.status === 'PENDING_COLLECTION') {
        assertTransition(payment.status, 'VOIDED');
        const after = await tx.payment.update({
          where: { id: payment.id },
          data: { status: 'VOIDED', version: { increment: 1 } },
          select: lockedPaymentSelect,
        });
        await recordAudit(tx, {
          actor,
          action: 'payment.voided',
          entityType: 'payment',
          entityId: payment.id,
          before: auditSnapshot(payment),
          after: auditSnapshot(after),
          reason,
          requestId,
        });
        return null;
      }
      if (payment.method !== 'DEMO_CARD' || payment.status !== 'AUTHORIZED' || !payment.gatewayRef) {
        throw notAllowed();
      }
      const op = await this.#openOperation(tx, payment.id, 'VOID', `${payment.id}:void`, 0);
      return { opId: op.id, opKey: op.idempotencyKey, ref: payment.gatewayRef };
    });
    if (!intent) return { status: 200, body: { payment: await this.adminView(orderId) } };
    const result = await this.#call(() =>
      this.#gateway.void({ ref: intent.ref, idempotencyKey: intent.opKey }),
    );
    return this.#finishAdminOperation(orderId, intent.opId, (tx) =>
      this.#applyVoid(tx, intent.opId, result, actor, reason, requestId),
    );
  }

  /** Reembolso total o parcial (solo admin), con `Idempotency-Key` y Σ reembolsos ≤ capturado. */
  async refund(
    actor: PaymentActor,
    orderId: string,
    key: string,
    input: RefundRequest,
    requestId: string,
  ): Promise<{ status: number; body: { payment: AdminPayment } }> {
    const claim = await this.#idempotency.claim<{ payment: AdminPayment }>(
      REFUND_SCOPE,
      actor.userId,
      key,
      hashJson({ orderId, amountMinor: input.amountMinor, reason: input.reason }),
    );
    if ('replay' in claim) return claim.replay;

    const refundKey = `${actor.userId}:${key}`;
    let intent: { opId: string; opKey: string; ref: string; resumed: boolean };
    try {
      intent = await this.#db.$transaction(async (tx) => {
        const payment = await this.#lock(tx, orderId);
        // El mismo reembolso ya se registró (la respuesta se perdió y la clave se liberó): no se crea
        // otro; se responde según cómo terminó su operación (o la termina la reconciliación).
        const previous = await tx.refund.findUnique({
          where: { idempotencyKey: refundKey },
          select: { id: true },
        });
        if (previous) {
          const op = await tx.paymentOperation.findUniqueOrThrow({
            where: { idempotencyKey: `refund:${previous.id}` },
          });
          return { opId: op.id, opKey: op.idempotencyKey, ref: payment.gatewayRef ?? '', resumed: true };
        }
        if (
          payment.method !== 'DEMO_CARD' ||
          (payment.status !== 'CAPTURED' && payment.status !== 'PARTIALLY_REFUNDED') ||
          !payment.gatewayRef
        ) {
          throw notAllowed();
        }
        // Los reembolsos en curso cuentan: dos reembolsos simultáneos no pueden pasarse del total.
        const pending = await tx.paymentOperation.aggregate({
          where: { paymentId: payment.id, type: 'REFUND', status: { in: ['REQUESTED', 'UNKNOWN'] } },
          _sum: { amountMinor: true },
        });
        const committed = payment.amountRefundedMinor + (pending._sum.amountMinor ?? 0);
        if (committed + input.amountMinor > payment.amountCapturedMinor) {
          throw new AppError(422, 'REFUND_EXCEEDS_CAPTURED', 'Refunds cannot exceed the captured amount', {
            details: { refundableMinor: Math.max(0, payment.amountCapturedMinor - committed) },
          });
        }
        const refund = await tx.refund.create({
          data: {
            paymentId: payment.id,
            amountMinor: input.amountMinor,
            reason: input.reason,
            idempotencyKey: refundKey,
            actorUserId: actor.userId,
            createdAt: this.#clock.now(),
          },
        });
        const op = await this.#openOperation(
          tx,
          payment.id,
          'REFUND',
          `refund:${refund.id}`,
          input.amountMinor,
        );
        return { opId: op.id, opKey: op.idempotencyKey, ref: payment.gatewayRef, resumed: false };
      });
    } catch (error) {
      await this.#idempotency.release(claim.id);
      throw error;
    }

    const result: GatewayResult = intent.resumed
      ? { outcome: 'UNKNOWN' }
      : await this.#call(() =>
          this.#gateway.refund({
            ref: intent.ref,
            amountMinor: input.amountMinor,
            idempotencyKey: intent.opKey,
          }),
        );
    try {
      // Retomado: no se vuelve a llamar ni a aplicar nada; se informa cómo quedó la operación.
      const response = await this.#finishAdminOperation(orderId, intent.opId, (tx) =>
        intent.resumed ? Promise.resolve() : this.#applyRefund(tx, intent.opId, result, actor, requestId),
      );
      const status = response.status === 200 ? 201 : response.status;
      await this.#idempotency.complete(this.#db, claim.id, status, response.body);
      return { status, body: response.body };
    } catch (error) {
      await this.#idempotency.release(claim.id);
      throw error;
    }
  }

  /** Límite de staff/admin superado: queda en el AuditLog (§8.4). */
  async auditRateLimited(
    actor: PaymentActor,
    orderId: string,
    action: string,
    requestId: string,
  ): Promise<void> {
    const payment = await this.#db.payment.findUnique({ where: { orderId }, select: { id: true } });
    if (!payment) return;
    await this.#db.$transaction((tx) =>
      recordAudit(tx, {
        actor,
        action: 'payment.rate_limited',
        entityType: 'payment',
        entityId: payment.id,
        reason: action,
        requestId,
      }),
    );
  }

  // ─── Reconciliación (§7.3, punto 3) ──────────────────────────────────────────

  /**
   * Resuelve las operaciones `UNKNOWN` (tiempo agotado o pendiente) y las `REQUESTED` que quedaron
   * interrumpidas. Consulta al procesador por la clave; si nunca le llegó, la repite con la misma
   * clave. Es segura de correr en paralelo con las peticiones: cada aplicación bloquea el pago y
   * solo cambia operaciones que siguen abiertas.
   */
  async reconcile(logger?: Logger, limit = 20): Promise<{ resolved: number; pending: number }> {
    const now = this.#clock.now();
    const ops = await this.#db.paymentOperation.findMany({
      where: {
        OR: [
          { status: 'UNKNOWN' },
          {
            status: 'REQUESTED',
            updatedAt: { lte: new Date(now.getTime() - PAYMENT_TIMING.requestedStaleMs) },
          },
        ],
      },
      orderBy: { updatedAt: 'asc' },
      take: limit,
      include: {
        payment: { select: { gatewayRef: true, currency: true, order: { select: { code: true } } } },
      },
    });
    const outcome = { resolved: 0, pending: 0 };
    for (const op of ops) {
      try {
        let result: GatewayResult;
        const found = await this.#gateway.retrieve(op.idempotencyKey);
        if (found.outcome !== 'NOT_FOUND') {
          result = found;
        } else {
          result = await this.#reissue(op);
        }
        await this.#db.$transaction(async (tx) => {
          switch (op.type) {
            case 'AUTHORIZE':
              await this.#applyAuthorize(tx, op.id, result, null);
              break;
            case 'CAPTURE':
              await this.#applyCapture(tx, op.id, result, null, null);
              break;
            case 'VOID':
              await this.#applyVoid(tx, op.id, result, null, 'reconciliation', null);
              break;
            case 'REFUND':
              await this.#applyRefund(tx, op.id, result, null, null);
              break;
          }
        });
        if (result.outcome === 'SUCCEEDED' || result.outcome === 'DECLINED') outcome.resolved += 1;
        else outcome.pending += 1;
      } catch (error) {
        logger?.error({ err: error, operationId: op.id }, 'payment reconciliation failed');
      }
    }
    return outcome;
  }

  /** La operación nunca llegó al procesador: se repite con la misma clave (no cobra dos veces). */
  async #reissue(op: {
    type: 'AUTHORIZE' | 'CAPTURE' | 'VOID' | 'REFUND';
    paymentId: string;
    idempotencyKey: string;
    amountMinor: number;
    payment: { gatewayRef: string | null; currency: 'CRC' | 'USD'; order: { code: string } };
  }): Promise<GatewayResult> {
    if (op.type === 'AUTHORIZE') {
      const attempt = await this.#db.paymentAttempt.findFirst({
        where: { paymentId: op.paymentId, idempotencyKey: op.idempotencyKey },
        select: { demoScenario: true },
      });
      return this.#call(() =>
        this.#gateway.authorize({
          amountMinor: op.amountMinor,
          currency: op.payment.currency,
          reference: op.payment.order.code,
          idempotencyKey: op.idempotencyKey,
          scenario: attempt?.demoScenario ?? 'APPROVED',
        }),
      );
    }
    const ref = op.payment.gatewayRef;
    if (!ref) return { outcome: 'DECLINED', code: 'processor_error', ref: null };
    switch (op.type) {
      case 'CAPTURE':
        return this.#call(() =>
          this.#gateway.capture({ ref, amountMinor: op.amountMinor, idempotencyKey: op.idempotencyKey }),
        );
      case 'VOID':
        return this.#call(() => this.#gateway.void({ ref, idempotencyKey: op.idempotencyKey }));
      case 'REFUND':
        return this.#call(() =>
          this.#gateway.refund({ ref, amountMinor: op.amountMinor, idempotencyKey: op.idempotencyKey }),
        );
    }
  }

  // ─── Aplicación de resultados ────────────────────────────────────────────────

  /** Bloquea el pago y devuelve la operación si sigue abierta (si no, ya se aplicó: no hace nada). */
  async #openOp(tx: Tx, opId: string) {
    const op = await tx.paymentOperation.findUniqueOrThrow({ where: { id: opId } });
    await tx.$queryRaw`SELECT "id" FROM "Payment" WHERE "id" = ${op.paymentId}::uuid FOR UPDATE`;
    const fresh = await tx.paymentOperation.findUniqueOrThrow({ where: { id: opId } });
    if (fresh.status !== 'REQUESTED' && fresh.status !== 'UNKNOWN') return null;
    const payment = await tx.payment.findUniqueOrThrow({
      where: { id: op.paymentId },
      select: lockedPaymentSelect,
    });
    return { op: fresh, payment };
  }

  /** Sin resultado definitivo: la operación queda `UNKNOWN` para la reconciliación. */
  async #markUnknown(tx: Tx, opId: string, result: GatewayResult): Promise<void> {
    await tx.paymentOperation.update({
      where: { id: opId },
      data: {
        status: 'UNKNOWN',
        attempts: { increment: 1 },
        ...(result.outcome === 'PENDING' ? { gatewayRef: result.ref } : {}),
        lastError: result.outcome === 'PENDING' ? 'pending' : 'no_response',
        updatedAt: this.#clock.now(),
      },
    });
  }

  async #closeOp(tx: Tx, opId: string, status: 'SUCCEEDED' | 'FAILED', result: GatewayResult): Promise<void> {
    await tx.paymentOperation.update({
      where: { id: opId },
      data: {
        status,
        attempts: { increment: 1 },
        ...('ref' in result && result.ref ? { gatewayRef: result.ref } : {}),
        lastError: result.outcome === 'DECLINED' ? result.code : null,
        updatedAt: this.#clock.now(),
      },
    });
  }

  async #applyAuthorize(
    tx: Tx,
    opId: string,
    result: GatewayResult,
    actor: PaymentActor | null,
  ): Promise<void> {
    const open = await this.#openOp(tx, opId);
    if (!open) return;
    const { op, payment } = open;
    const attempt = { paymentId: payment.id, idempotencyKey: op.idempotencyKey };
    switch (result.outcome) {
      case 'SUCCEEDED': {
        assertTransition(payment.status, 'AUTHORIZED');
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: 'AUTHORIZED',
            amountAuthorizedMinor: op.amountMinor,
            gatewayRef: result.ref,
            version: { increment: 1 },
          },
        });
        await this.#closeOp(tx, op.id, 'SUCCEEDED', result);
        await tx.paymentAttempt.updateMany({
          where: attempt,
          data: { result: 'SUCCEEDED', gatewayRef: result.ref, failureCode: null },
        });
        await this.#toPendingConfirmation(tx, payment.orderId, actor, 'payment.authorized');
        return;
      }
      case 'DECLINED': {
        assertTransition(payment.status, 'REQUIRES_PAYMENT');
        await tx.payment.update({
          where: { id: payment.id },
          data: { status: 'REQUIRES_PAYMENT', version: { increment: 1 } },
        });
        await this.#closeOp(tx, op.id, 'FAILED', result);
        await tx.paymentAttempt.updateMany({
          where: attempt,
          data: { result: 'FAILED', failureCode: result.code, gatewayRef: result.ref },
        });
        return;
      }
      case 'PENDING':
      case 'UNKNOWN':
        await this.#markUnknown(tx, op.id, result);
        await tx.paymentAttempt.updateMany({
          where: attempt,
          data: {
            result: result.outcome === 'PENDING' ? 'PENDING' : 'UNKNOWN',
            ...(result.outcome === 'PENDING' ? { gatewayRef: result.ref } : {}),
          },
        });
    }
  }

  async #applyCapture(
    tx: Tx,
    opId: string,
    result: GatewayResult,
    actor: PaymentActor | null,
    requestId: string | null,
  ): Promise<void> {
    const open = await this.#openOp(tx, opId);
    if (!open) return;
    const { op, payment } = open;
    if (result.outcome === 'SUCCEEDED') {
      assertTransition(payment.status, 'CAPTURED');
      const after = await tx.payment.update({
        where: { id: payment.id },
        data: { status: 'CAPTURED', amountCapturedMinor: op.amountMinor, version: { increment: 1 } },
        select: lockedPaymentSelect,
      });
      await this.#closeOp(tx, op.id, 'SUCCEEDED', result);
      await recordAudit(tx, {
        actor,
        action: 'payment.captured',
        entityType: 'payment',
        entityId: payment.id,
        before: auditSnapshot(payment),
        after: auditSnapshot(after),
        reason: actor ? null : 'reconciliation',
        requestId,
      });
    } else if (result.outcome === 'DECLINED') {
      await this.#closeOp(tx, op.id, 'FAILED', result);
    } else {
      await this.#markUnknown(tx, op.id, result);
    }
  }

  async #applyVoid(
    tx: Tx,
    opId: string,
    result: GatewayResult,
    actor: PaymentActor | null,
    reason: string | null,
    requestId: string | null,
  ): Promise<void> {
    const open = await this.#openOp(tx, opId);
    if (!open) return;
    const { op, payment } = open;
    if (result.outcome === 'SUCCEEDED') {
      assertTransition(payment.status, 'VOIDED');
      const after = await tx.payment.update({
        where: { id: payment.id },
        data: { status: 'VOIDED', version: { increment: 1 } },
        select: lockedPaymentSelect,
      });
      await this.#closeOp(tx, op.id, 'SUCCEEDED', result);
      await recordAudit(tx, {
        actor,
        action: 'payment.voided',
        entityType: 'payment',
        entityId: payment.id,
        before: auditSnapshot(payment),
        after: auditSnapshot(after),
        reason,
        requestId,
      });
    } else if (result.outcome === 'DECLINED') {
      await this.#closeOp(tx, op.id, 'FAILED', result);
    } else {
      await this.#markUnknown(tx, op.id, result);
    }
  }

  async #applyRefund(
    tx: Tx,
    opId: string,
    result: GatewayResult,
    actor: PaymentActor | null,
    requestId: string | null,
  ): Promise<void> {
    const open = await this.#openOp(tx, opId);
    if (!open) return;
    const { op, payment } = open;
    const refundId = op.idempotencyKey.replace(/^refund:/, '');
    if (result.outcome === 'SUCCEEDED') {
      const refunded = payment.amountRefundedMinor + op.amountMinor;
      const next = refundedStatus(payment.amountCapturedMinor, refunded);
      assertTransition(payment.status, next);
      const after = await tx.payment.update({
        where: { id: payment.id },
        data: { status: next, amountRefundedMinor: refunded, version: { increment: 1 } },
        select: lockedPaymentSelect,
      });
      await this.#closeOp(tx, op.id, 'SUCCEEDED', result);
      const refund = await tx.refund.findUnique({ where: { id: refundId }, select: { reason: true } });
      await recordAudit(tx, {
        actor,
        action: 'payment.refunded',
        entityType: 'payment',
        entityId: payment.id,
        before: auditSnapshot(payment),
        after: { ...auditSnapshot(after), amountMinor: op.amountMinor },
        reason: refund?.reason ?? null,
        requestId,
      });
    } else if (result.outcome === 'DECLINED') {
      await this.#closeOp(tx, op.id, 'FAILED', result);
      // El reembolso no ocurrió: no queda registrado como hecho.
      await tx.refund.deleteMany({ where: { id: refundId } });
    } else {
      await this.#markUnknown(tx, op.id, result);
    }
  }

  // ─── Ayudas ──────────────────────────────────────────────────────────────────

  /**
   * Bloquea el pago del pedido (`FOR UPDATE`). Con `userId`, solo si el pedido es de esa cuenta:
   * ajeno o inexistente → 404, sin confirmar que exista (§8.7).
   */
  async #lock(tx: Tx, orderId: string, userId?: string): Promise<LockedPayment> {
    const rows = userId
      ? await tx.$queryRaw<{ id: string }[]>`
          SELECT p."id" FROM "Payment" p JOIN "Order" o ON o."id" = p."orderId"
          WHERE o."id" = ${orderId}::uuid AND o."userId" = ${userId}::uuid FOR UPDATE OF p`
      : await tx.$queryRaw<{ id: string }[]>`
          SELECT p."id" FROM "Payment" p WHERE p."orderId" = ${orderId}::uuid FOR UPDATE`;
    const id = rows[0]?.id;
    if (!id) throw notFound();
    return tx.payment.findUniqueOrThrow({ where: { id }, select: lockedPaymentSelect });
  }

  #assertPayable(payment: LockedPayment, now: Date): void {
    if (payment.order.status !== 'PENDING_PAYMENT' || payment.status !== 'REQUIRES_PAYMENT') {
      throw payment.status === 'PROCESSING' ? inProgress() : notAllowed();
    }
    if (payment.order.expiresAt && payment.order.expiresAt <= now) {
      throw new AppError(409, 'ORDER_EXPIRED', 'The order reservation expired');
    }
  }

  /**
   * Abre la operación de staff/admin con su clave determinística. Una en curso → 409; una fallida
   * se reabre con la misma clave (el procesador es idempotente por clave). Capturar y anular se
   * excluyen entre sí: con una de las dos en curso (`REQUESTED`/`UNKNOWN`), la otra → 409, así la
   * segunda nunca llega al procesador a competir con la primera.
   */
  async #openOperation(
    tx: Tx,
    paymentId: string,
    type: 'CAPTURE' | 'VOID' | 'REFUND',
    idempotencyKey: string,
    amountMinor: number,
  ) {
    const now = this.#clock.now();
    if (type !== 'REFUND') {
      const busy = await tx.paymentOperation.count({
        where: { paymentId, type: { in: ['CAPTURE', 'VOID'] }, status: { in: ['REQUESTED', 'UNKNOWN'] } },
      });
      if (busy > 0) throw inProgress();
    }
    const existing = await tx.paymentOperation.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (existing.status !== 'FAILED') throw inProgress();
      return tx.paymentOperation.update({
        where: { id: existing.id },
        data: { status: 'REQUESTED', lastError: null, updatedAt: now },
      });
    }
    return tx.paymentOperation.create({
      data: {
        paymentId,
        type,
        status: 'REQUESTED',
        idempotencyKey,
        amountMinor,
        createdAt: now,
        updatedAt: now,
      },
    });
  }

  /**
   * Aplica el resultado y responde según cómo quedó **la operación** (no la llamada): si la
   * reconciliación la terminó antes, se informa ese resultado. Rechazada → 502; sin resultado → 202
   * (la termina la reconciliación); hecha → 200.
   */
  async #finishAdminOperation(
    orderId: string,
    opId: string,
    apply: (tx: Tx) => Promise<void>,
  ): Promise<{ status: number; body: { payment: AdminPayment } }> {
    const { payment, status } = await this.#db.$transaction(async (tx) => {
      await apply(tx);
      const op = await tx.paymentOperation.findUniqueOrThrow({
        where: { id: opId },
        select: { status: true },
      });
      return { payment: await this.#adminView(tx, orderId), status: op.status };
    });
    if (status === 'FAILED') {
      throw new AppError(502, 'GATEWAY_ERROR', 'The payment processor rejected the operation');
    }
    return { status: status === 'SUCCEEDED' ? 200 : 202, body: { payment } };
  }

  /** Errores inesperados del procesador cuentan como "sin respuesta": decide la reconciliación. */
  async #call(fn: () => Promise<GatewayResult>): Promise<GatewayResult> {
    try {
      return await fn();
    } catch {
      return { outcome: 'UNKNOWN' };
    }
  }

  /** `PENDING_PAYMENT → PENDING_CONFIRMATION` con su historial (§7.1), si el pedido sigue ahí. */
  async #toPendingConfirmation(
    tx: Tx,
    orderId: string,
    actor: PaymentActor | null,
    reason: string,
  ): Promise<void> {
    const moved = await tx.order.updateMany({
      where: { id: orderId, status: 'PENDING_PAYMENT' },
      data: { status: 'PENDING_CONFIRMATION', version: { increment: 1 } },
    });
    if (moved.count === 0) return;
    await tx.orderStatusHistory.create({
      data: {
        orderId,
        fromStatus: 'PENDING_PAYMENT',
        toStatus: 'PENDING_CONFIRMATION',
        actorUserId: actor?.userId ?? null,
        actorRole: actor?.role ?? null,
        reason,
        createdAt: this.#clock.now(),
      },
    });
  }

  async #orderView(tx: Tx | PrismaClient, orderId: string): Promise<Order> {
    const row = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: orderInclude });
    return toOrder(row, { now: this.#clock.now(), demoCardEnabled: this.#config.demoPaymentsEnabled });
  }

  async #adminView(db: Tx | PrismaClient, orderId: string): Promise<AdminPayment> {
    const payment = await db.payment.findUnique({
      where: { orderId },
      include: {
        order: { select: { code: true, status: true } },
        refunds: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, amountMinor: true, reason: true, createdAt: true },
        },
      },
    });
    if (!payment) throw notFound();
    // Solo los reembolsos confirmados (los en curso no se muestran como hechos).
    const confirmed = await db.paymentOperation.findMany({
      where: { paymentId: payment.id, type: 'REFUND', status: 'SUCCEEDED' },
      select: { idempotencyKey: true },
    });
    const done = new Set(confirmed.map((o) => o.idempotencyKey.replace(/^refund:/, '')));
    return {
      id: payment.id,
      orderId: payment.orderId,
      orderCode: payment.order.code,
      orderStatus: payment.order.status,
      method: payment.method,
      status: payment.status,
      currency: payment.currency,
      amountAuthorizedMinor: payment.amountAuthorizedMinor,
      amountCapturedMinor: payment.amountCapturedMinor,
      amountRefundedMinor: payment.amountRefundedMinor,
      refunds: payment.refunds
        .filter((r) => done.has(r.id))
        .map((r) => ({
          id: r.id,
          amountMinor: r.amountMinor,
          reason: r.reason,
          createdAt: r.createdAt.toISOString(),
        })),
    };
  }
}
