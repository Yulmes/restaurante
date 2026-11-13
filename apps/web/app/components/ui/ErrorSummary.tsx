import { useEffect, useId, useRef } from 'react';
import { useT } from '../../i18n/use-locale.ts';

export interface FieldError {
  fieldId: string;
  message: string;
}

interface ErrorSummaryProps {
  errors: readonly FieldError[];
  /** Al fallar el envío, el foco va al resumen (patrón de UI/UX Pro Max, §3.4). */
  focusOnMount?: boolean;
  /** Nivel del título según la página donde se use (sin saltos en la jerarquía). */
  headingLevel?: 2 | 3 | 4;
}

export function ErrorSummary({ errors, focusOnMount = false, headingLevel = 2 }: ErrorSummaryProps) {
  const Heading = `h${String(headingLevel)}` as 'h2' | 'h3' | 'h4';
  const { t } = useT();
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusOnMount) ref.current?.focus();
  }, [focusOnMount]);
  if (errors.length === 0) return null;
  return (
    <div
      ref={ref}
      role="alert"
      tabIndex={-1}
      aria-labelledby={titleId}
      className="max-w-[26rem] border border-l-4 border-danger bg-surface-raised px-4 py-3.5"
    >
      <Heading id={titleId} className="font-display text-base font-semibold">
        {t('form.errorSummaryTitle', { count: errors.length })}
      </Heading>
      <ul className="mt-1.5 list-disc pl-5 text-sm leading-6">
        {errors.map((e) => (
          <li key={e.fieldId}>
            <a href={`#${e.fieldId}`} className="text-danger underline underline-offset-2">
              {e.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
