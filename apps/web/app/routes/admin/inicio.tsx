import { adminDashboardResponseSchema, type DashboardRange } from '@marea-baja/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { apiGet } from '../../account/api.ts';
import { useLocalizedPath } from '../../account/links.ts';
import { AdminPage, adminMeta, useDateTime } from '../../admin/kit.tsx';
import { Price } from '../../components/ui/Price.tsx';
import { useT } from '../../i18n/use-locale.ts';
import type { Route } from './+types/inicio';

/**
 * Admin · Resumen (M8, §12 "dashboard con datos reales"). El contrato del Pase prohíbe poner un
 * tablero de métricas antes del trabajo pendiente (§2.4): por eso lo primero que se lee aquí son
 * los pedidos que esperan, con el enlace al Pase, y después las cifras del período.
 */
export function meta({ location }: Route.MetaArgs) {
  return adminMeta(location.pathname, 'dashboard');
}

const RANGES: DashboardRange[] = ['today', '7d', '30d'];

export default function AdminDashboard() {
  const { t } = useT('admin');
  return (
    <AdminPage section="dashboard" title={t('dashboard.title')} intro={t('dashboard.intro')}>
      <DashboardBody />
    </AdminPage>
  );
}

function DashboardBody() {
  const { t } = useT('admin');
  const { t: tOrder } = useT('order');
  const to = useLocalizedPath();
  const dateTime = useDateTime();
  const [range, setRange] = useState<DashboardRange>('today');
  const data = useQuery({
    queryKey: ['admin', 'dashboard', range],
    queryFn: () => apiGet(`/api/admin/dashboard?range=${range}`, adminDashboardResponseSchema),
    refetchInterval: 30_000,
    retry: false,
  });
  const d = data.data;

  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="dash-pending" className="flex flex-col gap-4">
        <h2 id="dash-pending" className="t-h2">
          {t('dashboard.pendingTitle')}
        </h2>
        {d ? (
          <div className="flex flex-col gap-4">
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {(['confirmation', 'kitchen', 'ready'] as const).map((key) => (
                <div
                  key={key}
                  className="flex flex-col gap-1 border-l-4 border-text bg-surface-raised px-4 py-3"
                >
                  <dt className="t-ui text-text-muted">{t(`dashboard.pending.${key}`)}</dt>
                  <dd className="font-display text-3xl font-semibold tabular-nums">{d.pending[key]}</dd>
                </div>
              ))}
            </dl>
            <p>
              <Link to={to('/admin/pase')} className="t-ui underline underline-offset-4">
                {t('dashboard.toPass')}
              </Link>
            </p>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="dash-period" className="flex flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 id="dash-period" className="t-h2">
            {t('dashboard.periodTitle')}
          </h2>
          <fieldset className="flex flex-wrap gap-2">
            <legend className="sr-only">{t('dashboard.rangeLabel')}</legend>
            {RANGES.map((value) => (
              <label
                key={value}
                className={`inline-flex min-h-11 cursor-pointer items-center rounded-[var(--radius-control)] border px-4 t-ui has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus ${
                  range === value ? 'border-text bg-text text-surface' : 'border-border bg-surface-raised'
                }`}
              >
                <input
                  type="radio"
                  name="range"
                  value={value}
                  checked={range === value}
                  onChange={() => {
                    setRange(value);
                  }}
                  className="sr-only"
                />
                {t(`dashboard.ranges.${value}`)}
              </label>
            ))}
          </fieldset>
        </div>

        {data.isError ? (
          <p role="alert" className="t-body text-danger">
            {t('errors.load')}
          </p>
        ) : null}
        {data.isPending ? (
          <p role="status" className="t-body text-text-muted">
            {t('access.loading')}
          </p>
        ) : null}

        {d ? (
          <div className="flex flex-col gap-8">
            <p className="text-sm leading-5 text-text-muted">
              {t('dashboard.periodNote', { from: dateTime(d.from), to: dateTime(d.to) })}
            </p>
            <dl className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label={t('dashboard.sales.net')}>
                <Price amountMinor={d.sales.netMinor} currency={d.currency} />
              </Stat>
              <Stat label={t('dashboard.sales.orders')}>{d.sales.orders}</Stat>
              <Stat label={t('dashboard.sales.average')}>
                <Price amountMinor={d.sales.averageTicketMinor} currency={d.currency} />
              </Stat>
              <Stat label={t('dashboard.sales.refunded')}>
                <Price amountMinor={d.sales.refundedMinor} currency={d.currency} />
              </Stat>
            </dl>
            <p className="text-sm leading-5 text-text-muted">{t('dashboard.salesNote')}</p>
            {d.otherCurrencyOrders > 0 ? (
              <p className="text-sm leading-5 text-text-muted">
                {t('dashboard.otherCurrency', { n: d.otherCurrencyOrders })}
              </p>
            ) : null}

            <div className="grid gap-8 lg:grid-cols-2">
              <section aria-labelledby="dash-top" className="flex flex-col gap-3">
                <h3 id="dash-top" className="t-h3">
                  {t('dashboard.topTitle')}
                </h3>
                {d.topProducts.length === 0 ? (
                  <p className="t-body text-text-muted">{t('dashboard.topEmpty')}</p>
                ) : (
                  <table className="w-full t-body">
                    <thead>
                      <tr className="border-b border-text text-left t-ui">
                        <th scope="col" className="py-2 pr-3">
                          {t('dashboard.topProduct')}
                        </th>
                        <th scope="col" className="py-2 pr-3 text-right">
                          {t('dashboard.topQuantity')}
                        </th>
                        <th scope="col" className="py-2 text-right">
                          {t('dashboard.topRevenue')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.topProducts.map((row) => (
                        <tr key={row.name} className="border-b border-border">
                          <th scope="row" className="py-2 pr-3 text-left font-normal" translate="no">
                            {row.name}
                          </th>
                          <td className="py-2 pr-3 text-right tabular-nums">{row.quantity}</td>
                          <td className="py-2 text-right">
                            <Price amountMinor={row.revenueMinor} currency={d.currency} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>

              <section aria-labelledby="dash-status" className="flex flex-col gap-3">
                <h3 id="dash-status" className="t-h3">
                  {t('dashboard.statusTitle')}
                </h3>
                <dl className="flex flex-col t-body">
                  {d.ordersByStatus.map((row) => (
                    <div key={row.status} className="flex justify-between gap-4 border-b border-border py-2">
                      <dt>{tOrder(`confirmation.status.${row.status}`)}</dt>
                      <dd className="tabular-nums">{row.count}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-t-2 border-text pt-3">
      <dt className="t-ui text-text-muted">{label}</dt>
      <dd className="font-display text-2xl font-semibold tabular-nums">{children}</dd>
    </div>
  );
}
