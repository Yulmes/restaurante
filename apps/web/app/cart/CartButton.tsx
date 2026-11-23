import { formatMoney } from '@marea-baja/shared';
import { Link } from 'react-router';
import { pathForLocale } from '../i18n/locale.ts';
import { useLocale, useT } from '../i18n/use-locale.ts';
import { useCart } from './use-cart.ts';

/**
 * Botón del pedido en la barra (§3.5): "Pedido · 2 · ₡18 500". En el prerender y al hidratar dice
 * solo "Pedido" (todavía no se conoce el carrito): el HTML coincide y el resto llega después.
 *
 * Ninguna parte se corta en renglones (D2): en el celular (< 640 px) el importe pasa a un segundo
 * renglón propio, más chico, debajo de "Pedido · 2", para que el botón no empuje "Menú" fuera de
 * la pantalla; desde `sm` todo va en una línea.
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
      className="inline-flex min-h-11 shrink-0 items-center rounded-[var(--radius-control)] border border-text px-3 t-ui whitespace-nowrap hover:bg-surface-raised"
    >
      <span className="flex flex-col items-start sm:flex-row sm:items-center sm:gap-1.5">
        <span data-cart-part="label" className="max-sm:leading-5">
          {t('cart.button')}
          {count > 0 ? (
            <span aria-hidden="true" className="tabular-nums">{` · ${String(count)}`}</span>
          ) : null}
        </span>
        {count > 0 ? (
          <span
            data-cart-part="total"
            aria-hidden="true"
            className="tabular-nums max-sm:text-sm max-sm:leading-4"
          >
            <span className="hidden sm:inline">{'· '}</span>
            {total}
          </span>
        ) : null}
      </span>
      {count > 0 ? (
        /* Nombre accesible: "Pedido: 2 productos, ₡18 500" (empieza con el texto visible, WCAG 2.5.3). */
        <span className="sr-only">{`: ${t('cart.buttonLabel', { count, total })}`}</span>
      ) : null}
    </Link>
  );
}
