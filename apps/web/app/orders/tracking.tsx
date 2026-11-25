import { orderSchema, type Order, type OrderStatus } from '@marea-baja/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { z } from 'zod';
import { ApiError, NetworkError, apiSend } from '../account/api.ts';
import { TideLine } from '../components/brand/TideLine.tsx';
import { Button } from '../components/ui/Button.tsx';
import { useLocale, useT } from '../i18n/use-locale.ts';

/**
 * Seguimiento del pedido (M7, §2.4, §3.6): el estado actual sobre la línea de marea, con las
 * marcas de cada paso y su hora, y el cambio anunciado por `aria-live`. No hay barra de progreso en
 * porcentaje (prohibido por el contrato de la pantalla). Solo muestra lo que dice la API.
 */
const PICKUP_STEPS = [
  'PENDING_CONFIRMATION',
  'CONFIRMED',
  'PREPARING',
  'READY_FOR_PICKUP',
  'DELIVERED',
] as const;
const DELIVERY_STEPS = [
  'PENDING_CONFIRMATION',
  'CONFIRMED',
  'PREPARING',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
] as const;
type Step = (typeof PICKUP_STEPS)[number] | (typeof DELIVERY_STEPS)[number];

/** Estados en los que el pedido todavía puede cambiar: la pantalla se actualiza sola. */
export const ACTIVE_STATUSES: readonly OrderStatus[] = [
  'PENDING_CONFIRMATION',
  'CONFIRMED',
  'PREPARING',
  'READY_FOR_PICKUP',
  'OUT_FOR_DELIVERY',
];

export function useTimeFormat(): (iso: string) => string {
  const locale = useLocale();
  const format = new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Costa_Rica',
  });
  return (iso) => format.format(new Date(iso));
}

/** Última vez que el pedido llegó a ese estado. */
function reachedAt(order: Order, status: OrderStatus): string | null {
  const entries = order.timeline.filter((entry) => entry.status === status);
  return entries.at(-1)?.at ?? null;
}

export function OrderTracker({ order }: { order: Order }) {
  const { t } = useT('order');
  const time = useTimeFormat();
  const headingId = useId();

  if (order.status === 'PENDING_PAYMENT') {
    return (
      <section aria-labelledby={headingId} className="flex flex-col gap-3">
        <h2 id={headingId} className="t-h3">
          {t('tracking.heading')}
        </h2>
        <p className="t-body">{t('tracking.waitingPayment')}</p>
      </section>
    );
  }

  if (order.status === 'CANCELLED') {
    const at = reachedAt(order, 'CANCELLED');
    return (
      <section aria-labelledby={headingId} className="flex flex-col gap-3">
        <h2 id={headingId} className="t-h3">
          {t('tracking.heading')}
        </h2>
        <p
          role="status"
          data-tracking-status="CANCELLED"
          className="border-l-4 border-danger bg-surface-raised px-4 py-3 t-body"
        >
          {at ? t('tracking.cancelled', { time: time(at) }) : t('tracking.cancelledNoTime')}
        </p>
      </section>
    );
  }

  const steps: readonly Step[] = order.fulfillmentType === 'PICKUP' ? PICKUP_STEPS : DELIVERY_STEPS;
  const current = steps.indexOf(order.status);
  const since = reachedAt(order, order.status);
  const live = ACTIVE_STATUSES.includes(order.status);

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <h2 id={headingId} className="t-h3">
        {t('tracking.heading')}
      </h2>
      {/* Región viva: cada cambio de estado se anuncia solo (§3.6). */}
      <div role="status" aria-live="polite" className="flex flex-col gap-1">
        <p className="t-h3" data-tracking-status={order.status}>
          {t('tracking.now', { status: t(`tracking.steps.${order.status}`) })}
        </p>
        {since ? (
          <p className="t-body text-text-muted">{t('tracking.since', { time: time(since) })}</p>
        ) : null}
      </div>
      <div className="relative">
        {/* La línea de marea une las marcas en pantallas anchas; en el celular, una regla vertical. */}
        <div aria-hidden="true" className="absolute top-[7px] right-[10%] left-[10%] hidden md:block">
          <TideLine className="text-border-strong" />
        </div>
        <ol className="relative ml-2 flex flex-col gap-4 border-l border-border-strong pl-5 md:ml-0 md:grid md:grid-cols-5 md:gap-2 md:border-l-0 md:pl-0">
          {steps.map((step, index) => {
            const at = reachedAt(order, step);
            const state = index < current ? 'done' : index === current ? 'current' : 'pending';
            const label = t(`tracking.steps.${step}`);
            const text =
              state === 'current' && at
                ? t('tracking.stepCurrent', { step: label, time: time(at) })
                : state === 'done' && at
                  ? t('tracking.stepDone', { step: label, time: time(at) })
                  : t('tracking.stepPending', { step: label });
            return (
              <li
                key={step}
                data-step={step}
                data-state={state}
                aria-current={state === 'current' ? 'step' : undefined}
                className="relative flex items-start gap-3 md:flex-col md:items-center md:gap-2 md:text-center"
              >
                <span
                  aria-hidden="true"
                  className={[
                    'absolute -left-[27px] top-1 block shrink-0 rounded-full border-2 md:static',
                    state === 'current'
                      ? 'size-4 border-tinta bg-tinta outline-2 outline-offset-2 outline-tinta'
                      : state === 'done'
                        ? 'size-3.5 border-tinta bg-tinta'
                        : 'size-3.5 border-border-strong bg-surface',
                  ].join(' ')}
                />
                <span className="sr-only">{text}</span>
                <span aria-hidden="true" className="flex flex-col">
                  <span className={state === 'current' ? 't-ui' : 't-body'}>{label}</span>
                  <span className="text-sm leading-5 text-text-muted">{at ? time(at) : '—'}</span>
                </span>
              </li>
            );
          })}
        </ol>
      </div>
      {live ? <p className="text-sm leading-5 text-text-muted">{t('tracking.live')}</p> : null}
    </section>
  );
}

// ─── Cancelación del cliente ────────────────────────────────────────────────

const responseSchema = z.object({ order: orderSchema });

function cancelErrorKey(error: unknown) {
  if (error instanceof NetworkError) return 'tracking.cancelErrors.network' as const;
  if (error instanceof ApiError) {
    if (error.code === 'ORDER_TRANSITION_NOT_ALLOWED') return 'tracking.cancelErrors.notAllowed' as const;
    if (error.code === 'PAYMENT_IN_PROGRESS') return 'tracking.cancelErrors.inProgress' as const;
    if (error.code === 'RATE_LIMITED') return 'tracking.cancelErrors.rateLimited' as const;
  }
  return 'tracking.cancelErrors.generic' as const;
}

/**
 * El cliente cancela su pedido mientras el local no lo confirme (§7.1). Confirmación en línea, no
 * un modal (§3.6: acciones destructivas). El resultado lo decide la API.
 */
export function CancelOrderPanel({ order }: { order: Order }) {
  const { t } = useT('order');
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const resultRef = useRef<HTMLParagraphElement>(null);
  const reasonId = useId();
  const titleId = useId();
  const cancel = useMutation({
    mutationFn: async () => {
      const body = reason.trim() ? { reason: reason.trim() } : {};
      return (
        await apiSend('POST', `/api/orders/${encodeURIComponent(order.id)}/cancel`, body, responseSchema)
      )?.order;
    },
    onSuccess: (updated) => {
      if (updated) client.setQueryData(['order', order.id], updated);
      void client.invalidateQueries({ queryKey: ['orders'] });
      setOpen(false);
      setResult({
        tone: 'ok',
        text: updated?.status === 'CANCELLED' ? t('tracking.cancelDone') : t('tracking.cancelPending'),
      });
    },
    onError: (error) => {
      void client.invalidateQueries({ queryKey: ['order', order.id] });
      setResult({ tone: 'error', text: t(cancelErrorKey(error)) });
    },
  });
  useEffect(() => {
    if (result) resultRef.current?.focus();
  }, [result]);

  if (!order.cancellable && !result) return null;
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3 border-t border-border pt-6">
      <h2 id={titleId} className="t-h3">
        {t('tracking.cancelTitle')}
      </h2>
      {result ? (
        <p
          ref={resultRef}
          tabIndex={-1}
          role={result.tone === 'error' ? 'alert' : 'status'}
          className={result.tone === 'error' ? 't-body text-danger' : 't-body'}
        >
          {result.text}
        </p>
      ) : null}
      {order.cancellable ? (
        open ? (
          <div className="flex flex-col gap-3">
            <p className="t-body">{t('tracking.cancelHint')}</p>
            <label htmlFor={reasonId} className="t-ui">
              {t('tracking.cancelReason')}
            </label>
            <textarea
              id={reasonId}
              value={reason}
              maxLength={300}
              rows={2}
              onChange={(event) => {
                setReason(event.target.value);
              }}
              className="min-h-12 w-full rounded-[var(--radius-control)] border border-border-strong bg-surface px-3 py-2 t-body focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta"
            />
            <div className="flex flex-wrap gap-3">
              <Button
                variant="danger"
                loading={cancel.isPending}
                onClick={() => {
                  if (!cancel.isPending) cancel.mutate();
                }}
              >
                {t('tracking.cancelConfirm')}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setOpen(false);
                }}
              >
                {t('tracking.cancelKeep')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm leading-5 text-text-muted">{t('tracking.cancelHint')}</p>
            <Button
              variant="danger"
              className="self-start"
              onClick={() => {
                setResult(null);
                setOpen(true);
              }}
            >
              {t('tracking.cancelOpen')}
            </Button>
          </div>
        )
      ) : null}
    </section>
  );
}
