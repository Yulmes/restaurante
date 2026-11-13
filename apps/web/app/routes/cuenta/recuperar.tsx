import { zodResolver } from '@hookform/resolvers/zod';
import { forgotPasswordRequestSchema } from '@marea-baja/shared';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { AccountShell, StatusMessage } from '../../account/AccountShell.tsx';
import { apiSend } from '../../account/api.ts';
import { FormErrors, apiErrorMessage, fieldMessage, useAttempts } from '../../account/form.tsx';
import { useLocalizedPath } from '../../account/links.ts';
import { accountMeta } from '../../account/meta.ts';
import { Button } from '../../components/ui/Button.tsx';
import { TextField } from '../../components/ui/TextField.tsx';
import { useT } from '../../i18n/use-locale.ts';
import type { Route } from './+types/recuperar';

export function meta({ location }: Route.MetaArgs) {
  return accountMeta(location.pathname, 'forgot.metaTitle');
}

const FIELDS = ['email'] as const;

/** La respuesta es siempre la misma: nunca revela si el correo tiene cuenta (§8.4). */
export default function Recuperar() {
  const { t } = useT('account');
  const to = useLocalizedPath();
  const [attempt, failed] = useAttempts();
  const [general, setGeneral] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const form = useForm({
    resolver: zodResolver(forgotPasswordRequestSchema),
    mode: 'onBlur',
    reValidateMode: 'onBlur',
    // §3.4: al enviar con errores, el foco va al resumen, no al primer campo.
    shouldFocusError: false,
    defaultValues: { email: '' },
  });
  const { errors } = form.formState;
  const forgot = useMutation({
    mutationFn: (values: { email: string }) =>
      apiSend('POST', '/api/auth/forgot-password', values).then(() => values.email),
    onSuccess: (email) => {
      setSentTo(email);
    },
    onError: (error) => {
      setGeneral(apiErrorMessage(t, error));
      failed();
    },
  });
  const onSubmit = form.handleSubmit(
    (values) => {
      setGeneral(null);
      forgot.mutate(values);
    },
    () => {
      failed();
    },
  );

  const back = (
    <p>
      <Link to={to('/cuenta/ingresar')} className="t-ui underline underline-offset-4">
        {t('forgot.back')}
      </Link>
    </p>
  );

  if (sentTo) {
    return (
      <AccountShell title={t('forgot.doneTitle')}>
        <StatusMessage tone="success">{t('forgot.doneBody', { email: sentTo })}</StatusMessage>
        {back}
      </AccountShell>
    );
  }

  return (
    <AccountShell title={t('forgot.title')} intro={t('forgot.intro')}>
      <FormErrors errors={errors} order={FIELDS} general={general} attempt={attempt} idPrefix="forgot" />
      <form
        id="forgot-form"
        noValidate
        onSubmit={(event) => void onSubmit(event)}
        className="flex flex-col gap-5"
      >
        <TextField
          id="forgot-email"
          label={t('fields.email')}
          type="email"
          autoComplete="email"
          inputMode="email"
          error={errors.email?.message ? fieldMessage(t, errors.email.message) : undefined}
          {...form.register('email')}
        />
        <div>
          <Button type="submit" loading={forgot.isPending}>
            {t('forgot.submit')}
          </Button>
        </div>
      </form>
      {back}
    </AccountShell>
  );
}
