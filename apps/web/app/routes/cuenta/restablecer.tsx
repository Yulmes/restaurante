import { zodResolver } from '@hookform/resolvers/zod';
import { newPasswordSchema } from '@marea-baja/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation } from 'react-router';
import { z } from 'zod';
import { AccountShell, StatusMessage } from '../../account/AccountShell.tsx';
import { ApiError, apiSend, rememberCsrfToken } from '../../account/api.ts';
import {
  FormErrors,
  apiErrorMessage,
  applyServerFieldErrors,
  fieldMessage,
  useAttempts,
} from '../../account/form.tsx';
import { tokenFromHash, useLocalizedPath } from '../../account/links.ts';
import { accountMeta } from '../../account/meta.ts';
import { ME_QUERY_KEY } from '../../account/session.ts';
import { Button } from '../../components/ui/Button.tsx';
import { TextField } from '../../components/ui/TextField.tsx';
import { useT } from '../../i18n/use-locale.ts';
import type { Route } from './+types/restablecer';

export function meta({ location }: Route.MetaArgs) {
  return accountMeta(location.pathname, 'reset.metaTitle');
}

const FIELDS = ['password'] as const;
const schema = z.object({ password: newPasswordSchema });

export default function Restablecer() {
  const { t } = useT('account');
  const to = useLocalizedPath();
  const { hash } = useLocation();
  const queryClient = useQueryClient();
  const [token] = useState(() => tokenFromHash(hash));
  const [attempt, failed] = useAttempts();
  const [general, setGeneral] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    // El token se conserva en memoria y sale de la barra de direcciones.
    if (token) window.history.replaceState(null, '', window.location.pathname);
  }, [token]);

  const form = useForm({
    resolver: zodResolver(schema),
    mode: 'onBlur',
    reValidateMode: 'onBlur',
    // §3.4: al enviar con errores, el foco va al resumen, no al primer campo.
    shouldFocusError: false,
    defaultValues: { password: '' },
  });
  const { errors } = form.formState;

  const reset = useMutation({
    mutationFn: (password: string) => apiSend('POST', '/api/auth/reset-password', { token, password }),
    onSuccess: () => {
      // La API revocó todas las sesiones, también la de este navegador.
      rememberCsrfToken(null);
      queryClient.setQueryData(ME_QUERY_KEY, null);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'INVALID_OR_EXPIRED_TOKEN') setExpired(true);
      if (!applyServerFieldErrors(error, form.setError, FIELDS)) setGeneral(apiErrorMessage(t, error));
      failed();
    },
  });

  const onSubmit = form.handleSubmit(
    (values) => {
      setGeneral(null);
      reset.mutate(values.password);
    },
    () => {
      failed();
    },
  );

  if (reset.isSuccess) {
    return (
      <AccountShell title={t('reset.doneTitle')}>
        <StatusMessage tone="success">{t('reset.doneBody')}</StatusMessage>
        <p>
          <Link to={to('/cuenta/ingresar')} className="t-ui underline underline-offset-4">
            {t('nav.signIn')}
          </Link>
        </p>
      </AccountShell>
    );
  }

  const requestNew = (
    <p>
      <Link to={to('/cuenta/recuperar')} className="t-ui underline underline-offset-4">
        {t('reset.requestNew')}
      </Link>
    </p>
  );

  if (!token) {
    return (
      <AccountShell title={t('reset.title')}>
        <p className="t-body">{t('reset.noToken')}</p>
        {requestNew}
      </AccountShell>
    );
  }

  return (
    <AccountShell title={t('reset.title')} intro={t('reset.intro')}>
      <FormErrors
        errors={errors}
        order={FIELDS}
        general={general}
        attempt={attempt}
        idPrefix="reset"
        labels={{ password: t('fields.newPassword') }}
      />
      <form
        id="reset-form"
        noValidate
        onSubmit={(event) => void onSubmit(event)}
        className="flex flex-col gap-5"
      >
        <TextField
          id="reset-password"
          label={t('fields.newPassword')}
          hint={t('fields.passwordHint')}
          type="password"
          autoComplete="new-password"
          error={errors.password?.message ? fieldMessage(t, errors.password.message) : undefined}
          {...form.register('password')}
        />
        <div>
          <Button type="submit" loading={reset.isPending}>
            {t('reset.submit')}
          </Button>
        </div>
      </form>
      {expired ? requestNew : null}
    </AccountShell>
  );
}
