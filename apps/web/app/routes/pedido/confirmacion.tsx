import { orderSchema, type Order } from '@marea-baja/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { z } from 'zod';
import { ApiError, apiGet } from '../../account/api.ts';
import { orderMeta, OrderShell, TotalsList } from '../../cart/OrderShell.tsx';
import { buttonClassName } from '../../components/ui/Button.tsx';
import { Price } from '../../components/ui/Price.tsx';
import { pathForLocale } from '../../i18n/locale.ts';
import { useLocale, useT } from '../../i18n/use-locale.ts';
import type { Route } from './+types/confirmacion';

export function meta({ location }: Route.MetaArgs) {
  return orderMeta(location.pathname, 'confirmation.metaTitle');
}

const responseSchema = z.object({ order: orderSchema });

/**
 * Pedido registrado (M5, D-M5-1): el pedido queda en `PENDING_PAYMENT` con el pago pendiente.
 * La pantalla lo dice con claridad: es una demostración, el pago no está habilitado y no se cobró
 * nada. Solo el dueño del pedido lo ve (la API responde 404 a cualquier otra cuenta).
 */
export default function Confirmacion() {
  const { t } = useT('order');
  const locale = useLocale();
  const { id = '' } = useParams();
  const order = useQuery({
    queryKey: ['order', id],
    queryFn: async () => (await apiGet(`/api/orders/${encodeURIComponent(id)}`, responseSchema)).order,
    retry: false,
  });

  if (order.isPending) {
    return (
      <OrderShell title={t('confirmation.title')}>
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
      <OrderShell title={missing ? t('confirmation.notFound') : t('confirmation.title')}>
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
  return <OrderDetail order={order.data} />;
}

function OrderDetail({ order }: { order: Order }) {
  const { t } = useT('order');
  const locale = useLocale();
  const address = order.deliveryAddress;
  return (
    <OrderShell title={t('confirmation.title')} intro={t('confirmation.lead', { code: order.code })}>
      <p
        role="status"
        className="max-w-2xl border-l-4 border-border-strong bg-surface-raised px-4 py-3 t-body"
      >
        {t('confirmation.demo')}
      </p>
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
          <Link to={pathForLocale('/carta', locale)} className={`${buttonClassName('secondary')} self-start`}>
            {t('confirmation.backToMenu')}
          </Link>
        </aside>
      </div>
    </OrderShell>
  );
}
