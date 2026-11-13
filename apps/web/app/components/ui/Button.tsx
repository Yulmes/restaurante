import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { useId } from 'react';
import { useT } from '../../i18n/use-locale.ts';

export type ButtonVariant = 'primary' | 'secondary' | 'text' | 'danger';
export type ButtonTone = 'light' | 'dark';
/** Solo para la página /_design: muestra un estado sin interacción. */
export type ForcedState = 'hover' | 'focus' | 'active';

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'disabled'> {
  variant?: ButtonVariant;
  tone?: ButtonTone;
  loading?: boolean;
  /** Si se indica, el botón queda deshabilitado y el motivo se muestra y se anuncia. */
  disabledReason?: string;
  forceState?: ForcedState;
  children: ReactNode;
}

const base =
  'relative inline-flex min-h-12 items-center justify-center gap-2 overflow-hidden rounded-[var(--radius-control)] border px-5 t-ui transition-[background-color,color,border-color] duration-[var(--duration-hover)] ease-[var(--ease-marea)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45 data-[state=active]:translate-y-px';

const styles: Record<ButtonTone, Record<ButtonVariant, string>> = {
  light: {
    primary:
      'border-transparent bg-action text-text-inverse hover:bg-action-hover data-[state=hover]:bg-action-hover',
    secondary:
      'border-text bg-transparent text-text hover:bg-surface-raised data-[state=hover]:bg-surface-raised',
    text: 'min-h-0 border-transparent px-0 text-text underline underline-offset-4 hover:decoration-2 data-[state=hover]:decoration-2',
    danger:
      'border-danger bg-transparent text-danger hover:bg-surface-raised data-[state=hover]:bg-surface-raised',
  },
  dark: {
    primary:
      'border-transparent bg-action-on-dark text-text hover:bg-[#ffc547] data-[state=hover]:bg-[#ffc547]',
    secondary:
      'border-text-inverse bg-transparent text-text-inverse hover:bg-tinta-800 data-[state=hover]:bg-tinta-800',
    text: 'min-h-0 border-transparent px-0 text-text-inverse underline underline-offset-4 hover:decoration-2 data-[state=hover]:decoration-2',
    danger: 'border-text-inverse bg-transparent text-text-inverse',
  },
};

export function Button({
  variant = 'primary',
  tone = 'light',
  loading = false,
  disabledReason,
  forceState,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  const { t } = useT();
  const reasonId = useId();
  const disabled = disabledReason !== undefined;
  const focusClass =
    forceState === 'focus'
      ? `is-focus outline-2 outline-offset-2 ${tone === 'dark' ? 'outline-focus-on-dark' : 'outline-focus'}`
      : '';
  return (
    <span className="inline-flex flex-col items-start gap-1.5">
      <button
        type={type}
        disabled={disabled}
        aria-busy={loading || undefined}
        aria-describedby={disabled ? reasonId : undefined}
        data-state={forceState}
        className={[base, styles[tone][variant], focusClass, className].filter(Boolean).join(' ')}
        {...rest}
      >
        {/* §3.3: al procesar, el botón no cambia de ancho. El texto original reserva el espacio. */}
        <span className={loading ? 'invisible' : undefined}>{children}</span>
        {loading ? (
          <span className="absolute inset-0 grid place-items-center">{t('actions.processing')}</span>
        ) : null}
        {loading ? (
          <span
            aria-hidden="true"
            className="absolute bottom-0 left-0 h-0.5 w-2/5 animate-[marea-progress_1.4s_var(--ease-marea)_infinite] bg-aji"
          />
        ) : null}
      </button>
      {disabled ? (
        <span
          id={reasonId}
          className={`t-ui ${tone === 'dark' ? 'text-text-inverse-muted' : 'text-text-muted'}`}
        >
          {disabledReason}
        </span>
      ) : null}
    </span>
  );
}
