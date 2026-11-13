import { zodResolver } from '@hookform/resolvers/zod';
import { loginRequestSchema, sessionResponseSchema } from '@marea-baja/shared';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import { AccountShell } from '../../account/AccountShell.tsx';
import { ApiError, apiSend } from '../../account/api.ts';
import { FormErrors, apiErrorMessage, fieldMessage, useAttempts } from '../../account/form.tsx';
import { useLocalizedPath } from '../../account/links.ts';
import { accountMeta } from '../../account/meta.ts';
import { useApplySession } from '../../account/session.ts';
import { TurnstileChallenge } from '../../account/Turnstile.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { TextField } from '../../components/ui/TextField.tsx';
import { useT } from '../../i18n/use-locale.ts';
import type { Route } from './+types/ingresar';

export function meta({ location }: Route.MetaArgs) {
  return accountMeta(location.pathname, 'signIn.metaTitle');
}

const FIELDS = ['email', 'password'] as const;

export default function Ingresar() {
  const { t } = useT('account');
  const to = useLocalizedPath();
  const navigate = useNavigate();
  const applySession = useApplySession();
  const [attempt, failed] = useAttempts();
  const [general, setGeneral] = useState<string | null>(null);
  // D8: el desafío aparece solo cuando la API lo pide; cada token sirve una vez.
  const [challenge, setChallenge] = useState(false);
  const [challengeKey, setChallengeKey] = useState(0);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

  const form = useForm({
    resolver: zodResolver(loginRequestSchema),
    mode: 'onBlur',
    reValidateMode: 'onBlur',
    // §3.4: al enviar con errores, el foco va al resumen, no al primer campo.
    shouldFocusError: false,
    defaultValues: { email: '', password: '' },
  });
  const { errors } = form.formState;

  const login = useMutation({
    mutationFn: (values: { email: string; password: string }) =>
      apiSend(
        'POST',
        '/api/auth/login',
        { ...values, ...(turnstileToken ? { turnstileToken } : {}) },
        sessionResponseSchema,
      ),
    onSuccess: (response) => {
      applySession(response);
      void navigate(to('/cuenta'));
    },
    onError: (error) => {
      if (error instanceof ApiError && error.challengeRequired) {
        setChallenge(true);
        setTurnstileToken(null);
        setChallengeKey((k) => k + 1);
      }
      setGeneral(apiErrorMessage(t, error));
      failed();
    },
  });

  const onSubmit = form.handleSubmit(
    (values) => {
      setGeneral(null);
      login.mutate(values);
    },
    () => {
      setGeneral(null);
      failed();
    },
  );

  return (
    <AccountShell title={t('signIn.title')} intro={t('signIn.intro')}>
      <FormErrors errors={errors} order={FIELDS} general={general} attempt={attempt} idPrefix="login" />
      <form
        id="login-form"
        noValidate
        onSubmit={(event) => void onSubmit(event)}
        className="flex flex-col gap-5"
      >
        <TextField
          id="login-email"
          label={t('fields.email')}
          type="email"
          autoComplete="email"
          inputMode="email"
          error={errors.email?.message ? fieldMessage(t, errors.email.message) : undefined}
          {...form.register('email')}
        />
        <TextField
          id="login-password"
          label={t('fields.password')}
          type="password"
          autoComplete="current-password"
          error={errors.password?.message ? fieldMessage(t, errors.password.message) : undefined}
          {...form.register('password')}
        />
        {challenge ? <TurnstileChallenge key={challengeKey} onToken={setTurnstileToken} /> : null}
        <div className="flex flex-col items-start gap-4">
          <Button type="submit" loading={login.isPending}>
            {t('signIn.submit')}
          </Button>
          <Link to={to('/cuenta/recuperar')} className="t-ui underline underline-offset-4">
            {t('signIn.forgot')}
          </Link>
        </div>
      </form>
      <p className="t-body text-text-muted">
        {t('signIn.noAccount')}{' '}
        <Link to={to('/cuenta/registro')} className="text-text underline underline-offset-4">
          {t('signIn.register')}
        </Link>
      </p>
    </AccountShell>
  );
}
