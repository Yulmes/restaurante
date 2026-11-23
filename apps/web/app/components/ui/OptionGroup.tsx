import { useId, useState } from 'react';
import { useT } from '../../i18n/use-locale.ts';
import { Price } from './Price.tsx';

export interface Option {
  id: string;
  label: string;
  /** Diferencia de precio en unidad menor; 0 = incluido. */
  priceDeltaMinor: number;
  /** M5: opción agotada hoy u otra razón para no elegirla. */
  disabled?: boolean;
  /** M5: texto breve junto a la etiqueta ("no disponible hoy"). */
  note?: string;
  /** M5: idioma real de la etiqueta si difiere del de la página (§4.5). */
  lang?: string;
}

interface OptionGroupProps {
  legend: string;
  type: 'single' | 'multiple';
  options: readonly Option[];
  /** Máximo de extras en grupos de elección múltiple. */
  max?: number;
  defaultSelected?: readonly string[];
  /** M5: modo controlado (hoja de producto). Sin `selected`, el grupo guarda su propio estado. */
  selected?: readonly string[];
  onChange?: (next: string[]) => void;
  /** M5: regla del grupo ("Elegí una (obligatorio)") o error, anunciada con el grupo. */
  description?: string;
  invalid?: boolean;
  /** Idioma real de la leyenda si difiere del de la página. */
  legendLang?: string;
}

/** Grupo de opciones de un plato (§3.4): fieldset + legend, diferencia de precio a la derecha. */
export function OptionGroup({
  legend,
  type,
  options,
  max,
  defaultSelected = [],
  selected: controlled,
  onChange,
  description,
  invalid = false,
  legendLang,
}: OptionGroupProps) {
  const { t } = useT();
  const name = useId();
  const statusId = useId();
  const descriptionId = useId();
  const [own, setOwn] = useState<string[]>([...defaultSelected]);
  const selected = controlled ? [...controlled] : own;
  const toggle = (id: string) => {
    const next =
      type === 'single' ? [id] : selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    if (!controlled) setOwn(next);
    onChange?.(next);
  };
  const describedBy = [description ? descriptionId : null, max ? statusId : null].filter(Boolean).join(' ');
  const limitReached = type === 'multiple' && max !== undefined && selected.length >= max;
  return (
    <fieldset className="flex max-w-[30rem] flex-col" aria-describedby={describedBy || undefined}>
      <legend lang={legendLang} className="mb-1 font-display text-lg leading-7 font-semibold">
        {legend}
      </legend>
      {description ? (
        <p
          id={descriptionId}
          className={`mb-2 text-sm leading-5 ${invalid ? 'text-danger' : 'text-text-muted'}`}
        >
          {description}
        </p>
      ) : null}
      {max ? (
        <p id={statusId} aria-live="polite" className="mb-2 text-sm leading-5 text-text-muted">
          {t('form.chooseUpTo', { max })} · {t('form.chosen', { count: selected.length, max })}
        </p>
      ) : null}
      {options.map((option) => {
        const checked = selected.includes(option.id);
        const optionDisabled = (option.disabled ?? false) || (!checked && limitReached);
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
            <span>
              <span lang={option.lang}>{option.label}</span>
              {option.note ? <span className="text-sm text-text-muted">{` · ${option.note}`}</span> : null}
            </span>
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
