import { publicUserSchema, sessionResponseSchema } from '@marea-baja/shared';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { z } from 'zod';
import { AccountShell, StatusMessage } from '../../account/AccountShell.tsx';
import { apiSend } from '../../account/api.ts';
import { apiErrorMessage } from '../../account/form.tsx';
import { tokenFromHash, useLocalizedPath } from '../../account/links.ts';
import { accountMeta } from '../../account/meta.ts';
import { useApplySession, useMe } from '../../account/session.ts';
import { Button } from '../../components/ui/Button.tsx';
import { useT } from '../../i18n/use-locale.ts';
import type { Route } from './+types/verificar';

export function meta({ location }: Route.MetaArgs) {
  return accountMeta(location.pathname, 'verify.metaTitle');
}

/** Con sesión del mismo usuario, la API rota la sesión y devuelve el token CSRF nuevo. */
const verifyResponseSchema = z.union([sessionResponseSchema, z.object({ user: publicUserSchema })]);

/**
 * Confirmación del correo. Con `#token=…` la confirma; sin token y con una sesión sin verificar,
 * muestra la pantalla de verificación con el botón de reenvío (§7.5), sujeto a los límites (§8.4).
 */
export default function Verificar() {
  const { t } = useT('account');
  const to = useLocalizedPath();
  const { hash } = useLocation();
  const [token] = useState(() => tokenFromHash(hash));
  const me = useMe();
  const applySession = useApplySession();
  const started = useRef(false);

  const verify = useMutation({
    mutationFn: (value: string) =>
      apiSend('POST', '/api/auth/verify-email', { token: value }, verifyResponseSchema),
    onSuccess: (response) => {
      if (response && 'csrfToken' in response) applySession(response);
      else void me.refetch();
    },
  });
  const resend = useMutation({ mutationFn: () => apiSend('POST', '/api/auth/resend-verification', {}) });

  useEffect(() => {
    if (token && !started.current) {
      started.current = true;
      // El token sale de la barra de direcciones apenas se usa.
      window.history.replaceState(null, '', window.location.pathname);
      verify.mutate(token);
    }
  }, [token, verify]);

  const user = me.data;
  const resendBlock =
    user && !user.emailVerified ? (
      <div className="flex flex-col items-start gap-3">
        <Button
          variant="secondary"
          loading={resend.isPending}
          onClick={() => {
            resend.mutate();
          }}
        >
          {t('verify.resend')}
        </Button>
        {resend.isSuccess ? <StatusMessage>{t('verify.resent')}</StatusMessage> : null}
        {resend.isError ? (
          <p role="alert" className="t-body text-danger">
            {apiErrorMessage(t, resend.error)}
          </p>
        ) : null}
      </div>
    ) : null;

  if (token) {
    if (verify.isSuccess) {
      return (
        <AccountShell title={t('verify.successTitle')}>
          <StatusMessage tone="success">{t('verify.successBody')}</StatusMessage>
          <p>
            <Link
              to={to(user ? '/cuenta' : '/cuenta/ingresar')}
              className="t-ui underline underline-offset-4"
            >
              {user ? t('verify.goToAccount') : t('nav.signIn')}
            </Link>
          </p>
        </AccountShell>
      );
    }
    if (verify.isError) {
      return (
        <AccountShell title={t('verify.title')}>
          <p role="alert" className="t-body text-danger">
            {apiErrorMessage(t, verify.error)}
          </p>
          <p className="t-body">{t('verify.failedBody')}</p>
          {resendBlock ?? (
            <p>
              <Link to={to('/cuenta/ingresar')} className="t-ui underline underline-offset-4">
                {t('nav.signIn')}
              </Link>
            </p>
          )}
        </AccountShell>
      );
    }
    return (
      <AccountShell title={t('verify.title')}>
        <p role="status" className="t-body">
          {t('verify.checking')}
        </p>
      </AccountShell>
    );
  }

  return (
    <AccountShell title={t('verify.title')}>
      <p className="t-body">
        {user && !user.emailVerified ? t('verify.pendingBody', { email: user.email }) : t('verify.noToken')}
      </p>
      {resendBlock}
    </AccountShell>
  );
}
