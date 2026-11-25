import { ORDER_STATUSES, adminOrdersResponseSchema } from '@marea-baja/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useState, type SyntheticEvent } from 'react';
import { Link } from 'react-router';
import { apiGet } from '../../account/api.ts';
import { useLocalizedPath } from '../../account/links.ts';
import { AdminPage, SelectField, adminMeta, useDateTime } from '../../admin/kit.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { Price } from '../../components/ui/Price.tsx';
import { TextField } from '../../components/ui/TextField.tsx';
import { useT } from '../../i18n/use-locale.ts';
import type { Route } from './+types/pedidos';

/** Admin · Pedidos (M8): todos los pedidos, con búsqueda y estado; el detalle permite reembolsar. */
export function meta({ location }: Route.MetaArgs) {
  return adminMeta(location.pathname, 'orders');
}

export default function AdminOrders() {
  const { t } = useT('admin');
  return (
    <AdminPage section="orders" title={t('orders.title')} intro={t('orders.intro')}>
      <OrdersBody />
    </AdminPage>
  );
}

function OrdersBody() {
  const { t } = useT('admin');
  const { t: tOrder } = useT('order');
  const to = useLocalizedPath();
  const dateTime = useDateTime();
  const [draft, setDraft] = useState({ q: '', status: '' });
  const [filters, setFilters] = useState({ q: '', status: '' });
  const list = useInfiniteQuery({
    queryKey: ['admin', 'orders', filters],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (filters.q) params.set('q', filters.q);
      if (filters.status) params.set('status', filters.status);
      if (pageParam) params.set('cursor', pageParam);
      return apiGet(`/api/admin/orders?${params.toString()}`, adminOrdersResponseSchema);
    },
    getNextPageParam: (last) => last.nextCursor,
    retry: false,
  });
  const orders = list.data?.pages.flatMap((page) => page.orders) ?? [];

  function onSubmit(event: SyntheticEvent) {
    event.preventDefault();
    setFilters({ q: draft.q.trim(), status: draft.status });
  }

  return (
    <div className="flex flex-col gap-6">
      <form role="search" onSubmit={onSubmit} className="flex flex-wrap items-end gap-4">
        <TextField
          id="orders-q"
          label={t('orders.search')}
          hint={t('orders.searchHint')}
          value={draft.q}
          onChange={(event) => {
            setDraft({ ...draft, q: event.target.value });
          }}
        />
        <SelectField
          id="orders-status"
          label={t('orders.status')}
          value={draft.status}
          onChange={(event) => {
            setDraft({ ...draft, status: event.target.value });
          }}
        >
          <option value="">{t('orders.allStatuses')}</option>
          {ORDER_STATUSES.map((status) => (
            <option key={status} value={status}>
              {tOrder(`confirmation.status.${status}`)}
            </option>
          ))}
        </SelectField>
        <Button type="submit" variant="secondary">
          {t('common.filter')}
        </Button>
      </form>

      {list.isError ? (
        <p role="alert" className="t-body text-danger">
          {t('errors.load')}
        </p>
      ) : null}
      {list.isPending ? (
        <p role="status" className="t-body text-text-muted">
          {t('access.loading')}
        </p>
      ) : orders.length === 0 ? (
        <p className="t-body text-text-muted">{t('orders.empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] t-body">
            <caption className="sr-only">{t('orders.title')}</caption>
            <thead>
              <tr className="border-b-2 border-text text-left t-ui">
                <th scope="col" className="py-2 pr-3">
                  {t('orders.code')}
                </th>
                <th scope="col" className="py-2 pr-3">
                  {t('orders.customer')}
                </th>
                <th scope="col" className="py-2 pr-3">
                  {t('orders.status')}
                </th>
                <th scope="col" className="py-2 pr-3">
                  {t('orders.date')}
                </th>
                <th scope="col" className="py-2 text-right">
                  {t('orders.total')}
                </th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id} className="border-b border-border">
                  <th scope="row" className="py-2.5 pr-3 text-left font-normal">
                    <Link
                      to={to(`/admin/pedidos/${order.id}`)}
                      className="font-semibold underline underline-offset-4"
                      translate="no"
                    >
                      {order.code}
                    </Link>
                  </th>
                  <td className="py-2.5 pr-3">{order.customerName}</td>
                  <td className="py-2.5 pr-3">
                    {tOrder(`confirmation.status.${order.status}`)}
                    {order.payment.amountRefundedMinor > 0 ? (
                      <span className="block text-sm text-text-muted">{t('orders.refunded')}</span>
                    ) : null}
                  </td>
                  <td className="py-2.5 pr-3 whitespace-nowrap">{dateTime(order.createdAt)}</td>
                  <td className="py-2.5 text-right">
                    <Price amountMinor={order.totalMinor} currency={order.currency} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {list.hasNextPage ? (
        <Button
          variant="secondary"
          loading={list.isFetchingNextPage}
          onClick={() => {
            void list.fetchNextPage();
          }}
        >
          {t('common.loadMore')}
        </Button>
      ) : null}
    </div>
  );
}
