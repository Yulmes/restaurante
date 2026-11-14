import { useState } from 'react';
import type { FieldErrors, FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ErrorSummary } from '../components/ui/ErrorSummary.tsx';
import { useT } from '../i18n/use-locale.ts';
import { ApiError, NetworkError } from './api.ts';

type AccountT = ReturnType<typeof useT<'account'>>['t'];

/** Código de validación (de Zod o de la API) → texto traducido. */
export function fieldMessage(t: AccountT, code: string | undefined): string {
  const known = [
    'required',
    'invalidEmail',
    'tooLong',
    'passwordTooShort',
    'passwordTooLong',
    'passwordTooCommon',
    'currentPasswordIncorrect',
    'invalidPhone',
  ] as const;
  const match = known.find((k) => k === code);
  return t(`fieldErrors.${match ?? 'invalid'}`);
}

const FIELD_LABELS = ['name', 'email', 'password', 'currentPassword', 'newPassword', 'phone'] as const;

/** Etiqueta habitual de un campo de la cuenta. */
export function fieldLabel(t: AccountT, field: string): string {
  const match = FIELD_LABELS.find((f) => f === field);
  return match ? t(`fields.${match}`) : field;
}

/** Error general de la API → texto traducido. Los códigos nunca se muestran tal cual. */
export function apiErrorMessage(t: AccountT, error: unknown): string {
  if (error instanceof NetworkError) return t('errors.network');
  if (!(error instanceof ApiError)) return t('errors.generic');
  switch (error.code) {
    case 'RATE_LIMITED': {
      const seconds = error.retryAfterSeconds ?? 60;
      return seconds >= 120
        ? t('errors.RATE_LIMITED_minutes', { count: Math.ceil(seconds / 60) })
        : t('errors.RATE_LIMITED', { count: seconds });
    }
    case 'INVALID_CREDENTIALS':
    case 'CHALLENGE_REQUIRED':
    case 'CHALLENGE_FAILED':
    case 'ACCOUNT_BLOCKED':
    case 'INVALID_OR_EXPIRED_TOKEN':
    case 'EMAIL_ALREADY_VERIFIED':
    case 'UNAUTHENTICATED':
    case 'CSRF_FAILED':
      return t(`errors.${error.code}`);
    default:
      return t('errors.generic');
  }
}

/**
 * Pasa los errores por campo que devolvió la API al formulario. Devuelve `true` si los había.
 */
export function applyServerFieldErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[],
): boolean {
  if (!(error instanceof ApiError) || error.code !== 'VALIDATION_FAILED') return false;
  let applied = false;
  for (const field of fields) {
    const code = error.fields[field];
    if (code) {
      setError(field, { type: 'server', message: code });
      applied = true;
    }
  }
  return applied;
}

/**
 * Resumen de errores enfocable arriba del formulario (§3.4): errores por campo y, si los hay,
 * un error general (credenciales, límites…). Se vuelve a montar en cada envío fallido para que
 * el foco vaya al resumen.
 */
export function FormErrors<T extends FieldValues>({
  errors,
  order,
  general,
  attempt,
  idPrefix,
  labels = {},
}: {
  errors: FieldErrors<T>;
  order: readonly Path<T>[];
  general: string | null;
  attempt: number;
  idPrefix: string;
  /** Etiqueta visible de cada campo, si difiere de la habitual (por ejemplo, "Contraseña nueva"). */
  labels?: Partial<Record<string, string>>;
}) {
  const { t } = useT('account');
  const list = order.flatMap((field) => {
    const message = errors[field]?.message;
    if (typeof message !== 'string') return [];
    // Cada enlace nombra su campo: "Correo electrónico: escribí un correo válido…".
    const label = labels[field] ?? fieldLabel(t, field);
    return [{ fieldId: `${idPrefix}-${field}`, message: `${label}: ${fieldMessage(t, message)}` }];
  });
  if (general) list.unshift({ fieldId: `${idPrefix}-form`, message: general });
  if (list.length === 0) return null;
  return <ErrorSummary key={attempt} errors={list} focusOnMount={attempt > 0} />;
}

/** Contador de envíos fallidos: cambia la `key` del resumen para volver a enfocarlo. */
export function useAttempts(): [number, () => void] {
  const [attempt, setAttempt] = useState(0);
  return [
    attempt,
    () => {
      setAttempt((n) => n + 1);
    },
  ];
}
