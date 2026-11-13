import { zodResolver } from '@hookform/resolvers/zod';
import { registerRequestSchema } from '@marea-baja/shared';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { AccountShell, StatusMessage } from '../../account/AccountShell.tsx';
import { apiSend } from '../../account/api.ts';
import {
  FormErrors,
  apiErrorMessage,
  applyServerFieldErrors,
  fieldMessage,
  useAttempts,
} from '../../account/form.tsx';
import { useLocalizedPath } from '../../account/links.ts';
import { accountMeta } from '../../account/meta.ts';
import { Button } from '../../components/ui/Button.tsx';
import { TextField } from '../../components/ui/TextField.tsx';
import { useLocale, useT } from '../../i18n/use-locale.ts';
import type { Route } from './+types/registro';

export function meta({ location }: Route.MetaArgs) {
  return accountMeta(location.pathname, 'register.metaTitle');
}

const FIELDS = ['name', 'email', 'password'] as const;

export default function Registro() {
  const { t } = useT('account');
  const to = useLocalizedPath();
  const locale = useLocale();
  const [attempt, failed] = useAttempts();
  const [general, setGeneral] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const form = useForm({
    resolver: zodResolver(registerRequestSchema),
    mode: 'onBlur',
    reValidateMode: 'onBlur',
    // §3.4: al enviar con errores, el foco va al resumen, no al primer campo.
    shouldFocusError: false,
    // D2: el idioma de la cuenta es el de la página donde se registra; se cambia en el perfil.
    defaultValues: { name: '', email: '', password: '', locale },
  });
  const { errors } = form.formState;

  const register = useMutation({
    mutationFn: (values: { name: string; email: string; password: string; locale: 'es-CR' | 'en' }) =>
      apiSend('POST', '/api/auth/register', values).then(() => values.email),
    onSuccess: (email) => {
      setSentTo(email);
    },
    onError: (error) => {
      if (!applyServerFieldErrors(error, form.setError, FIELDS)) setGeneral(apiErrorMessage(t, error));
      failed();
    },
  });

  const onSubmit = form.handleSubmit(
    (values) => {
      setGeneral(null);
      register.mutate({ ...values, locale });
    },
    () => {
      setGeneral(null);
      failed();
    },
  );

  if (sentTo) {
    return (
      <AccountShell title={t('register.doneTitle')}>
        <StatusMessage tone="success">
          <p>{t('register.doneBody', { email: sentTo })}</p>
          <p className="mt-2">{t('register.doneNext')}</p>
        </StatusMessage>
        <p>
          <Link to={to('/cuenta/ingresar')} className="t-ui underline underline-offset-4">
            {t('nav.signIn')}
          </Link>
        </p>
      </AccountShell>
    );
  }

  return (
    <AccountShell title={t('register.title')} intro={t('register.intro')}>
      <FormErrors errors={errors} order={FIELDS} general={general} attempt={attempt} idPrefix="register" />
      <form
        id="register-form"
        noValidate
        onSubmit={(event) => void onSubmit(event)}
        className="flex flex-col gap-5"
      >
        <TextField
          id="register-name"
          label={t('fields.name')}
          hint={t('fields.nameHint')}
          autoComplete="name"
          error={errors.name?.message ? fieldMessage(t, errors.name.message) : undefined}
          {...form.register('name')}
        />
        <TextField
          id="register-email"
          label={t('fields.email')}
          type="email"
          autoComplete="email"
          inputMode="email"
          error={errors.email?.message ? fieldMessage(t, errors.email.message) : undefined}
          {...form.register('email')}
        />
        <TextField
          id="register-password"
          label={t('fields.password')}
          hint={t('fields.passwordHint')}
          type="password"
          autoComplete="new-password"
          error={errors.password?.message ? fieldMessage(t, errors.password.message) : undefined}
          {...form.register('password')}
        />
        <div>
          <Button type="submit" loading={register.isPending}>
            {t('register.submit')}
          </Button>
        </div>
      </form>
      <p className="t-body text-text-muted">
        {t('register.haveAccount')}{' '}
        <Link to={to('/cuenta/ingresar')} className="text-text underline underline-offset-4">
          {t('register.signIn')}
        </Link>
      </p>
    </AccountShell>
  );
}
