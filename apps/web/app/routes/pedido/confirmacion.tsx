import { formatMoney, orderSchema, type Order } from '@marea-baja/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { z } from 'zod';
import { ApiError, apiGet } from '../../account/api.ts';
import { orderMeta, OrderShell, TotalsList } from '../../cart/OrderShell.tsx';
import { PaymentChoice, payErrorKey, usePayOrder, type PaymentSelection } from '../../cart/payment.tsx';
import { Button, buttonClassName } from '../../components/ui/Button.tsx';
import { Price } from '../../components/ui/Price.tsx';
import { pathForLocale } from '../../i18n/locale.ts';
import { useLocale, useT } from '../../i18n/use-locale.ts';
import { ACTIVE_STATUSES, CancelOrderPanel, OrderTracker } from '../../orders/tracking.tsx';
import type { Route } from './+types/confirmacion';

export function meta({ location }: Route.MetaArgs) {
  return orderMeta(location.pathname, 'confirmation.metaTitle');
}

const responseSchema = z.object({ order: orderSchema });

/** Mientras el pago está en proceso (pendiente o tiempo agotado), la pantalla se actualiza sola. */
const PROCESSING_POLL_MS = 2_000;
/** M7: mientras el local lo trabaja, el seguimiento se actualiza solo. */
const TRACKING_POLL_MS = 15_000;

export type OrderPageMode = 'confirmation' | 'tracking';

/**
 * Pedido registrado (M5) y su pago (M6). La pantalla deja claro que es una demostración: no se
 * procesa dinero real. Si el pago está en proceso se actualiza sola; si la tarjeta demo se rechazó,
 * se puede reintentar mientras el pedido sigue reservado. Solo el dueño del pedido lo ve (la API
 * responde 404 a cualquier otra cuenta).
 *
 * M7: la misma página sirve al seguimiento (`/cuenta/pedidos/:id`): estado sobre la línea de
 * marea, cancelación antes de la confirmación y actualización sola mientras el pedido avanza.
 */
export default function Confirmacion() {
  return <OrderPage mode="confirmation" />;
}

export function OrderPage({ mode }: { mode: OrderPageMode }) {
  const { t } = useT('order');
  const locale = useLocale();
  const { id = '' } = useParams();
  const title = mode === 'tracking' ? t('tracking.title') : t('confirmation.title');
  const order = useQuery({
    queryKey: ['order', id],
    queryFn: async () => (await apiGet(`/api/orders/${encodeURIComponent(id)}`, responseSchema)).order,
    retry: false,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.payment.status === 'PROCESSING') return PROCESSING_POLL_MS;
      return data && ACTIVE_STATUSES.includes(data.status) ? TRACKING_POLL_MS : false;
    },
  });

  if (order.isPending) {
    return (
      <OrderShell title={title}>
        <p role="status" className="t-body text-text-muted">
          {t('confirmation.loading')}
        </p>
      </OrderShell>
    );
  }
  if (order.isError) {
    const missing =
      order.error instanceof ApiError && (order.error.status === 404 || order.error.status === 401);
    return (
      <OrderShell title={missing ? t('confirmation.notFound') : title}>
        {missing ? null : (
          <p role="alert" className="t-body text-danger">
            {t('confirmation.error')}
          </p>
        )}
        <Link to={pathForLocale('/carta', locale)} className={`${buttonClassName('secondary')} self-start`}>
          {t('confirmation.backToMenu')}
        </Link>
      </OrderShell>
    );
  }
  return <OrderDetail order={order.data} mode={mode} />;
}

function OrderDetail({ order, mode }: { order: Order; mode: OrderPageMode }) {
  const { t } = useT('order');
  const locale = useLocale();
  const address = order.deliveryAddress;
  return (
    <OrderShell
      title={mode === 'tracking' ? t('tracking.title') : t('confirmation.title')}
      intro={
        mode === 'tracking'
          ? t('tracking.lead', { code: order.code })
          : t('confirmation.lead', { code: order.code })
      }
    >
      <p
        role="status"
        className="max-w-2xl border-l-4 border-border-strong bg-surface-raised px-4 py-3 t-body"
      >
        {t('confirmation.demo')}
      </p>
      <OrderTracker order={order} />
      <div className="grid gap-10 lg:grid-cols-12">
        <div className="flex flex-col gap-6 lg:col-span-7">
          <dl className="grid gap-x-6 gap-y-3 t-body sm:grid-cols-[auto_1fr]">
            <dt className="t-ui">{t('confirmation.statusLabel')}</dt>
            <dd data-status={order.status}>{t(`confirmation.status.${order.status}`)}</dd>
            <dt className="t-ui">{t('confirmation.paymentLabel')}</dt>
            <dd data-payment-status={order.payment.status}>
              {t(`confirmation.paymentStatus.${order.payment.status}`)}
            </dd>
            <dt className="t-ui">{t('confirmation.fulfillmentLabel')}</dt>
            <dd className="flex flex-col">
              {order.fulfillmentType === 'PICKUP' ? (
                <span>{t('confirmation.pickup')}</span>
              ) : (
                <>
                  <span>
                    {t('confirmation.deliveryTo', {
                      address: address
                        ? [address.line1, address.line2, address.district, address.canton]
                            .filter(Boolean)
                            .join(', ')
                        : '',
                    })}
                  </span>
                  {order.deliveryZone ? (
                    <span className="text-sm text-text-muted">
                      {t('confirmation.eta', { minutes: order.deliveryZone.etaMinutes })}
                    </span>
                  ) : null}
                </>
              )}
              {order.contactPhone ? (
                <span>{t('confirmation.phone', { phone: order.contactPhone })}</span>
              ) : null}
              {order.customerNote ? (
                <span>{t('confirmation.note', { note: order.customerNote })}</span>
              ) : null}
            </dd>
          </dl>
          <PaymentPanel order={order} />
          <CancelOrderPanel order={order} />
          <section aria-labelledby="order-items" className="flex flex-col gap-2">
            <h2 id="order-items" className="t-h3">
              {t('confirmation.items')}
            </h2>
            <ul className="flex flex-col">
              {order.items.map((item) => (
                <li key={item.key} className="flex justify-between gap-4 border-b border-border py-3 t-body">
                  <span className="flex flex-col">
                    <span>
                      {`${String(item.quantity)} × `}
                      <span translate="no">{item.name}</span>
                    </span>
                    {item.translatedName ? <span className="text-sm">{item.translatedName}</span> : null}
                    {item.options.length > 0 ? (
                      <span className="text-sm text-text-muted">
                        {item.options.map((o) => `${o.group}: ${o.label}`).join(' · ')}
                      </span>
                    ) : null}
                  </span>
                  <Price amountMinor={item.lineTotalMinor} currency={order.currency} />
                </li>
              ))}
            </ul>
          </section>
        </div>
        <aside
          className="flex flex-col gap-4 lg:col-span-4 lg:col-start-9"
          aria-label={t('checkout.summary')}
        >
          <div className="border-t border-text pt-4">
            <TotalsList
              totals={order.totals}
              currency={order.currency}
              showDelivery={order.fulfillmentType === 'DELIVERY'}
            />
          </div>
          <Link
            to={pathForLocale('/cuenta/pedidos', locale)}
            className="t-ui self-start underline underline-offset-4"
          >
            {t('tracking.allOrders')}
          </Link>
          <Link to={pathForLocale('/carta', locale)} className={`${buttonClassName('secondary')} self-start`}>
            {t('confirmation.backToMenu')}
          </Link>
        </aside>
      </div>
    </OrderShell>
  );
}

function PaymentPanel({ order }: { order: Order }) {
  const { t } = useT('order');
  const locale = useLocale();
  const { payment } = order;
  const pay = usePayOrder();
  const methods = payment.availableMethods;
  const [selection, setSelection] = useState<PaymentSelection>({
    method: methods[0] ?? 'DEMO_CARD',
    scenario: 'APPROVED',
  });
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const failure = payment.lastAttempt?.result === 'FAILED' ? payment.lastAttempt.failureCode : null;
  const effective: PaymentSelection = methods.includes(selection.method)
    ? selection
    : { ...selection, method: methods[0] ?? 'CASH_ON_DELIVERY' };
  const total = formatMoney(order.totals.totalMinor, order.currency, locale);
  const heldUntil = order.expiresAt
    ? new Intl.DateTimeFormat(locale, {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'America/Costa_Rica',
      }).format(new Date(order.expiresAt))
    : null;

  let message: string | null = null;
  if (payment.status === 'PROCESSING') message = t('confirmation.processing');
  else if (payment.status === 'AUTHORIZED') message = t('confirmation.authorized');
  else if (payment.status === 'PENDING_COLLECTION') message = t('confirmation.pendingCollection');
  else if (
    payment.status === 'REQUIRES_PAYMENT' &&
    order.status === 'PENDING_PAYMENT' &&
    methods.length === 0
  )
    message = t('confirmation.expired');

  // M7: con el pago ya cobrado, anulado o reembolsado no queda nada que decir ni hacer aquí (el
  // estado del pago se ve en el resumen); la sección vacía no se muestra.
  if (!message && !failure && methods.length === 0) return null;
  return (
    <section aria-labelledby="order-payment" className="flex flex-col gap-4 border-t border-border pt-6">
      <h2 id="order-payment" className="t-h3">
        {t('confirmation.payTitle')}
      </h2>
      {/* Región viva: el cambio de "en proceso" a "autorizado" se anuncia solo. */}
      <div aria-live="polite" className="flex flex-col gap-3">
        {message ? <p className="t-body">{message}</p> : null}
        {failure && methods.length > 0 ? (
          <p className="border border-l-4 border-danger bg-surface-raised px-4 py-3 t-body">
            {t(`confirmation.failure.${failure}`)}
          </p>
        ) : null}
      </div>
      {methods.length > 0 ? (
        <>
          {heldUntil ? (
            <p className="text-sm leading-5 text-text-muted">
              {t('confirmation.reservedUntil', { time: heldUntil })}
            </p>
          ) : null}
          <PaymentChoice
            idPrefix="order-payment"
            methods={methods}
            value={effective}
            onChange={setSelection}
          />
          {error ? (
            <p ref={errorRef} tabIndex={-1} role="alert" className="t-body text-danger">
              {error}
            </p>
          ) : null}
          <Button
            loading={pay.isPending}
            className="self-start"
            onClick={() => {
              if (pay.isPending) return;
              setError(null);
              pay.mutate(
                { orderId: order.id, selection: effective },
                {
                  onError: (cause) => {
                    setError(t(payErrorKey(cause)));
                  },
                },
              );
            }}
          >
            {effective.method === 'DEMO_CARD'
              ? t('confirmation.payCard', { total })
              : t('confirmation.payCash')}
          </Button>
        </>
      ) : null}
    </section>
  );
}
