import {
  DEMO_SCENARIOS,
  orderSchema,
  type DemoScenario,
  type Order,
  type PaymentMethod,
} from '@marea-baja/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { z } from 'zod';
import { ApiError, NetworkError, apiSend } from '../account/api.ts';
import { useT } from '../i18n/use-locale.ts';

/**
 * Pago demo (M6, §7.4): forma de pago (tarjeta demo o al recibir/retirar, D-M6-1) y, con la
 * tarjeta, el selector de escenarios. **No hay campos de tarjeta**: la tarjeta "DEMO •••• 0000" es
 * solo una ilustración y nunca se pide ni se guarda ningún dato. El escenario es una entrada que la
 * API valida; monto, estado e idempotencia los decide el servidor.
 */
export interface PaymentSelection {
  method: PaymentMethod;
  scenario: DemoScenario;
}

const responseSchema = z.object({ order: orderSchema });

export function PaymentChoice({
  idPrefix,
  methods,
  value,
  onChange,
}: {
  idPrefix: string;
  methods: readonly PaymentMethod[];
  value: PaymentSelection;
  onChange: (value: PaymentSelection) => void;
}) {
  const { t } = useT('order');
  return (
    <div className="flex flex-col gap-5">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 t-ui">{t('checkout.methodLegend')}</legend>
        {methods.map((method) => (
          <label
            key={method}
            className="flex min-h-12 cursor-pointer items-start gap-3 border-b border-border py-3"
          >
            <input
              type="radio"
              name={`${idPrefix}-method`}
              value={method}
              checked={value.method === method}
              onChange={() => {
                onChange({ ...value, method });
              }}
              className="mt-1 size-5 shrink-0 accent-tinta"
            />
            <span className="flex flex-col">
              <span className="t-ui">{t(`checkout.method.${method}`)}</span>
              <span className="text-sm leading-5 text-text-muted">{t(`checkout.methodHint.${method}`)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {!methods.includes('DEMO_CARD') ? (
        <p className="text-sm leading-5 text-text-muted">{t('checkout.cardDisabled')}</p>
      ) : null}
      {value.method === 'DEMO_CARD' && methods.includes('DEMO_CARD') ? (
        <>
          <div
            role="img"
            aria-label={`${t('checkout.demoCard')}: ${t('checkout.demoCardNumber')}`}
            className="flex w-full max-w-[18rem] flex-col gap-6 rounded-[var(--radius-control)] border border-border-strong bg-surface-raised px-4 py-3"
          >
            <span className="text-sm leading-5 text-text-muted">{t('checkout.demoCard')}</span>
            <span className="t-ui tabular-nums" translate="no">
              {t('checkout.demoCardNumber')}
            </span>
          </div>
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-2 t-ui">{t('checkout.scenarioLegend')}</legend>
            {DEMO_SCENARIOS.map((scenario) => (
              <label
                key={scenario}
                className="flex min-h-11 cursor-pointer items-start gap-3 border-b border-border py-2.5"
              >
                <input
                  type="radio"
                  name={`${idPrefix}-scenario`}
                  value={scenario}
                  checked={value.scenario === scenario}
                  onChange={() => {
                    onChange({ ...value, scenario });
                  }}
                  className="mt-1 size-5 shrink-0 accent-tinta"
                />
                <span className="flex flex-col">
                  <span className="t-ui">{t(`checkout.scenario.${scenario}`)}</span>
                  <span className="text-sm leading-5 text-text-muted">
                    {t(`checkout.scenarioHint.${scenario}`)}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
        </>
      ) : null}
    </div>
  );
}

type PayErrorKey = `confirmation.payErrors.${
  'network' | 'inProgress' | 'notAllowed' | 'expired' | 'rateLimited' | 'disabled' | 'generic'}`;

/** Mensaje para el cliente a partir del error de pagar. */
export function payErrorKey(error: unknown): PayErrorKey {
  if (error instanceof NetworkError) return 'confirmation.payErrors.network';
  if (!(error instanceof ApiError)) return 'confirmation.payErrors.generic';
  switch (error.code) {
    case 'PAYMENT_IN_PROGRESS':
    case 'IDEMPOTENCY_IN_PROGRESS':
      return 'confirmation.payErrors.inProgress';
    case 'PAYMENT_NOT_ALLOWED':
      return 'confirmation.payErrors.notAllowed';
    case 'ORDER_EXPIRED':
      return 'confirmation.payErrors.expired';
    case 'RATE_LIMITED':
      return 'confirmation.payErrors.rateLimited';
    case 'DEMO_PAYMENTS_DISABLED':
      return 'confirmation.payErrors.disabled';
    default:
      return 'confirmation.payErrors.generic';
  }
}

/**
 * Paga un pedido. Con la tarjeta demo, una `Idempotency-Key` por intento: repetir el mismo intento
 * (red caída) reusa la clave; otro escenario es un intento nuevo (§7.3, punto 1). Contra entrega es
 * idempotente en la API y no necesita clave.
 */
export function usePayOrder() {
  const client = useQueryClient();
  const attempt = useRef<{ signature: string; key: string } | null>(null);
  return useMutation({
    mutationFn: async ({ orderId, selection }: { orderId: string; selection: PaymentSelection }) => {
      if (selection.method === 'CASH_ON_DELIVERY') {
        return apiSend('POST', `/api/orders/${orderId}/payments/cash-on-delivery`, {}, responseSchema);
      }
      const signature = `${orderId}:${selection.scenario}`;
      if (attempt.current?.signature !== signature) {
        attempt.current = { signature, key: crypto.randomUUID() };
      }
      return apiSend(
        'POST',
        `/api/orders/${orderId}/payments/authorize`,
        { scenario: selection.scenario },
        responseSchema,
        { 'Idempotency-Key': attempt.current.key },
      );
    },
    onSuccess: (response) => {
      // Respondido el intento, el próximo es otro (aunque repita el escenario).
      attempt.current = null;
      if (response) client.setQueryData<Order>(['order', response.order.id], response.order);
    },
  });
}
