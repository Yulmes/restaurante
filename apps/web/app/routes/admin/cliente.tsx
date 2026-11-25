import {
  ROLE_KEYS,
  adminCustomerResponseSchema,
  type AdminCustomerDetail,
  type RoleKey,
} from '@marea-baja/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ApiError, apiGet, apiSend } from '../../account/api.ts';
import { useLocalizedPath } from '../../account/links.ts';
import { useMe } from '../../account/session.ts';
import {
  AdminPage,
  CheckField,
  Notice,
  TextArea,
  adminMeta,
  useDateTime,
  useErrorText,
  type NoticeState,
} from '../../admin/kit.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { Price } from '../../components/ui/Price.tsx';
import { useT } from '../../i18n/use-locale.ts';
import type { Route } from './+types/cliente';

/**
 * Admin · Cliente (M8, §8.6): datos, últimos pedidos, bloqueo y roles, siempre con motivo.
 * Nadie se cambia a sí mismo y siempre queda un admin activo: la API lo garantiza.
 */
export function meta({ location }: Route.MetaArgs) {
  return adminMeta(location.pathname, 'customers');
}

export default function AdminCustomer() {
  const { t } = useT('admin');
  return (
    <AdminPage section="customers" title={t('customer.title')}>
      <CustomerBody />
    </AdminPage>
  );
}

function CustomerBody() {
  const { t } = useT('admin');
  const to = useLocalizedPath();
  const { id = '' } = useParams();
  const detail = useQuery({
    queryKey: ['admin', 'customer', id],
    queryFn: () => apiGet(`/api/admin/customers/${encodeURIComponent(id)}`, adminCustomerResponseSchema),
    retry: false,
  });
  if (detail.isPending) {
    return (
      <p role="status" className="t-body text-text-muted">
        {t('access.loading')}
      </p>
    );
  }
  if (!detail.data) {
    const missing = detail.error instanceof ApiError && detail.error.status === 404;
    return (
      <div className="flex flex-col gap-4">
        <p role="alert" className="t-body">
          {missing ? t('customer.notFound') : t('errors.load')}
        </p>
        <Link to={to('/admin/clientes')} className="t-ui underline underline-offset-4">
          {t('customer.back')}
        </Link>
      </div>
    );
  }
  return <CustomerView customer={detail.data.customer} />;
}

function CustomerView({ customer }: { customer: AdminCustomerDetail }) {
  const { t } = useT('admin');
  const { t: tOrder } = useT('order');
  const to = useLocalizedPath();
  const dateTime = useDateTime();
  const errorText = useErrorText();
  const client = useQueryClient();
  const me = useMe();
  const self = me.data?.id === customer.id;
  const [notice, setNotice] = useState<NoticeState>(null);
  const [roles, setRoles] = useState<RoleKey[]>(customer.roles);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | undefined>();

  const update = useMutation({
    mutationFn: (body: { blocked?: boolean; roles?: RoleKey[] }) =>
      apiSend(
        'PATCH',
        `/api/admin/customers/${customer.id}`,
        { ...body, reason: reason.trim() },
        adminCustomerResponseSchema,
      ),
    onSuccess: (_result, body) => {
      setReason('');
      setNotice({
        tone: 'ok',
        text:
          body.blocked === true
            ? t('customer.blockedDone', { name: customer.name })
            : body.blocked === false
              ? t('customer.unblockedDone', { name: customer.name })
              : t('customer.rolesDone', { name: customer.name }),
      });
      void client.invalidateQueries({ queryKey: ['admin', 'customer', customer.id] });
      void client.invalidateQueries({ queryKey: ['admin', 'customers'] });
    },
    onError: (error) => {
      setNotice({ tone: 'error', text: errorText(error) });
    },
  });

  function submit(body: { blocked?: boolean; roles?: RoleKey[] }) {
    if (reason.trim().length < 3) {
      setReasonError(t('fields.reason'));
      return;
    }
    setReasonError(undefined);
    setNotice(null);
    update.mutate(body);
  }

  return (
    <div className="flex flex-col gap-8">
      <p>
        <Link to={to('/admin/clientes')} className="t-ui underline underline-offset-4">
          {t('customer.back')}
        </Link>
      </p>
      <header className="flex flex-col gap-1">
        <h2 className="t-h2">{customer.name}</h2>
        <p className="t-body [overflow-wrap:anywhere]">{customer.email}</p>
        <p className="text-sm leading-5 text-text-muted">
          {[
            customer.phone,
            t(`customer.locale.${customer.locale}`),
            customer.emailVerified ? t('customers.verified') : t('customers.unverified'),
            customer.blocked && customer.blockedAt
              ? t('customer.blockedSince', { time: dateTime(customer.blockedAt) })
              : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </header>
      <Notice notice={notice} />

      <div className="grid gap-10 lg:grid-cols-2">
        <section aria-labelledby="customer-orders" className="flex flex-col gap-3">
          <h3 id="customer-orders" className="t-h3">
            {t('customer.orders', { total: customer.orderCount })}
          </h3>
          {customer.recentOrders.length === 0 ? (
            <p className="t-body text-text-muted">{t('customer.noOrders')}</p>
          ) : (
            <ul className="flex flex-col">
              {customer.recentOrders.map((order) => (
                <li
                  key={order.id}
                  className="flex flex-wrap justify-between gap-x-4 border-b border-border py-2.5 t-body"
                >
                  <span>
                    <Link
                      to={to(`/admin/pedidos/${order.id}`)}
                      className="font-semibold underline underline-offset-4"
                      translate="no"
                    >
                      {order.code}
                    </Link>
                    <span className="block text-sm text-text-muted">
                      {tOrder(`confirmation.status.${order.status}`)} · {dateTime(order.createdAt)}
                    </span>
                  </span>
                  <Price amountMinor={order.totalMinor} currency={order.currency} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="customer-access" className="flex flex-col gap-4">
          <h3 id="customer-access" className="t-h3">
            {t('customer.access')}
          </h3>
          {self ? (
            <p className="t-body">{t('customer.selfNote')}</p>
          ) : (
            <>
              <TextArea
                id="customer-reason"
                label={t('common.reason')}
                hint={t('customer.reasonHint')}
                value={reason}
                error={reasonError}
                maxLength={300}
                onChange={(event) => {
                  setReason(event.target.value);
                }}
              />
              <fieldset className="flex flex-col gap-2">
                <legend className="t-ui">{t('customers.roles')}</legend>
                {ROLE_KEYS.map((role) => (
                  <CheckField
                    key={role}
                    id={`role-${role}`}
                    label={t(`roles.${role}`)}
                    hint={t(`customer.roleHint.${role}`)}
                    checked={roles.includes(role)}
                    onChange={(checked) => {
                      setRoles(checked ? [...roles, role] : roles.filter((r) => r !== role));
                    }}
                  />
                ))}
              </fieldset>
              <div className="flex flex-wrap gap-3">
                <Button
                  variant="secondary"
                  loading={update.isPending && update.variables.roles !== undefined}
                  {...(roles.length === 0 ? { disabledReason: t('customer.oneRole') } : {})}
                  onClick={() => {
                    submit({ roles });
                  }}
                >
                  {t('customer.saveRoles')}
                </Button>
                {customer.blocked ? (
                  <Button
                    variant="secondary"
                    loading={update.isPending && update.variables.blocked === false}
                    onClick={() => {
                      submit({ blocked: false });
                    }}
                  >
                    {t('customer.unblock')}
                  </Button>
                ) : (
                  <Button
                    variant="danger"
                    loading={update.isPending && update.variables.blocked === true}
                    onClick={() => {
                      submit({ blocked: true });
                    }}
                  >
                    {t('customer.block')}
                  </Button>
                )}
              </div>
              <p className="text-sm leading-5 text-text-muted">{t('customer.blockHint')}</p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
