import { formatMoney, type CatalogOptionGroup, type CatalogProduct } from '@marea-baja/shared';
import { useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ApiError, NetworkError } from '../account/api.ts';
import { Button } from '../components/ui/Button.tsx';
import { OptionGroup } from '../components/ui/OptionGroup.tsx';
import { QuantityStepper } from '../components/ui/QuantityStepper.tsx';
import { pathForLocale } from '../i18n/locale.ts';
import { useLocale, useT } from '../i18n/use-locale.ts';
import { useCart } from './use-cart.ts';

/**
 * Hoja de producto (§3.6, §2.4 "Personalizar sin errores"): opciones, cantidad y "Agregar · ₡X"
 * con el total en vivo. Valida las reglas de cada grupo antes de agregar; la API las vuelve a
 * validar (la interfaz nunca es la autoridad del precio ni de la disponibilidad).
 */
function defaults(groups: readonly CatalogOptionGroup[]): Record<string, string[]> {
  return Object.fromEntries(
    groups.map((group) => [
      group.id,
      group.options
        .filter((o) => o.isDefault && o.isAvailable)
        .slice(0, group.maxSelect)
        .map((o) => o.id),
    ]),
  );
}

function ruleKey(group: CatalogOptionGroup): 'chooseOne' | 'chooseUpTo' | 'chooseBetween' {
  if (group.minSelect === 1 && group.maxSelect === 1) return 'chooseOne';
  if (group.minSelect === 0) return 'chooseUpTo';
  return 'chooseBetween';
}

export function ProductForm({
  product,
  idPrefix,
  onAdded,
}: {
  /** Plato con precio, disponibilidad y opciones vigentes (en vivo si llegaron). */
  product: CatalogProduct;
  idPrefix: string;
  onAdded?: () => void;
}) {
  const { t } = useT('site');
  const locale = useLocale();
  const cart = useCart();
  const formId = useId();
  const groups = product.optionGroups;
  const [selection, setSelection] = useState<Record<string, string[]>>(() => defaults(groups));
  const [quantity, setQuantity] = useState(1);
  const [showErrors, setShowErrors] = useState(false);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<{ kind: 'added' | 'error'; message: string } | null>(null);
  const firstInvalid = useRef<HTMLDivElement>(null);

  const chosen = (group: CatalogOptionGroup) => selection[group.id] ?? [];
  const invalidGroups = groups.filter((g) => {
    const count = chosen(g).length;
    return count < g.minSelect || count > g.maxSelect;
  });
  const optionIds = groups.flatMap((g) => chosen(g));
  const unit =
    product.basePriceMinor +
    groups
      .flatMap((g) => g.options.filter((o) => chosen(g).includes(o.id)))
      .reduce((a, o) => a + o.priceDeltaMinor, 0);
  const total = unit * quantity;
  const currency = cart.view?.currency ?? 'CRC';

  const submit = async () => {
    setStatus(null);
    if (invalidGroups.length > 0) {
      setShowErrors(true);
      firstInvalid.current?.querySelector('input')?.focus();
      return;
    }
    setPending(true);
    try {
      const problem = await cart.add({ productId: product.id, optionIds }, quantity);
      if (problem) {
        setStatus({ kind: 'error', message: t(`cart.${problem}`) });
        return;
      }
      setStatus({ kind: 'added', message: t('cart.added') });
      setQuantity(1);
      onAdded?.();
    } catch (error) {
      const message =
        error instanceof NetworkError
          ? t('cart.network')
          : error instanceof ApiError && error.code === 'ITEMS_UNAVAILABLE'
            ? t('cart.unavailable')
            : t('cart.error');
      setStatus({ kind: 'error', message });
    } finally {
      setPending(false);
    }
  };

  if (!product.isAvailable) {
    return <p className="t-body">{t('cart.soldOut')}</p>;
  }

  return (
    <form
      id={formId}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="flex flex-col gap-6"
    >
      {groups.map((group, index) => {
        const invalid = showErrors && invalidGroups.includes(group);
        const rule = ruleKey(group);
        const firstBad = invalid && invalidGroups[0] === group;
        return (
          <div
            key={group.id}
            ref={firstBad ? firstInvalid : undefined}
            id={`${idPrefix}-group-${String(index)}`}
          >
            <OptionGroup
              legend={group.name.text}
              {...(group.name.lang === locale ? {} : { legendLang: group.name.lang })}
              type={group.minSelect === 1 && group.maxSelect === 1 ? 'single' : 'multiple'}
              {...(group.maxSelect > 1 || group.minSelect === 0 ? { max: group.maxSelect } : {})}
              {...(invalid
                ? {
                    description:
                      group.minSelect === 1 && group.maxSelect === 1
                        ? t('cart.chooseRequired', { group: group.name.text })
                        : t('cart.chooseRange', {
                            group: group.name.text,
                            min: group.minSelect,
                            max: group.maxSelect,
                          }),
                  }
                : rule === 'chooseUpTo'
                  ? {} // El grupo ya anuncia "Elegí hasta N · elegiste X de N".
                  : { description: t(`product.${rule}`, { min: group.minSelect, max: group.maxSelect }) })}
              invalid={invalid}
              selected={chosen(group)}
              onChange={(next) => {
                setSelection((current) => ({ ...current, [group.id]: next }));
              }}
              options={group.options.map((option) => ({
                id: option.id,
                label: option.name.text,
                ...(option.name.lang === locale ? {} : { lang: option.name.lang }),
                priceDeltaMinor: option.priceDeltaMinor,
                disabled: !option.isAvailable,
                ...(option.isAvailable ? {} : { note: t('product.unavailableOption') }),
              }))}
            />
          </div>
        );
      })}
      <QuantityStepper value={quantity} onChange={setQuantity} />
      <div className="flex flex-col items-start gap-3">
        <Button type="submit" loading={pending}>
          {t('cart.add', { price: formatMoney(total, currency, locale) })}
        </Button>
        <p className="text-sm leading-5 text-text-muted">{t('cart.priceNote')}</p>
        <div role="status" aria-live="polite" className="min-h-6">
          {status ? (
            <p className={`t-body ${status.kind === 'error' ? 'text-danger' : ''}`}>
              {status.message}{' '}
              {status.kind === 'added' ? (
                <Link to={pathForLocale('/pedido', locale)} className="t-ui underline underline-offset-4">
                  {t('cart.viewOrder')}
                </Link>
              ) : null}
            </p>
          ) : null}
        </div>
      </div>
    </form>
  );
}
