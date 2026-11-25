import { adminCustomersResponseSchema } from '@marea-baja/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useState, type SyntheticEvent } from 'react';
import { Link } from 'react-router';
import { apiGet } from '../../account/api.ts';
import { useLocalizedPath } from '../../account/links.ts';
import { AdminPage, adminMeta, useDateTime } from '../../admin/kit.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { TextField } from '../../components/ui/TextField.tsx';
import { useT } from '../../i18n/use-locale.ts';
import type { Route } from './+types/clientes';

/** Admin · Clientes (M8, §8.6): búsqueda por nombre o correo; el detalle bloquea y cambia roles. */
export function meta({ location }: Route.MetaArgs) {
  return adminMeta(location.pathname, 'customers');
}

export default function AdminCustomers() {
  const { t } = useT('admin');
  return (
    <AdminPage section="customers" title={t('customers.title')} intro={t('customers.intro')}>
      <CustomersBody />
    </AdminPage>
  );
}

function CustomersBody() {
  const { t } = useT('admin');
  const to = useLocalizedPath();
  const dateTime = useDateTime();
  const [draft, setDraft] = useState('');
  const [q, setQ] = useState('');
  const list = useInfiniteQuery({
    queryKey: ['admin', 'customers', q],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (pageParam) params.set('cursor', pageParam);
      return apiGet(`/api/admin/customers?${params.toString()}`, adminCustomersResponseSchema);
    },
    getNextPageParam: (last) => last.nextCursor,
    retry: false,
  });
  const customers = list.data?.pages.flatMap((page) => page.customers) ?? [];

  function onSubmit(event: SyntheticEvent) {
    event.preventDefault();
    setQ(draft.trim());
  }

  return (
    <div className="flex flex-col gap-6">
      <form role="search" onSubmit={onSubmit} className="flex flex-wrap items-end gap-4">
        <TextField
          id="customers-q"
          type="search"
          label={t('customers.search')}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
        />
        <Button type="submit" variant="secondary">
          {t('common.search')}
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
      ) : customers.length === 0 ? (
        <p className="t-body text-text-muted">{t('customers.empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] t-body">
            <caption className="sr-only">{t('customers.title')}</caption>
            <thead>
              <tr className="border-b-2 border-text text-left t-ui">
                <th scope="col" className="py-2 pr-3">
                  {t('customers.name')}
                </th>
                <th scope="col" className="py-2 pr-3">
                  {t('customers.email')}
                </th>
                <th scope="col" className="py-2 pr-3">
                  {t('customers.roles')}
                </th>
                <th scope="col" className="py-2 pr-3">
                  {t('customers.state')}
                </th>
                <th scope="col" className="py-2 pr-3 text-right">
                  {t('customers.orders')}
                </th>
                <th scope="col" className="py-2">
                  {t('customers.since')}
                </th>
              </tr>
            </thead>
            <tbody>
              {customers.map((customer) => (
                <tr key={customer.id} className="border-b border-border">
                  <th scope="row" className="py-2.5 pr-3 text-left font-normal">
                    <Link to={to(`/admin/clientes/${customer.id}`)} className="underline underline-offset-4">
                      {customer.name}
                    </Link>
                  </th>
                  <td className="py-2.5 pr-3 [overflow-wrap:anywhere]">{customer.email}</td>
                  <td className="py-2.5 pr-3">
                    {customer.roles.map((role) => t(`roles.${role}`)).join(', ')}
                  </td>
                  <td className="py-2.5 pr-3">
                    {customer.blocked
                      ? t('customers.blocked')
                      : customer.emailVerified
                        ? t('customers.verified')
                        : t('customers.unverified')}
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">{customer.orderCount}</td>
                  <td className="py-2.5 whitespace-nowrap">{dateTime(customer.createdAt)}</td>
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
