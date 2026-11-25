import { ordersListResponseSchema, type OrderSummary } from '@marea-baja/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link, Navigate } from 'react-router';
import { ApiError, apiGet } from '../../account/api.ts';
import { useLocalizedPath } from '../../account/links.ts';
import { orderMeta, OrderShell } from '../../cart/OrderShell.tsx';
import { Button, buttonClassName } from '../../components/ui/Button.tsx';
import { Price } from '../../components/ui/Price.tsx';
import { useLocale, useT } from '../../i18n/use-locale.ts';
import type { Route } from './+types/pedidos';

/**
 * Historial de pedidos del cliente (M7, D3): solo los propios (lo garantiza la API), del más nuevo
 * al más viejo, de a 20. Cada pedido abre su seguimiento.
 */
export function meta({ location }: Route.MetaArgs) {
  return orderMeta(location.pathname, 'history.metaTitle');
}

export default function Pedidos() {
  const { t } = useT('order');
  const to = useLocalizedPath();
  const orders = useInfiniteQuery({
    queryKey: ['orders', 'history'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      apiGet(
        pageParam ? `/api/orders?cursor=${encodeURIComponent(pageParam)}` : '/api/orders',
        ordersListResponseSchema,
      ),
    getNextPageParam: (last) => last.nextCursor,
    retry: false,
  });

  if (orders.isError && orders.error instanceof ApiError && orders.error.status === 401) {
    return <Navigate to={to('/cuenta/ingresar')} replace />;
  }
  return (
    <OrderShell title={t('history.title')} intro={t('history.intro')}>
      {orders.isPending ? (
        <p role="status" className="t-body text-text-muted">
          {t('history.loading')}
        </p>
      ) : orders.isError ? (
        <p role="alert" className="t-body text-danger">
          {t('history.error')}
        </p>
      ) : (
        <HistoryList
          orders={orders.data.pages.flatMap((page) => page.orders)}
          hasMore={orders.hasNextPage}
          loadingMore={orders.isFetchingNextPage}
          onMore={() => void orders.fetchNextPage()}
        />
      )}
    </OrderShell>
  );
}

function HistoryList({
  orders,
  hasMore,
  loadingMore,
  onMore,
}: {
  orders: OrderSummary[];
  hasMore: boolean;
  loadingMore: boolean;
  onMore: () => void;
}) {
  const { t } = useT('order');
  const locale = useLocale();
  const to = useLocalizedPath();
  const date = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Costa_Rica',
  });

  if (orders.length === 0) {
    return (
      <div className="flex max-w-2xl flex-col gap-4">
        <p className="t-body">{t('history.empty')}</p>
        <Link to={to('/carta/ceviches')} className={`${buttonClassName('secondary')} self-start`}>
          {t('history.emptyAction')}
        </Link>
      </div>
    );
  }
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <ul className="flex flex-col border-t border-border">
        {orders.map((order) => (
          <li key={order.id} className="border-b border-border">
            <Link
              to={to(`/cuenta/pedidos/${order.id}`)}
              className="group grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 py-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              <span className="t-ui underline-offset-4 group-hover:underline">
                {t('history.open', { code: order.code })}
              </span>
              <Price amountMinor={order.totalMinor} currency={order.currency} />
              <span className="t-body" data-status={order.status}>
                {t(`confirmation.status.${order.status}`)}
              </span>
              <span className="text-right text-sm leading-5 text-text-muted">
                {t(`history.fulfillment.${order.fulfillmentType}`)} ·{' '}
                {t('history.items', { count: order.itemCount })}
              </span>
              <span className="col-span-2 text-sm leading-5 text-text-muted">
                {date.format(new Date(order.createdAt))}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {hasMore ? (
        <Button variant="secondary" className="self-start" loading={loadingMore} onClick={onMore}>
          {t('history.more')}
        </Button>
      ) : null}
    </div>
  );
}
