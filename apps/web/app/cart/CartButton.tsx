import { formatMoney } from '@marea-baja/shared';
import { Link } from 'react-router';
import { pathForLocale } from '../i18n/locale.ts';
import { useLocale, useT } from '../i18n/use-locale.ts';
import { useCart } from './use-cart.ts';

/**
 * Botón del pedido en la barra (§3.5): "Pedido · 2 · ₡18 500". En el prerender y al hidratar dice
 * solo "Pedido" (todavía no se conoce el carrito): el HTML coincide y el resto llega después.
 */
export function CartButton() {
  const { t } = useT('site');
  const locale = useLocale();
  const { view } = useCart();
  const count = view?.itemCount ?? 0;
  const total = view ? formatMoney(view.subtotalMinor, view.currency, locale) : '';
  return (
    <Link
      to={pathForLocale('/pedido', locale)}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-control)] border border-text px-3 t-ui hover:bg-surface-raised"
    >
      <span>{t('cart.button')}</span>
      {count > 0 ? (
        <>
          {/* Nombre accesible: "Pedido: 2 productos, ₡18 500" (empieza con el texto visible, WCAG 2.5.3). */}
          <span aria-hidden="true" className="tabular-nums">
            {` · ${String(count)} · ${total}`}
          </span>
          <span className="sr-only">{`: ${t('cart.buttonLabel', { count, total })}`}</span>
        </>
      ) : null}
    </Link>
  );
}
