import { formatMoney, type CurrencyCode } from '@marea-baja/shared';
import { useLocale } from '../../i18n/use-locale.ts';

interface PriceProps {
  amountMinor: number;
  currency?: CurrencyCode;
  className?: string;
}

/** Precio con el token `price` (§3.1): cifras tabulares, sin cortes de línea. */
export function Price({ amountMinor, currency = 'CRC', className }: PriceProps) {
  const locale = useLocale();
  return (
    <span className={['t-price', className].filter(Boolean).join(' ')}>
      {formatMoney(amountMinor, currency, locale)}
    </span>
  );
}
