import {
  checkoutQuoteSchema,
  formatMoney,
  orderResponseSchema,
  phoneSchema,
  type CheckoutQuote,
  type FulfillmentType,
  type PublicUser,
} from '@marea-baja/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { ApiError, NetworkError, apiSend } from '../../account/api.ts';
import { useSessionUser } from '../../account/session.ts';
import { AddressForm, useAddresses } from '../../cart/addresses.tsx';
import { PaymentChoice, usePayOrder, type PaymentSelection } from '../../cart/payment.tsx';
import { orderMeta, OrderShell, TotalsList } from '../../cart/OrderShell.tsx';
import { Button, buttonClassName } from '../../components/ui/Button.tsx';
import { Price } from '../../components/ui/Price.tsx';
import { TextField } from '../../components/ui/TextField.tsx';
import { pathForLocale } from '../../i18n/locale.ts';
import { useLocale, useT } from '../../i18n/use-locale.ts';
import type { Route } from './+types/finalizar';

export function meta({ location }: Route.MetaArgs) {
  return orderMeta(location.pathname, 'checkout.metaTitle');
}

/**
 * Checkout de 3 pasos (§3.8, D3, D4): Entrega → Datos → Pago. Confirmar exige una cuenta con el
 * correo verificado; el carrito se conserva mientras tanto. Todo importe viene de la API: la
 * pantalla muestra la cotización y la confirma con su huella (`quoteVersion`, D-M5-2).
 *
 * M6 (§7.3): al confirmar se crea el pedido y enseguida se paga con la forma elegida (tarjeta demo
 * con un escenario, o al recibir/retirar). La confirmación muestra el resultado del pago y, si la
 * tarjeta demo se rechazó, permite reintentar mientras el pedido sigue reservado.
 */
export default function Finalizar() {
  const { t } = useT('order');
  const { t: tc } = useT();
  const locale = useLocale();
  const { pathname } = useLocation();
  const me = useSessionUser();

  if (me.isPending) {
    return (
      <OrderShell title={t('checkout.title')}>
        <p role="status" className="t-body text-text-muted">
          {tc('loading')}
        </p>
      </OrderShell>
    );
  }
  if (!me.data) {
    const next = encodeURIComponent(pathname);
    return (
      <OrderShell title={t('checkout.title')}>
        <Gate title={t('checkout.signInTitle')} body={t('checkout.signInBody')}>
          <Link
            to={`${pathForLocale('/cuenta/ingresar', locale)}?next=${next}`}
            className={buttonClassName('primary')}
          >
            {t('checkout.signIn')}
          </Link>
          <Link to={pathForLocale('/cuenta/registro', locale)} className={buttonClassName('secondary')}>
            {t('checkout.register')}
          </Link>
        </Gate>
      </OrderShell>
    );
  }
  if (!me.data.emailVerified) {
    return (
      <OrderShell title={t('checkout.title')}>
        <Gate title={t('checkout.verifyTitle')} body={t('checkout.verifyBody')}>
          <Link to={pathForLocale('/cuenta/verificar', locale)} className={buttonClassName('primary')}>
            {t('checkout.verify')}
          </Link>
        </Gate>
      </OrderShell>
    );
  }
  return <Checkout user={me.data} />;
}

function Gate({ title, body, children }: { title: string; body: string; children: ReactNode }) {
  return (
    <section className="flex max-w-xl flex-col gap-4 border-t border-border pt-6">
      <h2 className="t-h2">{title}</h2>
      <p className="t-body text-text-muted">{body}</p>
      <div className="flex flex-wrap gap-3">{children}</div>
    </section>
  );
}

type Step = 1 | 2 | 3;
const quoteKey = (locale: string, fulfillment: FulfillmentType, addressId: string | null) =>
  ['checkout-quote', locale, fulfillment, addressId] as const;

function Checkout({ user }: { user: PublicUser }) {
  const { t } = useT('order');
  const locale = useLocale();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [step, setStep] = useState<Step>(1);
  const [fulfillment, setFulfillment] = useState<FulfillmentType>('PICKUP');
  const addresses = useAddresses();
  const [chosenAddress, setChosenAddress] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [phone, setPhone] = useState(user.phone ?? '');
  const [note, setNote] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [selection, setSelection] = useState<PaymentSelection>({ method: 'DEMO_CARD', scenario: 'APPROVED' });
  const pay = usePayOrder();
  const attempt = useRef<{ signature: string; key: string } | null>(null);
  const bannerRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const addressId =
    fulfillment === 'DELIVERY'
      ? (chosenAddress ?? addresses.data?.find((a) => a.isDefault)?.id ?? addresses.data?.[0]?.id ?? null)
      : null;

  const quote = useQuery({
    queryKey: quoteKey(locale, fulfillment, addressId),
    queryFn: async () => {
      const res = await apiSend(
        'POST',
        '/api/checkout/quote',
        { locale, fulfillmentType: fulfillment, addressId },
        checkoutQuoteSchema,
      );
      if (!res) throw new Error('Sin respuesta');
      return res;
    },
    placeholderData: keepPreviousData,
    staleTime: 0,
  });

  useEffect(() => {
    if (banner) bannerRef.current?.focus();
  }, [banner]);

  const goTo = (next: Step) => {
    setStep(next);
    // Al llegar al pago se vuelve a cotizar: lo que se confirma es lo vigente.
    if (next === 3) void quote.refetch();
    requestAnimationFrame(() => headingRef.current?.focus());
  };

  const place = useMutation({
    mutationFn: async (q: CheckoutQuote) => {
      const body = {
        locale,
        fulfillmentType: fulfillment,
        addressId,
        contactPhone: phone.trim() === '' ? null : phone.trim(),
        customerNote: note.trim() === '' ? null : note.trim(),
        quoteVersion: q.quoteVersion,
      };
      // Una clave por intento: un reintento del mismo intento (red caída) reusa la clave; un cuerpo
      // distinto (otra cotización, otro dato) es un intento nuevo (§7.3, punto 1).
      const signature = JSON.stringify(body);
      if (attempt.current?.signature !== signature) {
        attempt.current = { signature, key: crypto.randomUUID() };
      }
      return apiSend('POST', '/api/orders', body, orderResponseSchema, {
        'Idempotency-Key': attempt.current.key,
      });
    },
    onSuccess: async (response) => {
      if (!response) return;
      attempt.current = null;
      client.setQueryData(['order', response.order.id], response.order);
      void client.invalidateQueries({ queryKey: ['cart'] });
      if (response.order.payment.availableMethods.length > 0) {
        // Si el pago falla, la confirmación muestra el estado y permite reintentar.
        await pay
          .mutateAsync({ orderId: response.order.id, selection: paymentSelection })
          .catch(() => undefined);
      }
      void navigate(pathForLocale(`/pedido/confirmacion/${response.order.id}`, locale));
    },
    onError: (error) => {
      if (error instanceof NetworkError) {
        setBanner(t('checkout.errors.network'));
        return;
      }
      if (!(error instanceof ApiError)) {
        setBanner(t('checkout.errors.generic'));
        return;
      }
      switch (error.code) {
        case 'PRICE_CHANGED': {
          const fresh = checkoutQuoteSchema.safeParse(error.details['quote']);
          if (fresh.success) client.setQueryData(quoteKey(locale, fulfillment, addressId), fresh.data);
          else void quote.refetch();
          setBanner(t('checkout.priceChanged'));
          return;
        }
        case 'ITEMS_UNAVAILABLE':
          void quote.refetch();
          setBanner(t('checkout.itemsUnavailable'));
          return;
        case 'IDEMPOTENCY_IN_PROGRESS':
          setBanner(t('checkout.errors.inProgress'));
          return;
        case 'RATE_LIMITED':
          setBanner(t('checkout.errors.rateLimited'));
          return;
        case 'VALIDATION_FAILED':
          if (error.fields['contactPhone']) {
            setPhoneError(t('checkout.phoneHintDelivery'));
            goTo(2);
          }
          setBanner(t('checkout.errors.invalid'));
          return;
        default:
          // Carrito vacío, mínimo, horario, zona…: la cotización nueva muestra el motivo.
          void quote.refetch();
          setBanner(t('checkout.errors.generic'));
      }
    },
  });

  const q = quote.data;
  const currency = q?.cart.currency ?? 'CRC';
  const selected = addresses.data?.find((a) => a.id === addressId);
  const deliveryReady = fulfillment === 'PICKUP' || !!selected?.deliveryZone;
  const enabled = (type: FulfillmentType) =>
    q ? (type === 'PICKUP' ? q.pickupEnabled : q.deliveryEnabled) : true;

  const validatePhone = (): boolean => {
    const parsed = phoneSchema.safeParse(phone);
    if (!parsed.success) {
      setPhoneError(t('addresses.fieldErrors.invalid'));
      return false;
    }
    if (fulfillment === 'DELIVERY' && !parsed.data) {
      setPhoneError(t('checkout.phoneHintDelivery'));
      return false;
    }
    setPhoneError(null);
    return true;
  };

  const total = q ? formatMoney(q.totals.totalMinor, currency, locale) : '';
  const methods = q?.paymentMethods ?? [];
  // Si la tarjeta demo no está habilitada en la API, queda la única forma disponible.
  const paymentSelection: PaymentSelection =
    methods.includes(selection.method) || methods.length === 0
      ? selection
      : { ...selection, method: methods[0] ?? 'CASH_ON_DELIVERY' };
  const busy = place.isPending || pay.isPending;

  return (
    <OrderShell title={t('checkout.title')}>
      {/* Celular: el resumen se pliega con el total siempre a la vista (§3.8). */}
      <div className="lg:hidden">
        <button
          type="button"
          aria-expanded={summaryOpen}
          aria-controls="checkout-summary"
          onClick={() => {
            setSummaryOpen((open) => !open);
          }}
          className="inline-flex min-h-11 items-center border-b border-text t-ui"
        >
          {summaryOpen ? t('checkout.hideSummary') : t('checkout.showSummary', { total })}
        </button>
      </div>
      {banner ? (
        <div
          ref={bannerRef}
          tabIndex={-1}
          role="alert"
          className="max-w-2xl border border-l-4 border-danger bg-surface-raised px-4 py-3.5 t-body"
        >
          {banner}
        </div>
      ) : null}
      <div className="grid gap-10 lg:grid-cols-12">
        <ol aria-label={t('checkout.stepsLabel')} className="flex flex-col lg:col-span-7">
          <StepSection
            number={1}
            current={step}
            title={t('checkout.delivery')}
            headingRef={step === 1 ? headingRef : undefined}
            summary={
              fulfillment === 'PICKUP'
                ? t('checkout.pickupSummary')
                : selected
                  ? `${t('checkout.deliveryOption')} · ${selected.label}`
                  : t('checkout.deliveryOption')
            }
            onChange={() => {
              goTo(1);
            }}
          >
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 t-ui">{t('checkout.fulfillmentLegend')}</legend>
              {(['PICKUP', 'DELIVERY'] as const).map((type) => (
                <label
                  key={type}
                  className={`flex min-h-12 cursor-pointer items-start gap-3 border-b border-border py-3 ${enabled(type) ? '' : 'cursor-not-allowed opacity-45'}`}
                >
                  <input
                    type="radio"
                    name="fulfillment"
                    value={type}
                    checked={fulfillment === type}
                    disabled={!enabled(type)}
                    onChange={() => {
                      setFulfillment(type);
                      setBanner(null);
                    }}
                    className="mt-1 size-5 accent-tinta"
                  />
                  <span className="flex flex-col">
                    <span className="t-ui">
                      {type === 'PICKUP' ? t('checkout.pickup') : t('checkout.deliveryOption')}
                    </span>
                    <span className="text-sm leading-5 text-text-muted">
                      {enabled(type)
                        ? type === 'PICKUP'
                          ? t('checkout.pickupHint')
                          : t('checkout.deliveryHint')
                        : t('checkout.notEnabled')}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
            {fulfillment === 'DELIVERY' ? (
              <div className="flex flex-col gap-4">
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-2 t-ui">{t('checkout.addressLegend')}</legend>
                  {addresses.data?.length === 0 ? (
                    <p className="t-body text-text-muted">{t('checkout.noAddresses')}</p>
                  ) : null}
                  {addresses.data?.map((address) => (
                    <label
                      key={address.id}
                      className="flex min-h-12 cursor-pointer items-start gap-3 border-b border-border py-3"
                    >
                      <input
                        type="radio"
                        name="address"
                        value={address.id}
                        checked={addressId === address.id}
                        onChange={() => {
                          setChosenAddress(address.id);
                          setBanner(null);
                        }}
                        className="mt-1 size-5 accent-tinta"
                      />
                      <span className="flex flex-col">
                        <span className="t-ui">{address.label}</span>
                        <span className="t-body">
                          {[address.line1, address.line2, address.district].filter(Boolean).join(', ')}
                        </span>
                        <span className="text-sm leading-5 text-text-muted">
                          {address.deliveryZone
                            ? t('checkout.zone', {
                                zone: address.deliveryZone.name,
                                fee: formatMoney(address.deliveryZone.feeMinor, currency, locale),
                                minutes: address.deliveryZone.etaMinutes,
                              })
                            : t('checkout.outsideZone')}
                        </span>
                      </span>
                    </label>
                  ))}
                </fieldset>
                {adding ? (
                  <AddressForm
                    idPrefix="checkout-address"
                    onSaved={(address) => {
                      setChosenAddress(address.id);
                      setAdding(false);
                    }}
                    onCancel={() => {
                      setAdding(false);
                    }}
                  />
                ) : (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setAdding(true);
                    }}
                  >
                    {t('checkout.addAddress')}
                  </Button>
                )}
              </div>
            ) : null}
            <Problems
              quote={q}
              only={['FULFILLMENT_UNAVAILABLE', 'ADDRESS_REQUIRED', 'DELIVERY_ZONE_UNAVAILABLE']}
            />
            <Button
              {...(!enabled(fulfillment)
                ? { disabledReason: t('checkout.notEnabled') }
                : deliveryReady
                  ? {}
                  : {
                      disabledReason: selected
                        ? t('checkout.problems.DELIVERY_ZONE_UNAVAILABLE')
                        : t('checkout.problems.ADDRESS_REQUIRED'),
                    })}
              onClick={() => {
                goTo(2);
              }}
            >
              {t('checkout.continue')}
            </Button>
          </StepSection>

          <StepSection
            number={2}
            current={step}
            title={t('checkout.details')}
            headingRef={step === 2 ? headingRef : undefined}
            summary={[user.name, phone.trim()].filter(Boolean).join(' · ')}
            onChange={() => {
              goTo(2);
            }}
          >
            <dl className="flex flex-col gap-1 t-body">
              <div className="flex gap-2">
                <dt className="t-ui">{t('checkout.name')}:</dt>
                <dd>{user.name}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="t-ui">{t('checkout.email')}:</dt>
                <dd>{user.email}</dd>
              </div>
            </dl>
            <TextField
              id="checkout-phone"
              label={t('checkout.phone')}
              hint={
                fulfillment === 'DELIVERY' ? t('checkout.phoneHintDelivery') : t('checkout.phoneHintPickup')
              }
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              value={phone}
              error={phoneError ?? undefined}
              onChange={(event) => {
                setPhone(event.target.value);
              }}
              onBlur={() => {
                if (phoneError) validatePhone();
              }}
            />
            <NoteField value={note} onChange={setNote} />
            <Button
              onClick={() => {
                if (validatePhone()) goTo(3);
              }}
            >
              {t('checkout.continue')}
            </Button>
          </StepSection>

          <StepSection
            number={3}
            current={step}
            title={t('checkout.payment')}
            headingRef={step === 3 ? headingRef : undefined}
            summary=""
            onChange={() => {
              goTo(3);
            }}
          >
            <p className="border-l-4 border-border-strong bg-surface-raised px-4 py-3 t-body">
              {t('checkout.paymentDemo')}
            </p>
            {methods.length > 0 ? (
              <PaymentChoice
                idPrefix="checkout-payment"
                methods={methods}
                value={paymentSelection}
                onChange={setSelection}
              />
            ) : null}
            {q && !q.openNow && q.orderingAllowed ? (
              <p className="t-body text-text-muted">{t('checkout.demoHours')}</p>
            ) : null}
            <Problems quote={q} />
            <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface px-4 py-3 md:static md:border-0 md:bg-transparent md:p-0">
              <Button
                loading={busy}
                {...(!q || q.problems.length > 0 ? { disabledReason: t('checkout.confirmBlocked') } : {})}
                onClick={() => {
                  // Doble clic: mientras el intento está en curso no sale otro (la API igual lo frena).
                  if (!q || busy) return;
                  setBanner(null);
                  place.mutate(q);
                }}
              >
                {t('checkout.confirm', { total })}
              </Button>
            </div>
          </StepSection>
        </ol>

        <aside
          id="checkout-summary"
          aria-labelledby="checkout-summary-title"
          className={`${summaryOpen ? 'flex' : 'hidden'} flex-col gap-4 lg:col-span-4 lg:col-start-9 lg:flex`}
        >
          <div className="flex flex-col gap-4 border-t border-text pt-4 lg:sticky lg:top-24">
            <h2 id="checkout-summary-title" className="t-h3">
              {t('checkout.summary')}
            </h2>
            {!q ? (
              <p role="status" className="t-body text-text-muted">
                {quote.isError ? t('checkout.errors.generic') : t('checkout.loading')}
              </p>
            ) : (
              <>
                <ul className="flex flex-col text-sm leading-6">
                  {q.cart.lines
                    .filter((line) => line.available)
                    .map((line) => (
                      <li key={line.key} className="flex justify-between gap-4 border-b border-border py-2">
                        <span>
                          {`${String(line.quantity)} × `}
                          <span translate="no">{line.name}</span>
                          {line.options.length > 0 ? (
                            <span className="block text-text-muted">
                              {line.options.map((o) => o.name.text).join(', ')}
                            </span>
                          ) : null}
                        </span>
                        <Price amountMinor={line.lineTotalMinor} currency={currency} />
                      </li>
                    ))}
                </ul>
                <div aria-live="polite">
                  <TotalsList
                    totals={q.totals}
                    currency={currency}
                    showDelivery={fulfillment === 'DELIVERY'}
                  />
                </div>
                <Link
                  to={pathForLocale('/pedido', locale)}
                  className="self-start t-ui underline underline-offset-4"
                >
                  {t('checkout.toCart')}
                </Link>
              </>
            )}
          </div>
        </aside>
      </div>
    </OrderShell>
  );
}

function StepSection({
  number,
  current,
  title,
  summary,
  onChange,
  headingRef,
  children,
}: {
  number: Step;
  current: Step;
  title: string;
  summary: string;
  onChange: () => void;
  headingRef: React.RefObject<HTMLHeadingElement | null> | undefined;
  children: ReactNode;
}) {
  const { t } = useT('order');
  const open = number === current;
  const done = number < current;
  return (
    <li className="flex flex-col gap-5 border-t border-border py-6" aria-current={open ? 'step' : undefined}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 ref={headingRef} tabIndex={-1} className={`t-h3 ${open ? '' : 'text-text-muted'}`}>
          <span className="block text-sm font-normal text-text-muted">
            {t('checkout.stepOf', { step: number })}
          </span>
          {title}
        </h2>
        {done ? (
          <button
            type="button"
            onClick={onChange}
            className="inline-flex min-h-11 items-center t-ui underline underline-offset-4"
          >
            {t('checkout.change')}
            <span className="sr-only">{` · ${title}`}</span>
          </button>
        ) : null}
      </div>
      {done && summary ? <p className="t-body">{summary}</p> : null}
      {open ? children : null}
    </li>
  );
}

function NoteField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useT('order');
  const id = useId();
  return (
    <div className="flex max-w-[26rem] flex-col gap-1.5">
      <label htmlFor={id} className="t-ui text-text">
        {t('checkout.note')}
      </label>
      <span id={`${id}-hint`} className="text-sm leading-5 text-text-muted">
        {t('checkout.noteHint')}
      </span>
      <textarea
        id={id}
        value={value}
        maxLength={300}
        rows={3}
        aria-describedby={`${id}-hint`}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className="rounded-[var(--radius-control)] border border-border bg-surface-raised px-3.5 py-3 text-base text-text hover:border-border-strong focus-visible:border-text"
      />
    </div>
  );
}

function Problems({
  quote,
  only,
}: {
  quote: CheckoutQuote | undefined;
  only?: readonly CheckoutQuote['problems'][number][];
}) {
  const { t } = useT('order');
  const locale = useLocale();
  if (!quote) return null;
  const problems = quote.problems.filter((p) => !only || only.includes(p));
  if (problems.length === 0) return null;
  const currency = quote.cart.currency;
  return (
    <ul className="flex flex-col gap-2 border border-l-4 border-border-strong bg-surface-raised px-4 py-3 t-body">
      {problems.map((problem) => (
        <li key={problem}>
          {problem === 'MIN_ORDER_NOT_MET'
            ? t('checkout.problems.MIN_ORDER_NOT_MET', {
                min: formatMoney(quote.cart.minOrderMinor, currency, locale),
              })
            : t(`checkout.problems.${problem}`)}{' '}
          {problem === 'OUTSIDE_OPENING_HOURS' ? (
            <Link to={pathForLocale('/visitanos', locale)} className="t-ui underline underline-offset-4">
              {t('checkout.seeHours')}
            </Link>
          ) : null}
          {problem === 'ITEMS_UNAVAILABLE' || problem === 'MIN_ORDER_NOT_MET' || problem === 'CART_EMPTY' ? (
            <Link to={pathForLocale('/pedido', locale)} className="t-ui underline underline-offset-4">
              {t('checkout.toCart')}
            </Link>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
