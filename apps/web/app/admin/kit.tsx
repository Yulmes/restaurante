import type { CurrencyCode } from '@marea-baja/shared';
import type { ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { Link, Navigate, useLocation } from 'react-router';
import { ApiError, NetworkError } from '../account/api.ts';
import { useLocalizedPath } from '../account/links.ts';
import { useMe } from '../account/session.ts';
import { OrderShell } from '../cart/OrderShell.tsx';
import { ErrorIcon } from '../components/ui/ErrorIcon.tsx';
import { i18n } from '../i18n/config.ts';
import { localeFromPathname, pathForLocale } from '../i18n/locale.ts';
import { useT } from '../i18n/use-locale.ts';

/**
 * Piezas comunes del admin (M8). Todo es solo de ADMIN (D-M8-3): la web oculta, la API protege.
 * Las páginas no se indexan (fallback SPA con noindex, como la cuenta y el Pase).
 */
export type AdminSection =
  'dashboard' | 'pass' | 'orders' | 'menu' | 'catch' | 'customers' | 'settings' | 'audit';

const SECTIONS: { key: AdminSection; path: string }[] = [
  { key: 'dashboard', path: '/admin' },
  { key: 'pass', path: '/admin/pase' },
  { key: 'orders', path: '/admin/pedidos' },
  { key: 'menu', path: '/admin/carta' },
  { key: 'catch', path: '/admin/pesca' },
  { key: 'customers', path: '/admin/clientes' },
  { key: 'settings', path: '/admin/configuracion' },
  { key: 'audit', path: '/admin/auditoria' },
];

export function adminMeta(pathname: string, section: AdminSection) {
  const t = i18n.getFixedT(localeFromPathname(pathname), 'admin');
  return [
    { title: t('meta.title', { section: t(`nav.${section}`) }) },
    { name: 'robots', content: 'noindex' },
  ];
}

/** Navegación entre secciones. STAFF solo ve el Pase: el resto es de ADMIN. */
export function AdminNav({ current }: { current: AdminSection }) {
  const { t } = useT('admin');
  const to = useLocalizedPath();
  const me = useMe();
  const isAdmin = me.data?.roles.includes('ADMIN') ?? false;
  const visible = SECTIONS.filter((section) => isAdmin || section.key === 'pass');
  return (
    <nav aria-label={t('nav.label')} className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
      <ul className="flex min-w-max gap-1 border-b border-border">
        {visible.map((section) => {
          const active = section.key === current;
          return (
            <li key={section.key}>
              <Link
                to={to(section.path)}
                aria-current={active ? 'page' : undefined}
                className={[
                  'inline-flex min-h-11 items-center border-b-2 px-3 t-ui whitespace-nowrap transition-colors',
                  active
                    ? 'border-text text-text'
                    : 'border-transparent text-text-muted hover:border-border-strong hover:text-text',
                ].join(' ')}
              >
                {t(`nav.${section.key}`)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Marco de cada página del admin con el control de acceso de la web (la API decide de verdad). */
export function AdminPage({
  section,
  title,
  intro,
  children,
}: {
  section: AdminSection;
  title: string;
  intro?: string | undefined;
  children: ReactNode;
}) {
  const { t } = useT('admin');
  const to = useLocalizedPath();
  const location = useLocation();
  const me = useMe();
  if (me.isPending) {
    return (
      <OrderShell title={title}>
        <p role="status" className="t-body text-text-muted">
          {t('access.loading')}
        </p>
      </OrderShell>
    );
  }
  if (!me.data) {
    const next = encodeURIComponent(pathForLocale(location.pathname, localeFromPathname(location.pathname)));
    return <Navigate to={`${to('/cuenta/ingresar')}?next=${next}`} replace />;
  }
  if (!me.data.roles.includes('ADMIN')) {
    return (
      <OrderShell title={title}>
        <AdminNav current={section} />
        <p role="alert" className="t-body">
          {t('access.forbidden')}
        </p>
      </OrderShell>
    );
  }
  return (
    <OrderShell title={title} intro={intro}>
      <AdminNav current={section} />
      {children}
    </OrderShell>
  );
}

export type NoticeState = { tone: 'ok' | 'error'; text: string } | null;

/** Resultado de una acción, anunciado (§3.6: avisos sobrios y anunciados). */
export function Notice({ notice }: { notice: NoticeState }) {
  return (
    <div aria-live="polite">
      {notice ? (
        <p
          role={notice.tone === 'error' ? 'alert' : 'status'}
          className={`border-l-4 bg-surface-raised px-4 py-3 t-body ${
            notice.tone === 'error' ? 'border-danger' : 'border-border-strong'
          }`}
        >
          {notice.text}
        </p>
      ) : null}
    </div>
  );
}

const KNOWN_ERRORS = [
  'RESOURCE_VERSION_CONFLICT',
  'SLUG_TAKEN',
  'PRICE_INCREMENT',
  'CURRENCY_CHANGE_BLOCKED',
  'ADMIN_SELF_CHANGE',
  'LAST_ADMIN',
  'RATE_LIMITED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION_FAILED',
  'ORDER_VERSION_CONFLICT',
  'ORDER_TRANSITION_NOT_ALLOWED',
  'PAYMENT_IN_PROGRESS',
  'PAYMENT_NOT_ALLOWED',
  'REFUND_EXCEEDS_CAPTURED',
  'GATEWAY_ERROR',
] as const;
type KnownError = (typeof KNOWN_ERRORS)[number];

/** Texto del error de la API en el idioma de la página. `message` nunca se muestra. */
export function useErrorText(): (error: unknown) => string {
  const { t } = useT('admin');
  return (error) => {
    if (error instanceof NetworkError) return t('errors.network');
    if (error instanceof ApiError && (KNOWN_ERRORS as readonly string[]).includes(error.code)) {
      return t(`errors.${error.code as KnownError}`);
    }
    return t('errors.generic');
  };
}

/** Errores por campo que devolvió la API (`fields`), o ninguno. */
export function fieldErrorsOf(error: unknown): Record<string, string> {
  return error instanceof ApiError ? error.fields : {};
}

const control =
  'rounded-[var(--radius-control)] border bg-surface-raised px-3.5 text-base text-text hover:border-border-strong focus-visible:border-text focus-visible:outline-offset-0 disabled:cursor-not-allowed disabled:opacity-45';

function FieldMessage({ id, error }: { id: string; error?: string | undefined }) {
  if (!error) return null;
  return (
    <span id={id} className="flex items-start gap-1.5 text-sm leading-5 text-danger">
      <ErrorIcon />
      {error}
    </span>
  );
}

export function TextArea({
  id,
  label,
  hint,
  error,
  lang,
  ...rest
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id' | 'className'> & {
  id: string;
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
}) {
  const describedBy =
    [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className="flex max-w-[36rem] flex-col gap-1.5">
      <label htmlFor={id} className="t-ui">
        {label}
      </label>
      {hint ? (
        <span id={`${id}-hint`} className="text-sm leading-5 text-text-muted">
          {hint}
        </span>
      ) : null}
      <textarea
        id={id}
        lang={lang}
        rows={3}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`${control} py-2.5 ${error ? 'border-danger' : 'border-border'}`}
        {...rest}
      />
      <FieldMessage id={`${id}-error`} error={error} />
    </div>
  );
}

export function SelectField({
  id,
  label,
  error,
  children,
  ...rest
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id' | 'className'> & {
  id: string;
  label: string;
  error?: string | undefined;
}) {
  return (
    <div className="flex max-w-[26rem] flex-col gap-1.5">
      <label htmlFor={id} className="t-ui">
        {label}
      </label>
      <select
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`${control} h-12 ${error ? 'border-danger' : 'border-border'}`}
        {...rest}
      >
        {children}
      </select>
      <FieldMessage id={`${id}-error`} error={error} />
    </div>
  );
}

export function CheckField({
  id,
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  hint?: string | undefined;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
        className="mt-0.5 size-5 shrink-0 accent-[var(--color-text)]"
      />
      <span className="flex flex-col gap-0.5">
        <label htmlFor={id} className="t-ui">
          {label}
        </label>
        {hint ? (
          <span id={`${id}-hint`} className="text-sm leading-5 text-text-muted">
            {hint}
          </span>
        ) : null}
      </span>
    </div>
  );
}

/** Mensaje de un código de validación por campo (`required`, `increment`…). */
export function useFieldMessage(): (code: string | undefined) => string | undefined {
  const { t } = useT('admin');
  return (code) => {
    if (!code) return undefined;
    switch (code) {
      case 'required':
      case 'tooLong':
      case 'invalid':
      case 'increment':
      case 'slug':
      case 'taken':
      case 'range':
      case 'overlap':
      case 'same':
      case 'money':
        return t(`fields.${code}`);
      default:
        return t('fields.invalid');
    }
  };
}

// ─── Montos: el admin escribe unidades mayores; la API recibe la unidad menor ──

/** "8900" → 890000 (CRC, colones enteros); "17.80" o "17,80" → 1780 (USD). `null` si no es válido. */
export function toMinor(text: string, currency: CurrencyCode): number | null {
  const value = text.trim().replace(/\s/g, '');
  if (currency === 'CRC') return /^\d{1,9}$/.test(value) ? Number(value) * 100 : null;
  const match = /^(\d{1,7})(?:[.,](\d{1,2}))?$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}

/** 890000 → "8900" (CRC); 1780 → "17.80" (USD). Para rellenar los campos. */
export function fromMinor(minor: number, currency: CurrencyCode): string {
  if (currency === 'CRC') return String(Math.round(minor / 100));
  return (minor / 100).toFixed(2);
}

/** Fecha y hora cortas en el idioma de la página y la zona del local. */
export function useDateTime(): (iso: string) => string {
  const { i18n: instance } = useT('admin');
  return (iso) =>
    new Intl.DateTimeFormat(instance.language, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'America/Costa_Rica',
    }).format(new Date(iso));
}
