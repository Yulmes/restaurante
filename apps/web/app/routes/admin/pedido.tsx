import { adminOrderDetailResponseSchema, type AdminOrderDetail } from '@marea-baja/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type SyntheticEvent } from 'react';
import { Link, useParams } from 'react-router';
import { ApiError, apiGet, apiSend } from '../../account/api.ts';
import { useLocalizedPath } from '../../account/links.ts';
import {
  AdminPage,
  Notice,
  TextArea,
  adminMeta,
  fromMinor,
  toMinor,
  useDateTime,
  useErrorText,
  type NoticeState,
} from '../../admin/kit.tsx';
import { TotalsList } from '../../cart/OrderShell.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { Price } from '../../components/ui/Price.tsx';
import { TextField } from '../../components/ui/TextField.tsx';
import { useT } from '../../i18n/use-locale.ts';
import type { Route } from './+types/pedido';

/**
 * Admin · Detalle del pedido (M8; la pantalla de reembolsos que M7 dejó para M8, ADR 0008).
 * Reembolso total o parcial con motivo (§8.6) y una `Idempotency-Key` por intento; cancelación
 * con motivo obligatorio. La API decide montos, estados y permisos.
 */
export function meta({ location }: Route.MetaArgs) {
  return adminMeta(location.pathname, 'orders');
}

export default function AdminOrder() {
  const { t } = useT('admin');
  return (
    <AdminPage section="orders" title={t('order.title')}>
      <OrderBody />
    </AdminPage>
  );
}

function OrderBody() {
  const { t } = useT('admin');
  const { id = '' } = useParams();
  const to = useLocalizedPath();
  const detail = useQuery({
    queryKey: ['admin', 'order', id],
    queryFn: () => apiGet(`/api/admin/orders/${encodeURIComponent(id)}`, adminOrderDetailResponseSchema),
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
          {missing ? t('order.notFound') : t('errors.load')}
        </p>
        <Link to={to('/admin/pedidos')} className="t-ui underline underline-offset-4">
          {t('order.back')}
        </Link>
      </div>
    );
  }
  return <OrderView data={detail.data} />;
}

function OrderView({ data }: { data: AdminOrderDetail }) {
  const { t } = useT('admin');
  const { t: tOrder } = useT('order');
  const to = useLocalizedPath();
  const dateTime = useDateTime();
  const { order, payment } = data;
  const refundable = payment.amountCapturedMinor - payment.amountRefundedMinor;
  const [notice, setNotice] = useState<NoticeState>(null);

  return (
    <div className="flex flex-col gap-8">
      <p>
        <Link to={to('/admin/pedidos')} className="t-ui underline underline-offset-4">
          {t('order.back')}
        </Link>
      </p>
      <header className="flex flex-col gap-1">
        <h2 className="t-h2" translate="no">
          {order.code}
        </h2>
        <p className="t-body">
          {tOrder(`confirmation.status.${order.status}`)} ·{' '}
          {tOrder(`history.fulfillment.${order.fulfillmentType}`)}
        </p>
        <p className="text-sm leading-5 text-text-muted">{dateTime(order.createdAt)}</p>
      </header>
      <Notice notice={notice} />

      <div className="grid gap-10 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex flex-col gap-8">
          <section aria-labelledby="order-items" className="flex flex-col gap-3">
            <h3 id="order-items" className="t-h3">
              {t('order.items')}
            </h3>
            <ul className="flex flex-col">
              {order.items.map((item) => (
                <li
                  key={item.key}
                  className="flex justify-between gap-4 border-b border-border py-2.5 t-body"
                >
                  <span>
                    <span className="tabular-nums">{item.quantity} × </span>
                    <span translate="no">{item.name}</span>
                    {item.options.length > 0 ? (
                      <span className="block text-sm text-text-muted">
                        {item.options.map((option) => `${option.group}: ${option.label}`).join(' · ')}
                      </span>
                    ) : null}
                  </span>
                  <Price amountMinor={item.lineTotalMinor} currency={order.currency} />
                </li>
              ))}
            </ul>
            <TotalsList
              totals={order.totals}
              currency={order.currency}
              showDelivery={order.fulfillmentType === 'DELIVERY'}
            />
          </section>

          <section aria-labelledby="order-customer" className="flex flex-col gap-2">
            <h3 id="order-customer" className="t-h3">
              {t('order.customer')}
            </h3>
            <p className="t-body">
              <Link to={to(`/admin/clientes/${data.customer.id}`)} className="underline underline-offset-4">
                {data.customer.name}
              </Link>
              <span className="block text-text-muted">{data.customer.email}</span>
              {order.contactPhone ? (
                <span className="block text-text-muted">{order.contactPhone}</span>
              ) : null}
            </p>
          </section>
        </div>

        <div className="flex flex-col gap-8">
          <section aria-labelledby="order-payment" className="flex flex-col gap-3">
            <h3 id="order-payment" className="t-h3">
              {t('order.payment')}
            </h3>
            <dl className="flex flex-col t-body">
              <Row label={t('order.paymentStatus')}>
                {tOrder(`confirmation.paymentStatus.${payment.status}`)}
              </Row>
              <Row label={t('order.captured')}>
                <Price amountMinor={payment.amountCapturedMinor} currency={payment.currency} />
              </Row>
              <Row label={t('order.refundedTotal')}>
                <Price amountMinor={payment.amountRefundedMinor} currency={payment.currency} />
              </Row>
            </dl>
            {payment.refunds.length > 0 ? (
              <ul className="flex flex-col gap-1 text-sm leading-5 text-text-muted">
                {payment.refunds.map((refund) => (
                  <li key={refund.id}>
                    {t('order.refundLine', {
                      date: dateTime(refund.createdAt),
                      reason: refund.reason,
                    })}{' '}
                    <Price amountMinor={refund.amountMinor} currency={payment.currency} />
                  </li>
                ))}
              </ul>
            ) : null}
            {refundable > 0 ? (
              <RefundForm data={data} refundable={refundable} onNotice={setNotice} />
            ) : (
              <p className="text-sm leading-5 text-text-muted">{t('order.nothingToRefund')}</p>
            )}
          </section>

          {data.canCancel ? <CancelForm data={data} onNotice={setNotice} /> : null}
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border py-2">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function RefundForm({
  data,
  refundable,
  onNotice,
}: {
  data: AdminOrderDetail;
  refundable: number;
  onNotice: (notice: NoticeState) => void;
}) {
  const { t } = useT('admin');
  const errorText = useErrorText();
  const client = useQueryClient();
  const currency = data.payment.currency;
  const [amount, setAmount] = useState(fromMinor(refundable, currency));
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<{ amount?: string; reason?: string }>({});
  // Una clave por intento: repetir el mismo envío (por ejemplo tras un corte) no reembolsa dos veces.
  const attempt = useRef<{ key: string; body: string } | null>(null);

  const refund = useMutation({
    mutationFn: (input: { amountMinor: number; reason: string }) => {
      const body = JSON.stringify(input);
      if (attempt.current?.body !== body) attempt.current = { key: crypto.randomUUID(), body };
      return apiSend('POST', `/api/admin/orders/${data.order.id}/payment/refunds`, input, undefined, {
        'Idempotency-Key': attempt.current.key,
      });
    },
    onSuccess: () => {
      attempt.current = null;
      setReason('');
      onNotice({ tone: 'ok', text: t('order.refundDone') });
    },
    onError: (error) => {
      onNotice({ tone: 'error', text: errorText(error) });
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ['admin', 'order', data.order.id] });
    },
  });

  function onSubmit(event: SyntheticEvent) {
    event.preventDefault();
    const amountMinor = toMinor(amount, currency);
    const next: typeof errors = {};
    if (amountMinor === null || amountMinor <= 0 || amountMinor > refundable)
      next.amount = t('order.refundAmountError');
    if (reason.trim().length < 3) next.reason = t('fields.reason');
    setErrors(next);
    if (Object.keys(next).length > 0 || amountMinor === null) return;
    onNotice(null);
    refund.mutate({ amountMinor, reason: reason.trim() });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4 border-t border-border pt-4">
      <h4 className="t-ui">{t('order.refundTitle')}</h4>
      <p className="text-sm leading-5 text-text-muted">{t('order.refundHint')}</p>
      <TextField
        id="refund-amount"
        label={t('order.refundAmount', { currency })}
        inputMode="decimal"
        value={amount}
        error={errors.amount}
        onChange={(event) => {
          setAmount(event.target.value);
        }}
      />
      <TextArea
        id="refund-reason"
        label={t('common.reason')}
        hint={t('common.reasonHint')}
        value={reason}
        error={errors.reason}
        maxLength={300}
        onChange={(event) => {
          setReason(event.target.value);
        }}
      />
      <Button type="submit" variant="danger" loading={refund.isPending}>
        {t('order.refundSubmit')}
      </Button>
    </form>
  );
}

function CancelForm({ data, onNotice }: { data: AdminOrderDetail; onNotice: (notice: NoticeState) => void }) {
  const { t } = useT('admin');
  const errorText = useErrorText();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>();
  const cancel = useMutation({
    mutationFn: () =>
      apiSend('PATCH', `/api/admin/orders/${data.order.id}/status`, {
        status: 'CANCELLED',
        version: data.version,
        reason: reason.trim(),
      }),
    onSuccess: () => {
      setOpen(false);
      onNotice({ tone: 'ok', text: t('order.cancelDone') });
    },
    onError: (failure) => {
      onNotice({ tone: 'error', text: errorText(failure) });
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ['admin', 'order', data.order.id] });
    },
  });

  if (!open) {
    return (
      <section className="flex flex-col gap-2">
        <Button
          variant="secondary"
          onClick={() => {
            setOpen(true);
          }}
        >
          {t('order.cancel')}
        </Button>
      </section>
    );
  }
  return (
    <form
      noValidate
      className="flex flex-col gap-4 border-l-4 border-danger bg-surface-raised px-4 py-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (reason.trim().length < 3) {
          setError(t('fields.reason'));
          return;
        }
        setError(undefined);
        onNotice(null);
        cancel.mutate();
      }}
    >
      <p className="t-body">
        {data.order.status === 'PENDING_CONFIRMATION' ? t('order.cancelVoid') : t('order.cancelRefund')}
      </p>
      <TextArea
        id="cancel-reason"
        label={t('common.reason')}
        value={reason}
        error={error}
        maxLength={300}
        autoFocus
        onChange={(event) => {
          setReason(event.target.value);
        }}
      />
      <div className="flex flex-wrap gap-3">
        <Button type="submit" variant="danger" loading={cancel.isPending}>
          {t('order.cancelConfirm')}
        </Button>
        <Button
          variant="text"
          onClick={() => {
            setOpen(false);
          }}
        >
          {t('common.keep')}
        </Button>
      </div>
    </form>
  );
}
