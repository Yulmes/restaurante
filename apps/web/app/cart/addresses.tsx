import { zodResolver } from '@hookform/resolvers/zod';
import {
  addressInputSchema,
  addressResponseSchema,
  addressesResponseSchema,
  deliveryZonesResponseSchema,
  type Address,
  type AddressInput,
} from '@marea-baja/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useForm } from 'react-hook-form';
import { ApiError, NetworkError, apiGet, apiSend } from '../account/api.ts';
import { ErrorIcon } from '../components/ui/ErrorIcon.tsx';
import { Button } from '../components/ui/Button.tsx';
import { ErrorSummary } from '../components/ui/ErrorSummary.tsx';
import { TextField } from '../components/ui/TextField.tsx';
import { useT } from '../i18n/use-locale.ts';

/**
 * Direcciones del cliente (R-AUTH-01, M5). El distrito se elige de los que cubren las zonas de
 * delivery activas: la API vuelve a comprobarlo y calcula la zona y la tarifa.
 */
export const ADDRESSES_KEY = ['account', 'addresses'] as const;

export function useAddresses(enabled = true) {
  return useQuery({
    queryKey: ADDRESSES_KEY,
    queryFn: async () => (await apiGet('/api/account/addresses', addressesResponseSchema)).addresses,
    enabled,
    staleTime: 30_000,
  });
}

export function useDeliveryZones() {
  return useQuery({
    queryKey: ['delivery-zones'],
    queryFn: () => apiGet('/api/public/delivery-zones', deliveryZonesResponseSchema),
    staleTime: 5 * 60_000,
  });
}

const FIELDS = ['label', 'line1', 'line2', 'district', 'canton', 'province', 'reference'] as const;
type Field = (typeof FIELDS)[number];
const KNOWN = ['required', 'tooLong', 'districtNotCovered', 'tooMany'] as const;

export function AddressForm({
  idPrefix,
  onSaved,
  onCancel,
}: {
  idPrefix: string;
  onSaved: (address: Address) => void;
  onCancel?: () => void;
}) {
  const { t } = useT('order');
  const { t: ta } = useT('account');
  const client = useQueryClient();
  const zones = useDeliveryZones();
  const districtHint = useId();
  const [attempt, setAttempt] = useState(0);
  const [general, setGeneral] = useState<string | null>(null);
  const form = useForm<AddressInput>({
    resolver: zodResolver(addressInputSchema),
    // Se valida al guardar, no al salir de cada campo (D3 de la revisión de M5): si el aviso de
    // error desaparecía con el blur que provoca el propio clic en "Guardar la dirección", el botón
    // subía antes de soltar el mouse y ese primer clic se perdía. Las reglas no cambian.
    mode: 'onSubmit',
    reValidateMode: 'onSubmit',
    shouldFocusError: false,
    defaultValues: {
      label: '',
      line1: '',
      line2: '',
      district: '',
      canton: '',
      province: '',
      reference: '',
      isDefault: false,
    },
  });
  const { errors } = form.formState;
  const message = (code: string | undefined) =>
    t(`addresses.fieldErrors.${KNOWN.find((k) => k === code) ?? 'invalid'}`);

  const save = useMutation({
    mutationFn: (values: AddressInput) =>
      apiSend('POST', '/api/account/addresses', values, addressResponseSchema),
    onSuccess: (response) => {
      if (!response) return;
      void client.invalidateQueries({ queryKey: ADDRESSES_KEY });
      form.reset();
      onSaved(response.address);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'VALIDATION_FAILED') {
        for (const field of [...FIELDS]) {
          const code = error.fields[field];
          if (code) form.setError(field, { type: 'server', message: code });
        }
        if (error.fields['label'] === 'tooMany') setGeneral(message('tooMany'));
      } else {
        setGeneral(error instanceof NetworkError ? ta('errors.network') : ta('errors.generic'));
      }
      setAttempt((n) => n + 1);
    },
  });
  const onSubmit = form.handleSubmit(
    (values) => {
      setGeneral(null);
      save.mutate(values);
    },
    () => {
      setAttempt((n) => n + 1);
    },
  );

  const districts = [...new Set((zones.data?.zones ?? []).flatMap((z) => z.districts))].sort((a, b) =>
    a.localeCompare(b, 'es'),
  );
  const summary = FIELDS.flatMap((field: Field) => {
    const code = errors[field]?.message;
    return typeof code === 'string'
      ? [{ fieldId: `${idPrefix}-${field}`, message: `${t(`addresses.${field}`)}: ${message(code)}` }]
      : [];
  });
  if (general) summary.unshift({ fieldId: `${idPrefix}-label`, message: general });
  const fieldError = (field: Field) => {
    const code = errors[field]?.message;
    return typeof code === 'string' ? message(code) : undefined;
  };
  const districtError = fieldError('district');

  return (
    <div className="flex flex-col gap-4">
      {summary.length > 0 ? (
        <ErrorSummary key={attempt} errors={summary} focusOnMount={attempt > 0} headingLevel={3} />
      ) : null}
      {/* Un formulario propio dentro del checkout: no envía el del pedido. */}
      <div role="group" aria-label={t('checkout.addAddress')} className="flex flex-col gap-5">
        <TextField
          id={`${idPrefix}-label`}
          label={t('addresses.label')}
          hint={t('addresses.labelHint')}
          error={fieldError('label')}
          {...form.register('label')}
        />
        <TextField
          id={`${idPrefix}-line1`}
          label={t('addresses.line1')}
          autoComplete="address-line1"
          error={fieldError('line1')}
          {...form.register('line1')}
        />
        <TextField
          id={`${idPrefix}-line2`}
          label={t('addresses.line2')}
          autoComplete="address-line2"
          error={fieldError('line2')}
          {...form.register('line2')}
        />
        <div className="flex max-w-[26rem] flex-col gap-1.5">
          <label htmlFor={`${idPrefix}-district`} className="t-ui text-text">
            {t('addresses.district')}
          </label>
          <span id={districtHint} className="text-sm leading-5 text-text-muted">
            {t('addresses.intro')}
          </span>
          <select
            id={`${idPrefix}-district`}
            aria-describedby={[districtHint, districtError ? `${idPrefix}-district-error` : null]
              .filter(Boolean)
              .join(' ')}
            aria-invalid={districtError ? true : undefined}
            className={`h-12 rounded-[var(--radius-control)] border bg-surface-raised px-3 text-base text-text hover:border-border-strong focus-visible:border-text ${districtError ? 'border-danger' : 'border-border'}`}
            {...form.register('district')}
          >
            <option value="">{t('addresses.districtPlaceholder')}</option>
            {districts.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          {districtError ? (
            <span
              id={`${idPrefix}-district-error`}
              className="flex items-start gap-1.5 text-sm leading-5 text-danger"
            >
              <ErrorIcon />
              {districtError}
            </span>
          ) : null}
        </div>
        <TextField
          id={`${idPrefix}-canton`}
          label={t('addresses.canton')}
          error={fieldError('canton')}
          {...form.register('canton')}
        />
        <TextField
          id={`${idPrefix}-province`}
          label={t('addresses.province')}
          error={fieldError('province')}
          {...form.register('province')}
        />
        <TextField
          id={`${idPrefix}-reference`}
          label={t('addresses.reference')}
          hint={t('addresses.referenceHint')}
          error={fieldError('reference')}
          {...form.register('reference')}
        />
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 t-body">
          <input type="checkbox" className="size-5 accent-tinta" {...form.register('isDefault')} />
          {t('addresses.isDefault')}
        </label>
        <div className="flex flex-wrap items-center gap-4">
          <Button
            type="button"
            variant="secondary"
            loading={save.isPending}
            onClick={() => {
              void onSubmit();
            }}
          >
            {t('addresses.save')}
          </Button>
          {onCancel ? (
            <Button type="button" variant="text" onClick={onCancel}>
              {t('addresses.cancel')}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Sección "Direcciones" del perfil: lista, alta y baja. */
export function AddressesSection() {
  const { t } = useT('order');
  const client = useQueryClient();
  const addresses = useAddresses();
  const [adding, setAdding] = useState(false);
  const [saved, setSaved] = useState(false);
  const remove = useMutation({
    mutationFn: (id: string) => apiSend('DELETE', `/api/account/addresses/${id}`, {}),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ADDRESSES_KEY });
    },
  });
  return (
    <section aria-labelledby="addresses-title" className="flex flex-col gap-4 border-t border-border pt-6">
      <h2 id="addresses-title" className="t-h2">
        {t('addresses.title')}
      </h2>
      <p className="t-body text-text-muted">{t('addresses.intro')}</p>
      {addresses.isError ? (
        <p role="alert" className="t-body text-danger">
          {t('addresses.loadError')}
        </p>
      ) : null}
      {addresses.data?.length === 0 ? <p className="t-body">{t('addresses.empty')}</p> : null}
      {addresses.data && addresses.data.length > 0 ? (
        <ul className="flex flex-col">
          {addresses.data.map((address) => (
            <li
              key={address.id}
              className="flex flex-wrap items-start justify-between gap-3 border-b border-border py-3"
            >
              <div className="flex flex-col">
                <span className="t-ui">
                  {address.label}
                  {address.isDefault ? (
                    <span className="text-text-muted">{` · ${t('addresses.default')}`}</span>
                  ) : null}
                </span>
                <span className="t-body">
                  {[address.line1, address.line2, address.district, address.canton, address.province]
                    .filter(Boolean)
                    .join(', ')}
                </span>
                <span className="text-sm text-text-muted">{address.reference}</span>
              </div>
              <Button
                variant="text"
                loading={remove.isPending && remove.variables === address.id}
                aria-label={t('addresses.deleteLabel', { label: address.label })}
                onClick={() => {
                  remove.mutate(address.id);
                }}
              >
                {t('addresses.delete')}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {adding ? (
        <AddressForm
          idPrefix="profile-address"
          onSaved={() => {
            setAdding(false);
            setSaved(true);
          }}
          onCancel={() => {
            setAdding(false);
          }}
        />
      ) : (
        <div className="flex flex-col items-start gap-3">
          <Button
            variant="secondary"
            onClick={() => {
              setAdding(true);
              setSaved(false);
            }}
          >
            {t('checkout.addAddress')}
          </Button>
          {saved ? (
            <p role="status" className="t-body">
              {t('addresses.saved')}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
