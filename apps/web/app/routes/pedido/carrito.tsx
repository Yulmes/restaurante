import { formatMoney, type CartLineView } from '@marea-baja/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import { orderMeta, OrderShell } from '../../cart/OrderShell.tsx';
import { lineRef, useCart, useMergeNotice, type CartChangeError } from '../../cart/use-cart.ts';
import { buttonClassName, Button } from '../../components/ui/Button.tsx';
import { Price } from '../../components/ui/Price.tsx';
import { QuantityStepper } from '../../components/ui/QuantityStepper.tsx';
import { pathForLocale } from '../../i18n/locale.ts';
import { useLocale, useT } from '../../i18n/use-locale.ts';
import type { Route } from './+types/carrito';

export function meta({ location }: Route.MetaArgs) {
  return orderMeta(location.pathname, 'cart.metaTitle');
}

/**
 * Tu pedido (M5): cada plato aparece una sola vez con su cantidad total (C5), los importes los
 * calcula la API y los platos que ya no se pueden pedir se muestran con su motivo (§7.5).
 */
export default function Carrito() {
  const { t } = useT('order');
  const locale = useLocale();
  const cart = useCart();
  const [notice, dismiss] = useMergeNotice();
  const [problem, setProblem] = useState<string | null>(null);
  const view = cart.view;

  const run = async (action: () => Promise<CartChangeError | null>) => {
    setProblem(null);
    try {
      const result = await action();
      if (result) setProblem(t(`cart.${result}`));
    } catch {
      setProblem(t('cart.updateError'));
    }
  };

  if (!cart.ready) {
    return (
      <OrderShell title={t('cart.title')}>
        <p role="status" className="t-body text-text-muted">
          {t('cart.loading')}
        </p>
      </OrderShell>
    );
  }
  if (cart.isError && !view) {
    return (
      <OrderShell title={t('cart.title')}>
        <div className="flex flex-col items-start gap-3">
          <p role="alert" className="t-body text-danger">
            {t('cart.error')}
          </p>
          <Button variant="secondary" onClick={cart.refetch}>
            {t('cart.retry')}
          </Button>
        </div>
      </OrderShell>
    );
  }

  const lines = view?.lines ?? [];
  const unavailable = lines.filter((l) => !l.available);
  const blocked = unavailable.length > 0 || !view?.meetsMinimum;
  const currency = view?.currency ?? 'CRC';

  return (
    <OrderShell title={t('cart.title')} intro={lines.length > 0 ? t('cart.intro') : undefined}>
      {notice.length > 0 ? (
        <div
          role="status"
          className="max-w-2xl border border-l-4 border-border-strong bg-surface-raised px-4 py-3.5"
        >
          <h2 className="font-display text-base font-semibold">{t('cart.mergeTitle')}</h2>
          <ul className="mt-1.5 list-disc pl-5 text-sm leading-6">
            {notice.map((item) => (
              <li key={`${item.productId}-${item.optionIds.join(',')}-${item.reason}`}>
                <span translate="no">{item.name ?? t('unknownProduct')}</span>
                {` × ${String(item.quantity)}: ${t(`reasons.${item.reason}`)}`}
              </li>
            ))}
          </ul>
          <button type="button" onClick={dismiss} className="mt-2 t-ui underline underline-offset-4">
            {t('cart.dismiss')}
          </button>
        </div>
      ) : null}

      {lines.length === 0 ? (
        <div className="flex max-w-xl flex-col items-start gap-3 border-t border-border pt-6">
          <h2 className="t-h2">{t('cart.emptyTitle')}</h2>
          <p className="t-body text-text-muted">{t('cart.emptyBody')}</p>
          <Link to={pathForLocale('/carta', locale)} className={buttonClassName('primary')}>
            {t('cart.toMenu')}
          </Link>
        </div>
      ) : (
        <div className="grid gap-10 lg:grid-cols-12">
          <ul className="flex flex-col lg:col-span-7" aria-label={t('cart.title')}>
            {lines.map((line) => (
              <CartLine
                key={line.key}
                line={line}
                currency={currency}
                onQuantity={(quantity) => void run(() => cart.setQuantity(lineRef(line), quantity))}
                onRemove={() => void run(() => cart.remove(lineRef(line)))}
              />
            ))}
          </ul>
          <aside className="flex flex-col gap-4 lg:col-span-4 lg:col-start-9" aria-labelledby="cart-summary">
            <div className="flex flex-col gap-3 border-t border-text pt-4 lg:sticky lg:top-24">
              <h2 id="cart-summary" className="t-h3">
                {t('checkout.summary')}
              </h2>
              <div className="flex items-baseline justify-between gap-4 t-body">
                <span>{t('cart.subtotal')}</span>
                <span className="text-xl font-semibold" aria-live="polite">
                  <Price amountMinor={view?.subtotalMinor ?? 0} currency={currency} />
                </span>
              </div>
              <p className="text-sm leading-5 text-text-muted">{t('cart.taxNote')}</p>
              {problem ? (
                <p role="alert" className="t-body text-danger">
                  {problem}
                </p>
              ) : null}
              {blocked ? (
                <Button
                  disabledReason={
                    unavailable.length > 0
                      ? t('cart.unavailableBlocks')
                      : t('cart.minOrder', {
                          min: formatMoney(view?.minOrderMinor ?? 0, currency, locale),
                          missing: formatMoney(
                            (view?.minOrderMinor ?? 0) - (view?.subtotalMinor ?? 0),
                            currency,
                            locale,
                          ),
                        })
                  }
                >
                  {t('cart.checkout')}
                </Button>
              ) : (
                <Link to={pathForLocale('/pedido/finalizar', locale)} className={buttonClassName('primary')}>
                  {t('cart.checkout')}
                </Link>
              )}
              <Link
                to={pathForLocale('/carta', locale)}
                className="self-start t-ui underline underline-offset-4"
              >
                {t('cart.toMenu')}
              </Link>
            </div>
          </aside>
        </div>
      )}
    </OrderShell>
  );
}

function CartLine({
  line,
  currency,
  onQuantity,
  onRemove,
}: {
  line: CartLineView;
  currency: 'CRC' | 'USD';
  onQuantity: (quantity: number) => void;
  onRemove: () => void;
}) {
  const { t } = useT('order');
  const locale = useLocale();
  const name = line.name || t('unknownProduct');
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-3 border-b border-border py-5">
      <div className="flex min-w-0 flex-col gap-1">
        <h3
          className={`font-display text-xl leading-7 font-semibold ${line.available ? '' : 'text-text-muted'}`}
        >
          {line.slug && line.categorySlug ? (
            <Link
              to={pathForLocale(`/carta/${line.categorySlug}/${line.slug}`, locale)}
              translate="no"
              className="underline-offset-4 [overflow-wrap:anywhere] hover:underline"
            >
              {name}
            </Link>
          ) : (
            <span translate="no">{name}</span>
          )}
        </h3>
        {line.translatedName ? <p className="t-ui">{line.translatedName}</p> : null}
        {line.options.length > 0 ? (
          <ul className="text-sm leading-6 text-text-muted">
            {line.options.map((option) => (
              <li key={option.id}>
                <span lang={option.group.lang === locale ? undefined : option.group.lang}>
                  {option.group.text}
                </span>
                {': '}
                <span lang={option.name.lang === locale ? undefined : option.name.lang}>
                  {option.name.text}
                </span>
                {option.priceDeltaMinor > 0 ? (
                  <>
                    {' '}
                    {/* "(+₡600)" sin cortes de renglón (D4). */}
                    <span data-option-surcharge className="whitespace-nowrap">
                      {'(+'}
                      <Price amountMinor={option.priceDeltaMinor} currency={currency} />
                      {')'}
                    </span>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {line.available ? (
          <p className="text-sm text-text-muted">
            {t('cart.each', { price: formatMoney(line.unitPriceMinor, currency, locale) })}
          </p>
        ) : (
          <p className="t-body">
            <span className="t-ui">{t('cart.unavailableTitle')}</span>
            {line.reason ? `: ${t(`reasons.${line.reason}`)}` : null}
          </p>
        )}
      </div>
      <span className={`self-start text-lg ${line.available ? '' : 'text-text-muted line-through'}`}>
        <Price amountMinor={line.lineTotalMinor} currency={currency} />
      </span>
      <div className="col-span-2 flex flex-wrap items-end gap-6">
        {line.available ? <QuantityStepper value={line.quantity} onChange={onQuantity} /> : null}
        <button
          type="button"
          onClick={onRemove}
          aria-label={t('cart.removeLabel', { name })}
          className="inline-flex min-h-11 items-center t-ui underline underline-offset-4"
        >
          {t('cart.remove')}
        </button>
      </div>
    </li>
  );
}
