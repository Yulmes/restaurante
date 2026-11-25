import type { OrderTotals } from '@marea-baja/shared';
import type { ReactNode } from 'react';
import { DemoBanner } from '../components/ui/DemoBanner.tsx';
import { Price } from '../components/ui/Price.tsx';
import { MAIN_ID, SkipLink } from '../components/ui/SkipLink.tsx';
import { i18n } from '../i18n/config.ts';
import { localeFromPathname } from '../i18n/locale.ts';
import { useT } from '../i18n/use-locale.ts';
import { SiteFooter, SiteHeader } from '../site/SiteLayout.tsx';

type MetaKey =
  | 'cart.metaTitle'
  | 'checkout.metaTitle'
  | 'confirmation.metaTitle'
  | 'tracking.metaTitle'
  | 'history.metaTitle'
  | 'pass.metaTitle';

/** Las páginas del pedido no se indexan: usan el fallback SPA con noindex (§4.2), como la cuenta. */
export function orderMeta(pathname: string, key: MetaKey) {
  const t = i18n.getFixedT(localeFromPathname(pathname), 'order');
  return [{ title: t(key) }, { name: 'robots', content: 'noindex' }];
}

/** Marco de las páginas del pedido: el mismo de las páginas públicas, con título y aviso de demo. */
export function OrderShell({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: string | undefined;
  children: ReactNode;
}) {
  return (
    <>
      <SkipLink />
      <DemoBanner />
      <SiteHeader />
      <main
        id={MAIN_ID}
        tabIndex={-1}
        className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 pt-8 pb-28 md:px-8 md:pt-12"
      >
        <header className="flex max-w-3xl flex-col gap-3">
          <h1 className="t-h1">{title}</h1>
          {intro ? <p className="t-body text-text-muted">{intro}</p> : null}
        </header>
        {children}
      </main>
      <SiteFooter />
    </>
  );
}

function rate(bps: number): string {
  return `${String(bps / 100).replace('.', ',')} %`;
}

/** Resumen de importes (§3.6): subtotal, envío, impuestos desglosados y total con cifras tabulares. */
export function TotalsList({
  totals,
  currency,
  showDelivery,
}: {
  totals: OrderTotals;
  currency: 'CRC' | 'USD';
  showDelivery: boolean;
}) {
  const { t } = useT('order');
  const row = 'flex items-baseline justify-between gap-4 py-1.5';
  return (
    <dl className="flex flex-col t-body">
      <div className={row}>
        <dt>{t('checkout.subtotal')}</dt>
        <dd>
          <Price amountMinor={totals.subtotalMinor} currency={currency} />
        </dd>
      </div>
      {showDelivery ? (
        <div className={row}>
          <dt>{t('checkout.deliveryFee')}</dt>
          <dd>
            <Price amountMinor={totals.deliveryFeeMinor} currency={currency} />
          </dd>
        </div>
      ) : null}
      {totals.taxLines.map((line) => (
        <div key={`${line.name}-${String(line.rateBps)}`} className={`${row} text-sm text-text-muted`}>
          <dt>
            {line.inclusive
              ? t('checkout.taxIncluded', { name: line.name, rate: rate(line.rateBps) })
              : t('checkout.taxAdded', { name: line.name, rate: rate(line.rateBps) })}
          </dt>
          <dd>
            <Price amountMinor={line.taxMinor} currency={currency} />
          </dd>
        </div>
      ))}
      {totals.roundingAdjustmentMinor !== 0 ? (
        <div className={`${row} text-sm text-text-muted`}>
          <dt>{t('checkout.rounding')}</dt>
          <dd>
            {totals.roundingAdjustmentMinor < 0 ? '−' : ''}
            <Price amountMinor={Math.abs(totals.roundingAdjustmentMinor)} currency={currency} />
          </dd>
        </div>
      ) : null}
      <div className={`${row} mt-1 border-t border-text pt-3 font-semibold`}>
        <dt>{t('checkout.total')}</dt>
        <dd className="text-xl">
          <Price amountMinor={totals.totalMinor} currency={currency} />
        </dd>
      </div>
    </dl>
  );
}
