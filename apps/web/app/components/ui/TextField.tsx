import type { InputHTMLAttributes } from 'react';
import { ErrorIcon } from './ErrorIcon.tsx';

type ForcedFieldState = 'hover' | 'focus';

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'className'> {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  forceState?: ForcedFieldState;
}

export function TextField({ id, label, hint, error, forceState, disabled, ...rest }: TextFieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  const stateBorder =
    forceState === 'focus'
      ? 'border-text outline-2 outline-offset-0 outline-focus'
      : forceState === 'hover'
        ? 'border-border-strong'
        : '';
  return (
    <div className="flex max-w-[26rem] flex-col gap-1.5">
      <label htmlFor={id} className="t-ui text-text">
        {label}
      </label>
      {hint ? (
        <span id={hintId} className="text-sm leading-5 text-text-muted">
          {hint}
        </span>
      ) : null}
      <input
        id={id}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={[
          'h-12 rounded-[var(--radius-control)] border bg-surface-raised px-3.5 text-base text-text transition-colors duration-[var(--duration-hover)]',
          'placeholder:text-text-muted hover:border-border-strong focus-visible:border-text focus-visible:outline-offset-0',
          'disabled:cursor-not-allowed disabled:opacity-45',
          error ? 'border-danger' : 'border-border',
          stateBorder,
        ].join(' ')}
        {...rest}
      />
      {error ? (
        <span id={errorId} className="flex items-start gap-1.5 text-sm leading-5 text-danger">
          <ErrorIcon />
          {error}
        </span>
      ) : null}
    </div>
  );
}
