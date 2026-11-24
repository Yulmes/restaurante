import {
  formatMoney,
  passOrderResponseSchema,
  passResponseSchema,
  type OrderStatus,
  type PassOrder,
} from '@marea-baja/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Navigate } from 'react-router';
import { ApiError, NetworkError, apiGet, apiSend } from '../../account/api.ts';
import { useLocalizedPath } from '../../account/links.ts';
import { useMe } from '../../account/session.ts';
import { orderMeta, OrderShell } from '../../cart/OrderShell.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { useLocale, useT } from '../../i18n/use-locale.ts';
import { useTimeFormat } from '../../orders/tracking.tsx';
import type { Route } from './+types/pase';

/**
 * Admin · Pase (M7, §2.4, §3.6): lo primero que se lee son los pedidos que esperan confirmación y
 * su antigüedad; la acción principal es confirmar o avanzar. Columnas por estado, avance con un
 * clic y atajos de teclado que solo actúan con un pedido enfocado (WCAG 2.1.4).
 *
 * La web solo muestra y pide: la API decide si la transición es válida para el rol, captura,
 * anula o reembolsa, y responde 409 si otra persona cambió el pedido (versión optimista).
 */
export function meta({ location }: Route.MetaArgs) {
  return orderMeta(location.pathname, 'pass.metaTitle');
}

const POLL_MS = 10_000;
const COLUMNS = [
  { key: 'PENDING_CONFIRMATION', statuses: ['PENDING_CONFIRMATION'] },
  { key: 'CONFIRMED', statuses: ['CONFIRMED'] },
  { key: 'PREPARING', statuses: ['PREPARING'] },
  { key: 'READY', statuses: ['READY_FOR_PICKUP', 'OUT_FOR_DELIVERY'] },
] as const satisfies readonly { key: string; statuses: readonly OrderStatus[] }[];

export default function Pase() {
  const { t } = useT('order');
  const to = useLocalizedPath();
  const me = useMe();
  if (me.isPending) {
    return (
      <OrderShell title={t('pass.title')}>
        <p role="status" className="t-body text-text-muted">
          {t('pass.loading')}
        </p>
      </OrderShell>
    );
  }
  if (!me.data) return <Navigate to={to('/cuenta/ingresar')} replace />;
  const staff = me.data.roles.includes('STAFF') || me.data.roles.includes('ADMIN');
  if (!staff) {
    return (
      <OrderShell title={t('pass.title')}>
        <p role="alert" className="t-body">
          {t('pass.forbidden')}
        </p>
      </OrderShell>
    );
  }
  return <PassBoard />;
}

type Notice = { tone: 'ok' | 'error'; text: string } | null;

function errorKey(error: unknown) {
  if (error instanceof NetworkError) return 'pass.errors.network' as const;
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'ORDER_VERSION_CONFLICT':
        return 'pass.errors.conflict' as const;
      case 'GATEWAY_ERROR':
        return 'pass.errors.gateway' as const;
      case 'PAYMENT_IN_PROGRESS':
        return 'pass.errors.inProgress' as const;
      case 'ORDER_TRANSITION_NOT_ALLOWED':
      case 'PAYMENT_NOT_ALLOWED':
        return 'pass.errors.notAllowed' as const;
      case 'FORBIDDEN':
        return 'pass.errors.forbidden' as const;
      case 'VALIDATION_FAILED':
        return 'pass.errors.reason' as const;
      case 'RATE_LIMITED':
        return 'pass.errors.rateLimited' as const;
      default:
        break;
    }
  }
  return 'pass.errors.generic' as const;
}

function PassBoard() {
  const { t } = useT('order');
  const client = useQueryClient();
  const time = useTimeFormat();
  const pass = useQuery({
    queryKey: ['pass'],
    queryFn: () => apiGet('/api/admin/pass', passResponseSchema),
    refetchInterval: POLL_MS,
    retry: false,
  });
  const [notice, setNotice] = useState<Notice>(null);
  const cards = useRef(new Map<string, HTMLElement>());
  // Diferencia entre el reloj del servidor y el del navegador: la antigüedad se calcula con el primero.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 30_000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  const offset = pass.data ? new Date(pass.data.serverTime).getTime() - pass.dataUpdatedAt : 0;

  const move = useMutation({
    mutationFn: async (input: { order: PassOrder; status: OrderStatus; reason?: string }) => {
      const body = {
        status: input.status,
        version: input.order.version,
        ...(input.reason ? { reason: input.reason } : {}),
      };
      const result = await apiSend(
        'PATCH',
        `/api/admin/orders/${encodeURIComponent(input.order.id)}/status`,
        body,
        passOrderResponseSchema,
      );
      return result?.order;
    },
    onSuccess: (updated, input) => {
      if (!updated) return;
      setNotice({
        tone: 'ok',
        text:
          updated.status === input.status
            ? t('pass.results.moved', {
                code: updated.code,
                status: t(`confirmation.status.${updated.status}`),
              })
            : t('pass.results.pending', { code: updated.code }),
      });
    },
    onError: (error, input) => {
      setNotice({ tone: 'error', text: t(errorKey(error), { code: input.order.code }) });
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ['pass'] });
    },
  });

  const orders = pass.data?.orders ?? [];
  // Orden de lectura (columna por columna): el que usan J y K.
  const sequence = COLUMNS.flatMap((column) =>
    orders.filter((order) => (column.statuses as readonly OrderStatus[]).includes(order.status)),
  );
  function focusSibling(id: string, delta: number) {
    const index = sequence.findIndex((order) => order.id === id);
    const target = sequence[index + delta];
    if (target) cards.current.get(target.id)?.focus();
  }

  return (
    <OrderShell title={t('pass.title')} intro={t('pass.intro')}>
      <div className="flex flex-col gap-2">
        <p className="text-sm leading-5 text-text-muted">{t('pass.shortcuts')}</p>
        {pass.data ? (
          <p className="text-sm leading-5 text-text-muted">
            {t('pass.updated', { time: time(pass.data.serverTime) })}
          </p>
        ) : null}
        <div aria-live="polite">
          {notice ? (
            <p
              role={notice.tone === 'error' ? 'alert' : 'status'}
              className={
                notice.tone === 'error'
                  ? 'border-l-4 border-danger bg-surface-raised px-4 py-3 t-body'
                  : 'border-l-4 border-border-strong bg-surface-raised px-4 py-3 t-body'
              }
            >
              {notice.text}
            </p>
          ) : null}
        </div>
        {pass.isError ? (
          <p role="alert" className="t-body text-danger">
            {t('pass.error')}
          </p>
        ) : null}
      </div>
      {pass.isPending ? (
        <p role="status" className="t-body text-text-muted">
          {t('pass.loading')}
        </p>
      ) : (
        <div className="grid gap-8 md:grid-cols-2 xl:grid-cols-4 xl:gap-5">
          {COLUMNS.map((column) => {
            const items = orders.filter((order) =>
              (column.statuses as readonly OrderStatus[]).includes(order.status),
            );
            return (
              <section
                key={column.key}
                aria-labelledby={`pass-col-${column.key}`}
                data-column={column.key}
                className="flex min-w-0 flex-col gap-3"
              >
                <h2
                  id={`pass-col-${column.key}`}
                  className="flex flex-wrap items-baseline justify-between gap-x-3 border-b-2 border-text pb-2 t-h3"
                >
                  <span>{t(`pass.columns.${column.key}`)}</span>
                  <span className="t-ui whitespace-nowrap text-text-muted">
                    {t('pass.count', { count: items.length })}
                  </span>
                </h2>
                {items.length === 0 ? (
                  <p className="text-sm leading-5 text-text-muted">{t('pass.empty')}</p>
                ) : (
                  <ul className="flex flex-col gap-3">
                    {items.map((order) => (
                      <li key={order.id}>
                        <PassCard
                          order={order}
                          nowMs={now + offset}
                          busy={move.isPending && move.variables.order.id === order.id}
                          register={(element) => {
                            if (element) cards.current.set(order.id, element);
                            else cards.current.delete(order.id);
                          }}
                          onMove={(status, reason) => {
                            if (move.isPending) return;
                            setNotice(null);
                            move.mutate({ order, status, ...(reason ? { reason } : {}) });
                          }}
                          onSibling={(delta) => {
                            focusSibling(order.id, delta);
                          }}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </OrderShell>
  );
}

function useAge(): (sinceIso: string, nowMs: number) => string {
  const { t } = useT('order');
  return (sinceIso, nowMs) => {
    const minutes = Math.max(0, Math.floor((nowMs - new Date(sinceIso).getTime()) / 60_000));
    if (minutes < 1) return t('pass.ageNow');
    if (minutes < 60) return t('pass.ageMinutes', { minutes });
    return t('pass.ageHours', { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
  };
}

function PassCard({
  order,
  nowMs,
  busy,
  register,
  onMove,
  onSibling,
}: {
  order: PassOrder;
  nowMs: number;
  busy: boolean;
  register: (element: HTMLElement | null) => void;
  onMove: (status: OrderStatus, reason?: string) => void;
  onSibling: (delta: number) => void;
}) {
  const { t } = useT('order');
  const locale = useLocale();
  const age = useAge();
  const titleId = useId();
  const reasonId = useId();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState(false);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (cancelling) reasonRef.current?.focus();
  }, [cancelling]);

  const cash = order.payment.method === 'CASH_ON_DELIVERY';
  const next = order.next;
  const advanceLabel = next
    ? cash && (next === 'CONFIRMED' || next === 'DELIVERED')
      ? t(`pass.advanceCash.${next}`)
      : next === 'PENDING_PAYMENT' || next === 'PENDING_CONFIRMATION' || next === 'CANCELLED'
        ? null
        : t(`pass.advance.${next}`)
    : null;
  const operation = order.payment.operation;
  const address = order.deliveryAddress;
  const cancelHint = cash
    ? t('pass.cancelCash')
    : order.status === 'PENDING_CONFIRMATION'
      ? t('pass.cancelVoid')
      : t('pass.cancelRefund');

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    // Solo con el pedido mismo enfocado: escribir en el motivo nunca dispara un atajo.
    if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey) return;
    const key = event.key.toLowerCase();
    if (key === 'j' || event.key === 'ArrowDown') {
      event.preventDefault();
      onSibling(1);
    } else if (key === 'k' || event.key === 'ArrowUp') {
      event.preventDefault();
      onSibling(-1);
    } else if (key === 'a' && next && advanceLabel && !busy) {
      event.preventDefault();
      onMove(next);
    } else if (key === 'c' && order.canCancel) {
      event.preventDefault();
      setCancelling(true);
    }
  }

  function confirmCancel() {
    const text = reason.trim();
    if (!text) {
      setReasonError(true);
      reasonRef.current?.focus();
      return;
    }
    setReasonError(false);
    onMove('CANCELLED', text);
  }

  return (
    <article
      ref={register}
      tabIndex={0}
      aria-labelledby={titleId}
      data-order-code={order.code}
      data-status={order.status}
      onKeyDown={onKeyDown}
      className="flex flex-col gap-3 border border-border bg-surface-raised p-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id={titleId} className="t-h3" translate="no">
          {order.code}
        </h3>
        <time dateTime={order.statusSince} className="t-ui">
          {age(order.statusSince, nowMs)}
        </time>
      </header>
      <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm leading-5">
        <span className="border border-text px-2 py-0.5">
          {t(`pass.fulfillment.${order.fulfillmentType}`)}
        </span>
        <span className="py-0.5">{t('pass.customer', { name: order.customerName })}</span>
      </p>
      <ul className="flex flex-col gap-1 t-body">
        {order.items.map((item) => (
          <li key={item.key}>
            <span className="t-ui">{`${String(item.quantity)} × `}</span>
            <span translate="no">{item.name}</span>
            {item.options.length > 0 ? (
              <span className="block text-sm leading-5 text-text-muted">
                {item.options.map((option) => `${option.group}: ${option.label}`).join(' · ')}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {order.customerNote ? (
        <p className="border-l-4 border-highlight pl-3 text-sm leading-5">
          {t('pass.note', { note: order.customerNote })}
        </p>
      ) : null}
      {address ? (
        <p className="text-sm leading-5">
          {t('pass.address', {
            address: [address.line1, address.line2, address.district, address.canton]
              .filter(Boolean)
              .join(', '),
            reference: address.reference,
          })}
        </p>
      ) : null}
      {order.contactPhone ? (
        <p className="text-sm leading-5">{t('pass.phone', { phone: order.contactPhone })}</p>
      ) : null}
      <p className="text-sm leading-5 text-text-muted">
        {t(`pass.method.${order.payment.method}`)} · {t(`confirmation.paymentStatus.${order.payment.status}`)}{' '}
        · {t('pass.total', { total: formatMoney(order.totalMinor, order.currency, locale) })}
      </p>
      {operation ? (
        <p
          className={
            operation.state === 'FAILED'
              ? 'border-l-4 border-danger pl-3 text-sm leading-5'
              : 'border-l-4 border-border-strong pl-3 text-sm leading-5'
          }
        >
          {t(`pass.operation.${operation.type}_${operation.state}`)}
        </p>
      ) : null}
      {cancelling ? (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <p className="t-ui">{t('pass.cancelTitle', { code: order.code })}</p>
          <p className="text-sm leading-5 text-text-muted">{cancelHint}</p>
          <label htmlFor={reasonId} className="t-ui">
            {t('pass.cancelReason')}
          </label>
          <textarea
            ref={reasonRef}
            id={reasonId}
            value={reason}
            required
            maxLength={300}
            rows={2}
            aria-invalid={reasonError || undefined}
            aria-describedby={reasonError ? `${reasonId}-error` : undefined}
            onChange={(event) => {
              setReason(event.target.value);
            }}
            className="min-h-12 w-full rounded-[var(--radius-control)] border border-border-strong bg-surface px-3 py-2 t-body focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          />
          {reasonError ? (
            <p id={`${reasonId}-error`} className="text-sm leading-5 text-danger">
              {t('pass.errors.reason')}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" loading={busy} onClick={confirmCancel}>
              {t('pass.cancelConfirm')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setCancelling(false);
                setReasonError(false);
              }}
            >
              {t('pass.cancelKeep')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {next && advanceLabel ? (
            <Button
              loading={busy}
              onClick={() => {
                if (!busy) onMove(next);
              }}
            >
              {advanceLabel}
            </Button>
          ) : null}
          {order.canCancel ? (
            <Button
              variant="secondary"
              onClick={() => {
                setCancelling(true);
              }}
            >
              {t('pass.cancel')}
            </Button>
          ) : null}
        </div>
      )}
    </article>
  );
}
