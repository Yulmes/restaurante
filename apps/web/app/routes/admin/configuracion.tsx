import {
  SERVICE_SCOPES,
  TAX_BASES,
  adminCurrencyChangeResponseSchema,
  adminSettingsResponseSchema,
  adminTaxRateResponseSchema,
  adminZoneResponseSchema,
  type AdminSettings,
  type AdminSettingsResponse,
  type AdminTaxRate,
  type AdminZone,
} from '@marea-baja/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type SyntheticEvent } from 'react';
import { apiGet, apiSend } from '../../account/api.ts';
import {
  AdminPage,
  CheckField,
  Notice,
  SelectField,
  TextArea,
  adminMeta,
  fieldErrorsOf,
  fromMinor,
  toMinor,
  useErrorText,
  useFieldMessage,
  type NoticeState,
} from '../../admin/kit.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { Price } from '../../components/ui/Price.tsx';
import { TextField } from '../../components/ui/TextField.tsx';
import { useT } from '../../i18n/use-locale.ts';
import type { Route } from './+types/configuracion';

/**
 * Admin · Configuración (M8, §6.1, §6.2, §8.4, D5, D8): operación del local, horario, umbral de
 * Turnstile, impuestos, zonas de delivery y el asistente de cambio de moneda. Cada bloque guarda por
 * separado; la configuración general usa la versión optimista (409 si otra persona la cambió).
 */
export function meta({ location }: Route.MetaArgs) {
  return adminMeta(location.pathname, 'settings');
}

const QUERY_KEY = ['admin', 'settings'] as const;

export default function AdminSettingsPage() {
  const { t } = useT('admin');
  return (
    <AdminPage section="settings" title={t('settings.title')} intro={t('settings.intro')}>
      <SettingsBody />
    </AdminPage>
  );
}

function SettingsBody() {
  const { t } = useT('admin');
  const data = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => apiGet('/api/admin/settings', adminSettingsResponseSchema),
    retry: false,
  });
  if (data.isPending) {
    return (
      <p role="status" className="t-body text-text-muted">
        {t('access.loading')}
      </p>
    );
  }
  if (!data.data) {
    return (
      <p role="alert" className="t-body text-danger">
        {t('errors.load')}
      </p>
    );
  }
  const d = data.data;
  return (
    <div className="flex flex-col gap-12">
      <GeneralForm settings={d.settings} />
      <TaxesSection rates={d.taxRates} />
      <ZonesSection zones={d.zones} currency={d.settings.currency} />
      <CurrencyWizard data={d} />
    </div>
  );
}

const DAYS = [1, 2, 3, 4, 5, 6, 0] as const;
const DAY_LABELS = {
  0: 'days.0',
  1: 'days.1',
  2: 'days.2',
  3: 'days.3',
  4: 'days.4',
  5: 'days.5',
  6: 'days.6',
} as const;
const toHHMM = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const toMinutes = (value: string) => {
  const [h, m] = value.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

function GeneralForm({ settings }: { settings: AdminSettings }) {
  const { t } = useT('admin');
  const errorText = useErrorText();
  const fieldMessage = useFieldMessage();
  const client = useQueryClient();
  const currency = settings.currency;
  const [form, setForm] = useState({
    pricesIncludeTax: settings.pricesIncludeTax,
    rounding: fromMinor(settings.roundingIncrementMinor, currency),
    minOrder: fromMinor(settings.minOrderMinor, currency),
    pickupEnabled: settings.pickupEnabled,
    deliveryEnabled: settings.deliveryEnabled,
    threshold: String(settings.turnstileGlobalThreshold),
    window: String(settings.turnstileWindowMinutes),
    hours: DAYS.map((day) => {
      const range = settings.openingHours.find((h) => h.dayOfWeek === day);
      return {
        day,
        open: range !== undefined,
        opens: range ? toHHMM(range.opensMinutes) : '11:00',
        closes: range ? toHHMM(range.closesMinutes) : '21:00',
      };
    }),
  });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<NoticeState>(null);

  const save = useMutation({
    mutationFn: (body: object) => apiSend('PUT', '/api/admin/settings', body),
    onSuccess: () => {
      setNotice({ tone: 'ok', text: t('settings.saved') });
      void client.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (error) => {
      setFields(fieldErrorsOf(error));
      setNotice({ tone: 'error', text: errorText(error) });
    },
  });

  function onSubmit(event: SyntheticEvent) {
    event.preventDefault();
    setNotice(null);
    const rounding = toMinor(form.rounding, currency);
    const minOrder = toMinor(form.minOrder, currency);
    const local: Record<string, string> = {};
    if (rounding === null || rounding <= 0) local['roundingIncrementMinor'] = 'money';
    if (minOrder === null) local['minOrderMinor'] = 'money';
    if (Object.keys(local).length > 0) {
      setFields(local);
      setNotice({ tone: 'error', text: t('errors.VALIDATION_FAILED') });
      return;
    }
    save.mutate({
      version: settings.version,
      pricesIncludeTax: form.pricesIncludeTax,
      roundingIncrementMinor: rounding,
      minOrderMinor: minOrder,
      pickupEnabled: form.pickupEnabled,
      deliveryEnabled: form.deliveryEnabled,
      turnstileGlobalThreshold: Number(form.threshold),
      turnstileWindowMinutes: Number(form.window),
      openingHours: form.hours
        .filter((h) => h.open)
        .map((h) => ({
          dayOfWeek: h.day,
          opensMinutes: toMinutes(h.opens),
          closesMinutes: toMinutes(h.closes),
        })),
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate aria-labelledby="settings-general" className="flex flex-col gap-6">
      <h2 id="settings-general" className="t-h2">
        {t('settings.general')}
      </h2>
      <Notice notice={notice} />
      <div className="flex flex-col gap-4">
        <CheckField
          id="set-pickup"
          label={t('settings.pickup')}
          checked={form.pickupEnabled}
          onChange={(checked) => {
            setForm({ ...form, pickupEnabled: checked });
          }}
        />
        <CheckField
          id="set-delivery"
          label={t('settings.delivery')}
          checked={form.deliveryEnabled}
          onChange={(checked) => {
            setForm({ ...form, deliveryEnabled: checked });
          }}
        />
        <CheckField
          id="set-tax-included"
          label={t('settings.pricesIncludeTax')}
          hint={t('settings.pricesIncludeTaxHint')}
          checked={form.pricesIncludeTax}
          onChange={(checked) => {
            setForm({ ...form, pricesIncludeTax: checked });
          }}
        />
        <div className="grid gap-4 md:grid-cols-2">
          <TextField
            id="set-min-order"
            label={t('settings.minOrder', { currency })}
            inputMode="decimal"
            value={form.minOrder}
            error={fieldMessage(fields['minOrderMinor'])}
            onChange={(event) => {
              setForm({ ...form, minOrder: event.target.value });
            }}
          />
          <TextField
            id="set-rounding"
            label={t('settings.rounding', { currency })}
            hint={t('settings.roundingHint')}
            inputMode="decimal"
            value={form.rounding}
            error={fieldMessage(fields['roundingIncrementMinor'])}
            onChange={(event) => {
              setForm({ ...form, rounding: event.target.value });
            }}
          />
        </div>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 t-h3">{t('settings.hours')}</legend>
        <p className="text-sm leading-5 text-text-muted">
          {t('settings.hoursHint', { timezone: settings.timezone })}
        </p>
        {form.hours.map((h, index) => {
          const update = (changes: Partial<typeof h>) => {
            const hours = [...form.hours];
            hours[index] = { ...h, ...changes };
            setForm({ ...form, hours });
          };
          const fieldIndex = form.hours.filter((x, i) => x.open && i < index).length;
          const error = fieldMessage(h.open ? fields[`openingHours.${String(fieldIndex)}`] : undefined);
          return (
            <div
              key={h.day}
              className="grid items-end gap-3 border-b border-border pb-3 sm:grid-cols-[10rem_8rem_8rem]"
            >
              <CheckField
                id={`hours-${String(h.day)}-open`}
                label={t(DAY_LABELS[h.day])}
                checked={h.open}
                onChange={(checked) => {
                  update({ open: checked });
                }}
              />
              <TextField
                id={`hours-${String(h.day)}-opens`}
                type="time"
                label={t('settings.opens', { day: t(DAY_LABELS[h.day]) })}
                value={h.opens}
                disabled={!h.open}
                error={error}
                onChange={(event) => {
                  update({ opens: event.target.value });
                }}
              />
              <TextField
                id={`hours-${String(h.day)}-closes`}
                type="time"
                label={t('settings.closes', { day: t(DAY_LABELS[h.day]) })}
                value={h.closes}
                disabled={!h.open}
                onChange={(event) => {
                  update({ closes: event.target.value });
                }}
              />
            </div>
          );
        })}
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 t-h3">{t('settings.turnstile')}</legend>
        <p className="text-sm leading-5 text-text-muted">{t('settings.turnstileHint')}</p>
        <div className="grid gap-4 md:grid-cols-2">
          <TextField
            id="set-threshold"
            label={t('settings.threshold')}
            inputMode="numeric"
            value={form.threshold}
            error={fieldMessage(fields['turnstileGlobalThreshold'])}
            onChange={(event) => {
              setForm({ ...form, threshold: event.target.value });
            }}
          />
          <TextField
            id="set-window"
            label={t('settings.window')}
            inputMode="numeric"
            value={form.window}
            error={fieldMessage(fields['turnstileWindowMinutes'])}
            onChange={(event) => {
              setForm({ ...form, window: event.target.value });
            }}
          />
        </div>
      </fieldset>
      <div>
        <Button type="submit" loading={save.isPending}>
          {t('settings.save')}
        </Button>
      </div>
    </form>
  );
}

function TaxesSection({ rates }: { rates: AdminTaxRate[] }) {
  const { t } = useT('admin');
  return (
    <section aria-labelledby="settings-taxes" className="flex flex-col gap-4">
      <h2 id="settings-taxes" className="t-h2">
        {t('settings.taxes')}
      </h2>
      <p className="text-sm leading-5 text-text-muted">{t('settings.taxesHint')}</p>
      {rates.map((rate) => (
        <TaxForm key={rate.id} rate={rate} />
      ))}
    </section>
  );
}

function TaxForm({ rate }: { rate: AdminTaxRate }) {
  const { t } = useT('admin');
  const errorText = useErrorText();
  const fieldMessage = useFieldMessage();
  const client = useQueryClient();
  const [form, setForm] = useState({
    name: rate.name,
    percent: (rate.rateBps / 100).toString(),
    appliesTo: rate.appliesTo,
    scopes: rate.fulfillmentTypes,
    isActive: rate.isActive,
  });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<NoticeState>(null);
  const save = useMutation({
    mutationFn: (body: object) =>
      apiSend('PUT', `/api/admin/tax-rates/${rate.id}`, body, adminTaxRateResponseSchema),
    onSuccess: () => {
      setNotice({ tone: 'ok', text: t('settings.taxSaved', { name: form.name }) });
      void client.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (error) => {
      setFields(fieldErrorsOf(error));
      setNotice({ tone: 'error', text: errorText(error) });
    },
  });
  const id = `tax-${rate.key}`;
  return (
    <form
      noValidate
      className="flex flex-col gap-4 border-t-2 border-text pt-4"
      onSubmit={(event) => {
        event.preventDefault();
        setNotice(null);
        const percent = /^\d{1,3}([.,]\d{1,2})?$/.exec(form.percent.trim());
        const rateBps = percent ? Math.round(Number(form.percent.trim().replace(',', '.')) * 100) : -1;
        save.mutate({
          name: form.name,
          rateBps,
          appliesTo: form.appliesTo,
          fulfillmentTypes: form.scopes,
          isActive: form.isActive,
        });
      }}
    >
      <Notice notice={notice} />
      <div className="grid gap-4 md:grid-cols-3">
        <TextField
          id={`${id}-name`}
          label={t('settings.taxName')}
          value={form.name}
          error={fieldMessage(fields['name'])}
          onChange={(event) => {
            setForm({ ...form, name: event.target.value });
          }}
        />
        <TextField
          id={`${id}-rate`}
          label={t('settings.taxRate')}
          inputMode="decimal"
          value={form.percent}
          error={fieldMessage(fields['rateBps'])}
          onChange={(event) => {
            setForm({ ...form, percent: event.target.value });
          }}
        />
        <SelectField
          id={`${id}-base`}
          label={t('settings.taxBase')}
          value={form.appliesTo}
          onChange={(event) => {
            setForm({ ...form, appliesTo: event.target.value as AdminTaxRate['appliesTo'] });
          }}
        >
          {TAX_BASES.map((base) => (
            <option key={base} value={base}>
              {t(`settings.bases.${base}`)}
            </option>
          ))}
        </SelectField>
      </div>
      <fieldset className="flex flex-wrap gap-x-6 gap-y-2">
        <legend className="mb-1 t-ui">{t('settings.taxScopes')}</legend>
        {SERVICE_SCOPES.map((scope) => (
          <CheckField
            key={scope}
            id={`${id}-scope-${scope}`}
            label={t(`settings.scopes.${scope}`)}
            checked={form.scopes.includes(scope)}
            onChange={(checked) => {
              setForm({
                ...form,
                scopes: checked ? [...form.scopes, scope] : form.scopes.filter((s) => s !== scope),
              });
            }}
          />
        ))}
      </fieldset>
      <CheckField
        id={`${id}-active`}
        label={t('settings.taxActive')}
        checked={form.isActive}
        onChange={(checked) => {
          setForm({ ...form, isActive: checked });
        }}
      />
      <div>
        <Button type="submit" variant="secondary" loading={save.isPending}>
          {t('settings.saveTax', { name: rate.name })}
        </Button>
      </div>
    </form>
  );
}

function ZonesSection({ zones, currency }: { zones: AdminZone[]; currency: 'CRC' | 'USD' }) {
  const { t } = useT('admin');
  return (
    <section aria-labelledby="settings-zones" className="flex flex-col gap-4">
      <h2 id="settings-zones" className="t-h2">
        {t('settings.zones')}
      </h2>
      {zones.map((zone) => (
        <ZoneForm key={zone.id} zone={zone} currency={currency} />
      ))}
    </section>
  );
}

function ZoneForm({ zone, currency }: { zone: AdminZone; currency: 'CRC' | 'USD' }) {
  const { t } = useT('admin');
  const errorText = useErrorText();
  const fieldMessage = useFieldMessage();
  const client = useQueryClient();
  const [form, setForm] = useState({
    name: zone.name,
    districts: zone.districts.join(', '),
    fee: fromMinor(zone.feeMinor, currency),
    eta: String(zone.etaMinutes),
    isActive: zone.isActive,
  });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<NoticeState>(null);
  const save = useMutation({
    mutationFn: (body: object) =>
      apiSend('PUT', `/api/admin/delivery-zones/${zone.id}`, body, adminZoneResponseSchema),
    onSuccess: () => {
      setNotice({ tone: 'ok', text: t('settings.zoneSaved', { name: form.name }) });
      void client.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (error) => {
      setFields(fieldErrorsOf(error));
      setNotice({ tone: 'error', text: errorText(error) });
    },
  });
  const id = `zone-${zone.key}`;
  return (
    <form
      noValidate
      className="flex flex-col gap-4 border-t-2 border-text pt-4"
      onSubmit={(event) => {
        event.preventDefault();
        setNotice(null);
        const fee = toMinor(form.fee, currency);
        if (fee === null) {
          setFields({ feeMinor: 'money' });
          return;
        }
        save.mutate({
          name: form.name,
          districts: form.districts
            .split(',')
            .map((d) => d.trim())
            .filter(Boolean),
          feeMinor: fee,
          etaMinutes: Number(form.eta),
          isActive: form.isActive,
        });
      }}
    >
      <Notice notice={notice} />
      <div className="grid gap-4 md:grid-cols-3">
        <TextField
          id={`${id}-name`}
          label={t('settings.zoneName')}
          value={form.name}
          error={fieldMessage(fields['name'])}
          onChange={(event) => {
            setForm({ ...form, name: event.target.value });
          }}
        />
        <TextField
          id={`${id}-fee`}
          label={t('settings.zoneFee', { currency })}
          inputMode="decimal"
          value={form.fee}
          error={fieldMessage(fields['feeMinor'])}
          onChange={(event) => {
            setForm({ ...form, fee: event.target.value });
          }}
        />
        <TextField
          id={`${id}-eta`}
          label={t('settings.zoneEta')}
          inputMode="numeric"
          value={form.eta}
          error={fieldMessage(fields['etaMinutes'])}
          onChange={(event) => {
            setForm({ ...form, eta: event.target.value });
          }}
        />
      </div>
      <TextArea
        id={`${id}-districts`}
        label={t('settings.zoneDistricts')}
        hint={t('settings.zoneDistrictsHint')}
        value={form.districts}
        error={fieldMessage(fields['districts'])}
        onChange={(event) => {
          setForm({ ...form, districts: event.target.value });
        }}
      />
      <CheckField
        id={`${id}-active`}
        label={t('settings.zoneActive')}
        checked={form.isActive}
        onChange={(checked) => {
          setForm({ ...form, isActive: checked });
        }}
      />
      <div>
        <Button type="submit" variant="secondary" loading={save.isPending}>
          {t('settings.saveZone', { name: zone.name })}
        </Button>
      </div>
    </form>
  );
}

function CurrencyWizard({ data }: { data: AdminSettingsResponse }) {
  const { t } = useT('admin');
  const errorText = useErrorText();
  const fieldMessage = useFieldMessage();
  const client = useQueryClient();
  const current = data.settings.currency;
  const target = current === 'CRC' ? 'USD' : 'CRC';
  const [rate, setRate] = useState('');
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<NoticeState>(null);
  const blocked = data.activeOrders > 0;
  const change = useMutation({
    mutationFn: () =>
      apiSend(
        'POST',
        '/api/admin/settings/currency',
        { version: data.settings.version, currency: target, crcPerUsd: rate.trim(), reason: reason.trim() },
        adminCurrencyChangeResponseSchema,
      ),
    onSuccess: (result) => {
      setConfirming(false);
      setNotice({
        tone: 'ok',
        text: t('currency.done', {
          currency: target,
          products: result?.converted.products ?? 0,
          zones: result?.converted.zones ?? 0,
        }),
      });
      void client.invalidateQueries({ queryKey: QUERY_KEY });
      void client.invalidateQueries({ queryKey: ['admin', 'menu'] });
    },
    onError: (error) => {
      setConfirming(false);
      setFields(fieldErrorsOf(error));
      setNotice({ tone: 'error', text: errorText(error) });
    },
  });
  return (
    <section aria-labelledby="settings-currency" className="flex flex-col gap-4">
      <h2 id="settings-currency" className="t-h2">
        {t('currency.title')}
      </h2>
      <p className="t-body">{t('currency.current', { currency: current })}</p>
      <p className="text-sm leading-5 text-text-muted">{t('currency.hint')}</p>
      <Notice notice={notice} />
      {blocked ? (
        <p role="status" className="border-l-4 border-border-strong bg-surface-raised px-4 py-3 t-body">
          {t('currency.blocked', { n: data.activeOrders })}
        </p>
      ) : (
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setNotice(null);
            const local: Record<string, string> = {};
            if (!/^\d{1,6}([.]\d{1,2})?$/.test(rate.trim()) || Number(rate) < 1)
              local['crcPerUsd'] = 'invalid';
            if (reason.trim().length < 3) local['reason'] = 'required';
            setFields(local);
            if (Object.keys(local).length > 0) return;
            setConfirming(true);
          }}
        >
          <TextField
            id="currency-rate"
            label={t('currency.rate')}
            hint={t('currency.rateHint')}
            inputMode="decimal"
            value={rate}
            error={fieldMessage(fields['crcPerUsd'])}
            onChange={(event) => {
              setRate(event.target.value);
              setConfirming(false);
            }}
          />
          <TextArea
            id="currency-reason"
            label={t('common.reason')}
            value={reason}
            error={fieldMessage(fields['reason'])}
            maxLength={300}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
          {confirming ? (
            <div
              className="flex flex-col gap-3 border-l-4 border-danger bg-surface-raised px-4 py-4"
              role="group"
              aria-labelledby="currency-confirm"
            >
              <p id="currency-confirm" className="t-body">
                {t('currency.confirm', { from: current, to: target, rate: rate.trim() })}
              </p>
              <p className="text-sm leading-5 text-text-muted">
                {t('currency.example')} <Price amountMinor={890000} currency="CRC" /> →{' '}
                <Price amountMinor={Math.round((8900 / Number(rate || 1)) * 100)} currency="USD" />
              </p>
              <div className="flex flex-wrap gap-3">
                <Button
                  variant="danger"
                  loading={change.isPending}
                  onClick={() => {
                    change.mutate();
                  }}
                >
                  {t('currency.apply', { currency: target })}
                </Button>
                <Button
                  variant="text"
                  onClick={() => {
                    setConfirming(false);
                  }}
                >
                  {t('common.keep')}
                </Button>
              </div>
            </div>
          ) : (
            <div>
              <Button type="submit" variant="secondary">
                {t('currency.review', { currency: target })}
              </Button>
            </div>
          )}
        </form>
      )}
    </section>
  );
}
