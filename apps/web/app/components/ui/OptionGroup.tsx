import { useId, useState } from 'react';
import { useT } from '../../i18n/use-locale.ts';
import { Price } from './Price.tsx';

export interface Option {
  id: string;
  label: string;
  /** Diferencia de precio en unidad menor; 0 = incluido. */
  priceDeltaMinor: number;
}

interface OptionGroupProps {
  legend: string;
  type: 'single' | 'multiple';
  options: readonly Option[];
  /** Máximo de extras en grupos de elección múltiple. */
  max?: number;
  defaultSelected?: readonly string[];
}

/** Grupo de opciones de un plato (§3.4): fieldset + legend, diferencia de precio a la derecha. */
export function OptionGroup({ legend, type, options, max, defaultSelected = [] }: OptionGroupProps) {
  const { t } = useT();
  const name = useId();
  const statusId = useId();
  const [selected, setSelected] = useState<string[]>([...defaultSelected]);
  const toggle = (id: string) => {
    if (type === 'single') {
      setSelected([id]);
      return;
    }
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };
  const limitReached = type === 'multiple' && max !== undefined && selected.length >= max;
  return (
    <fieldset className="flex max-w-[30rem] flex-col" aria-describedby={max ? statusId : undefined}>
      <legend className="mb-1 font-display text-lg leading-7 font-semibold">{legend}</legend>
      {max ? (
        <p id={statusId} aria-live="polite" className="mb-2 text-sm leading-5 text-text-muted">
          {t('form.chooseUpTo', { max })} · {t('form.chosen', { count: selected.length, max })}
        </p>
      ) : null}
      {options.map((option) => {
        const checked = selected.includes(option.id);
        const optionDisabled = !checked && limitReached;
        return (
          <label
            key={option.id}
            className={`grid min-h-12 cursor-pointer grid-cols-[1.375rem_1fr_auto] items-center gap-3 border-b border-border py-3 first-of-type:border-t ${optionDisabled ? 'cursor-not-allowed opacity-45' : ''}`}
          >
            <input
              type={type === 'single' ? 'radio' : 'checkbox'}
              name={name}
              checked={checked}
              disabled={optionDisabled}
              onChange={() => {
                toggle(option.id);
              }}
              className="size-5 accent-tinta"
            />
            <span>{option.label}</span>
            <span className="text-text-muted">
              {option.priceDeltaMinor === 0 ? (
                t('price.included')
              ) : (
                <>
                  {t('price.plus')} <Price amountMinor={option.priceDeltaMinor} className="font-medium" />
                </>
              )}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
