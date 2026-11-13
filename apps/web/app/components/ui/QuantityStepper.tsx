import { useId } from 'react';
import { useT } from '../../i18n/use-locale.ts';

interface QuantityStepperProps {
  value: number;
  onChange: (next: number) => void;
}

/**
 * Selector de cantidad (§3.6 y regla C5): edita la cantidad TOTAL del producto.
 * Mínimo 1 y sin tope artificial de 20; el límite de 20 es solo de las líneas
 * internas de almacenamiento y lo resuelve la API (M5), no la interfaz.
 */
export function QuantityStepper({ value, onChange }: QuantityStepperProps) {
  const { t } = useT();
  const labelId = useId();
  const buttonClass =
    'grid size-11 place-items-center rounded-[var(--radius-control)] border border-text text-xl leading-none text-text transition-colors duration-[var(--duration-hover)] hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-45';
  return (
    <div className="flex flex-col gap-1.5">
      <span id={labelId} className="t-ui">
        {t('quantity.label')}
      </span>
      <div role="group" aria-labelledby={labelId} className="inline-flex items-center gap-3">
        <button
          type="button"
          className={buttonClass}
          aria-label={t('quantity.decrease')}
          disabled={value <= 1}
          onClick={() => {
            onChange(Math.max(1, value - 1));
          }}
        >
          <span aria-hidden="true">−</span>
        </button>
        {/* El lector de pantalla anuncia "Cantidad: 26", no solo "26". */}
        <output aria-live="polite" className="min-w-8 text-center text-lg font-bold tabular-nums">
          <span className="sr-only">
            {t('quantity.label')}
            {': '}
          </span>
          {value}
        </output>
        <button
          type="button"
          className={buttonClass}
          aria-label={t('quantity.increase')}
          onClick={() => {
            onChange(value + 1);
          }}
        >
          <span aria-hidden="true">+</span>
        </button>
      </div>
    </div>
  );
}
