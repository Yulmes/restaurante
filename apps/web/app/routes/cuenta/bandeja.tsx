import { demoInboxResponseSchema, sessionResponseSchema, type DemoInboxMessage } from '@marea-baja/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate } from 'react-router';
import { AccountShell } from '../../account/AccountShell.tsx';
import { ApiError, apiGet, apiSend } from '../../account/api.ts';
import { useLocalizedPath } from '../../account/links.ts';
import { accountMeta } from '../../account/meta.ts';
import { useApplySession } from '../../account/session.ts';
import { Button } from '../../components/ui/Button.tsx';
import { useLocale, useT } from '../../i18n/use-locale.ts';
import type { Route } from './+types/bandeja';

/**
 * Bandeja de demostración (M7, §8.5): los correos de la cuenta con su estado honesto. Los
 * `DEMO_ONLY` llevan el rótulo "este correo no se envió"; los `SENT`, a quién se enviaron. Nunca
 * muestra enlaces de un solo uso: la API no los devuelve.
 *
 * M10 (ADR 0010, D-M10-P1): en la demo pública, sin dominio, el correo de verificación de un
 * visitante no se envía. Si la API lo permite (`demoVerifiable`), el mensaje ofrece "Verificar
 * (demo)": verifica la propia cuenta sin mostrar ningún enlace ni token.
 */
const TOKEN_TEMPLATES = new Set(['email-verification', 'password-reset']);

export function meta({ location }: Route.MetaArgs) {
  return accountMeta(location.pathname, 'inbox.metaTitle');
}

export default function Bandeja() {
  const { t } = useT('account');
  const to = useLocalizedPath();
  const inbox = useQuery({
    queryKey: ['inbox'],
    queryFn: async () => (await apiGet('/api/me/notifications', demoInboxResponseSchema)).messages,
    retry: false,
  });

  if (inbox.isError && inbox.error instanceof ApiError && inbox.error.status === 401) {
    return <Navigate to={to('/cuenta/ingresar')} replace />;
  }
  return (
    <AccountShell title={t('inbox.title')} intro={t('inbox.intro')}>
      {inbox.isPending ? (
        <p role="status" className="t-body text-text-muted">
          {t('inbox.loading')}
        </p>
      ) : inbox.isError ? (
        <p role="alert" className="t-body text-danger">
          {t('inbox.error')}
        </p>
      ) : inbox.data.length === 0 ? (
        <p className="t-body">{t('inbox.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {inbox.data.map((message) => (
            <InboxMessage key={message.id} message={message} />
          ))}
        </ul>
      )}
    </AccountShell>
  );
}

function InboxMessage({ message }: { message: DemoInboxMessage }) {
  const { t } = useT('account');
  const locale = useLocale();
  const to = useLocalizedPath();
  const date = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Costa_Rica',
  });
  const status =
    message.status === 'SENT'
      ? t('inbox.status.SENT', { email: message.to })
      : t(`inbox.status.${message.status}`);
  const titleId = `inbox-${message.id}`;
  return (
    <li>
      <article
        aria-labelledby={titleId}
        data-status={message.status}
        className="flex flex-col gap-2 border border-border bg-surface-raised p-4"
      >
        <p
          className={
            message.status === 'DEMO_ONLY'
              ? 'self-start border border-text px-2 py-0.5 text-sm leading-5'
              : message.status === 'FAILED'
                ? 'text-sm leading-5 text-danger'
                : 'text-sm leading-5 break-words text-text-muted'
          }
        >
          {status}
        </p>
        <h2 id={titleId} className="t-ui break-words">
          {message.subject}
        </h2>
        <p className="text-sm leading-5 text-text-muted">
          {t('inbox.received', { date: date.format(new Date(message.createdAt)) })}
        </p>
        {message.body.map((paragraph, index) => (
          <p key={index} className="t-body">
            {paragraph}
          </p>
        ))}
        {TOKEN_TEMPLATES.has(message.template) ? (
          <p className="text-sm leading-5 text-text-muted">{t('inbox.linkHidden')}</p>
        ) : null}
        {message.demoVerifiable ? <DemoVerify /> : null}
        {message.orderId ? (
          <Link
            to={to(`/cuenta/pedidos/${message.orderId}`)}
            className="t-ui self-start underline underline-offset-4"
          >
            {t('inbox.openOrder')}
          </Link>
        ) : null}
      </article>
    </li>
  );
}

/** D-M10-P1: verificación de la propia cuenta desde la bandeja demo. */
function DemoVerify() {
  const { t } = useT('account');
  const client = useQueryClient();
  const applySession = useApplySession();
  const verify = useMutation({
    mutationFn: () => apiSend('POST', '/api/auth/demo-verify', {}, sessionResponseSchema),
    onSuccess: async (response) => {
      if (response) applySession(response);
      await client.invalidateQueries({ queryKey: ['inbox'] });
    },
  });
  return (
    <div className="flex flex-col items-start gap-2">
      <p className="text-sm leading-5 text-text-muted">{t('inbox.demoVerify.hint')}</p>
      <Button
        variant="secondary"
        onClick={() => {
          verify.mutate();
        }}
        loading={verify.isPending}
      >
        {verify.isPending ? t('inbox.demoVerify.pending') : t('inbox.demoVerify.action')}
      </Button>
      <div aria-live="polite">
        {verify.isSuccess ? <p className="t-body">{t('inbox.demoVerify.done')}</p> : null}
        {verify.isError ? (
          <p role="alert" className="t-body text-danger">
            {verify.error instanceof ApiError && verify.error.status === 429
              ? t('inbox.demoVerify.rateLimited')
              : t('inbox.demoVerify.error')}
          </p>
        ) : null}
      </div>
    </div>
  );
}
