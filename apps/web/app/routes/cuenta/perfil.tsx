import { zodResolver } from '@hookform/resolvers/zod';
import {
  SUPPORTED_LOCALES,
  changePasswordRequestSchema,
  meResponseSchema,
  sessionResponseSchema,
  updateProfileRequestSchema,
  type PublicUser,
} from '@marea-baja/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
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
import { ME_QUERY_KEY, useApplySession, useClearSession, useMe } from '../../account/session.ts';
import { Button } from '../../components/ui/Button.tsx';
import { TextField } from '../../components/ui/TextField.tsx';
import { pathForLocale } from '../../i18n/locale.ts';
import { useLocale, useT } from '../../i18n/use-locale.ts';
import type { Route } from './+types/perfil';

export function meta({ location }: Route.MetaArgs) {
  return accountMeta(location.pathname, 'profile.metaTitle');
}

export default function Perfil() {
  const { t } = useT('account');
  const { t: tc } = useT();
  const to = useLocalizedPath();
  const me = useMe();

  if (me.isPending) {
    return (
      <AccountShell title={t('profile.title')}>
        <p role="status" className="t-body text-text-muted">
          {tc('loading')}
        </p>
      </AccountShell>
    );
  }
  if (me.isError) {
    return (
      <AccountShell title={t('profile.title')}>
        <p role="alert" className="t-body text-danger">
          {apiErrorMessage(t, me.error)}
        </p>
      </AccountShell>
    );
  }
  if (!me.data) return <Navigate to={to('/cuenta/ingresar')} replace />;
  return <Profile user={me.data} />;
}

function Profile({ user }: { user: PublicUser }) {
  const { t } = useT('account');
  const { t: tc } = useT();
  const to = useLocalizedPath();
  return (
    <AccountShell title={t('profile.title')}>
      <div className="flex flex-col gap-2">
        <p className="t-body">{t('profile.signedInAs', { email: user.email })}</p>
        {user.emailVerified ? (
          <p className="t-ui text-text">{t('profile.verifiedStatus')}</p>
        ) : (
          <p className="t-body">
            {t('profile.unverifiedStatus')}{' '}
            <Link to={to('/cuenta/verificar')} className="underline underline-offset-4">
              {t('verify.resend')}
            </Link>
          </p>
        )}
      </div>
      <DetailsForm user={user} localeLabel={(locale) => tc(`language.name.${locale}`)} />
      <PasswordForm />
      <SessionsSection />
    </AccountShell>
  );
}

const DETAIL_FIELDS = ['name', 'phone'] as const;

function DetailsForm({
  user,
  localeLabel,
}: {
  user: PublicUser;
  localeLabel: (locale: PublicUser['locale']) => string;
}) {
  const { t } = useT('account');
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const pageLocale = useLocale();
  const [attempt, failed] = useAttempts();
  const [general, setGeneral] = useState<string | null>(null);
  // Tras cambiar el idioma, la página se abre en el nuevo y conserva el aviso de guardado.
  const savedBeforeSwitch = (location.state as { profileSaved?: boolean } | null)?.profileSaved === true;
  const form = useForm({
    resolver: zodResolver(updateProfileRequestSchema),
    mode: 'onBlur',
    reValidateMode: 'onBlur',
    // §3.4: al enviar con errores, el foco va al resumen, no al primer campo.
    shouldFocusError: false,
    defaultValues: { name: user.name, phone: user.phone ?? '', locale: user.locale },
  });
  const { errors } = form.formState;
  const save = useMutation({
    mutationFn: (values: { name: string; phone?: string | null | undefined; locale: PublicUser['locale'] }) =>
      apiSend('PATCH', '/api/account/profile', values, meResponseSchema),
    onSuccess: (response) => {
      if (!response) return;
      queryClient.setQueryData(ME_QUERY_KEY, response.user);
      // El idioma guardado se aplica en el acto: misma página, en el idioma elegido.
      if (response.user.locale !== pageLocale) {
        void navigate(pathForLocale(location.pathname, response.user.locale), {
          replace: true,
          state: { profileSaved: true },
        });
      }
    },
    onError: (error) => {
      if (!applyServerFieldErrors(error, form.setError, DETAIL_FIELDS)) setGeneral(apiErrorMessage(t, error));
      failed();
    },
  });
  const onSubmit = form.handleSubmit(
    (values) => {
      setGeneral(null);
      save.mutate(values);
    },
    () => {
      failed();
    },
  );
  return (
    <section aria-labelledby="details-title" className="flex flex-col gap-4 border-t border-border pt-6">
      <h2 id="details-title" className="t-h2">
        {t('profile.detailsTitle')}
      </h2>
      <FormErrors
        errors={errors}
        order={DETAIL_FIELDS}
        general={general}
        attempt={attempt}
        idPrefix="profile"
      />
      <form
        id="profile-form"
        noValidate
        onSubmit={(event) => void onSubmit(event)}
        className="flex flex-col gap-5"
      >
        <TextField
          id="profile-name"
          label={t('fields.name')}
          autoComplete="name"
          error={errors.name?.message ? fieldMessage(t, errors.name.message) : undefined}
          {...form.register('name')}
        />
        <TextField
          id="profile-phone"
          label={t('fields.phone')}
          hint={t('fields.phoneHint')}
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          error={errors.phone?.message ? fieldMessage(t, errors.phone.message) : undefined}
          {...form.register('phone')}
        />
        <fieldset className="flex flex-col gap-2">
          <legend className="t-ui text-text">{t('fields.locale')}</legend>
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            {SUPPORTED_LOCALES.map((locale) => (
              <label key={locale} className="inline-flex min-h-11 cursor-pointer items-center gap-2 t-body">
                <input
                  type="radio"
                  value={locale}
                  className="size-5 accent-tinta"
                  {...form.register('locale')}
                />
                <span lang={locale}>{localeLabel(locale)}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-col items-start gap-3">
          <Button type="submit" loading={save.isPending}>
            {t('profile.save')}
          </Button>
          {save.isSuccess || savedBeforeSwitch ? (
            <StatusMessage tone="success">{t('profile.saved')}</StatusMessage>
          ) : null}
        </div>
      </form>
    </section>
  );
}

const PASSWORD_FIELDS = ['currentPassword', 'newPassword'] as const;

function PasswordForm() {
  const { t } = useT('account');
  const applySession = useApplySession();
  const [attempt, failed] = useAttempts();
  const [general, setGeneral] = useState<string | null>(null);
  const form = useForm({
    resolver: zodResolver(changePasswordRequestSchema),
    mode: 'onBlur',
    reValidateMode: 'onBlur',
    // §3.4: al enviar con errores, el foco va al resumen, no al primer campo.
    shouldFocusError: false,
    defaultValues: { currentPassword: '', newPassword: '' },
  });
  const { errors } = form.formState;
  const change = useMutation({
    mutationFn: (values: { currentPassword: string; newPassword: string }) =>
      apiSend('POST', '/api/account/password', values, sessionResponseSchema),
    onSuccess: (response) => {
      applySession(response);
      form.reset();
    },
    onError: (error) => {
      if (!applyServerFieldErrors(error, form.setError, PASSWORD_FIELDS))
        setGeneral(apiErrorMessage(t, error));
      failed();
    },
  });
  const onSubmit = form.handleSubmit(
    (values) => {
      setGeneral(null);
      change.mutate(values);
    },
    () => {
      failed();
    },
  );
  return (
    <section aria-labelledby="password-title" className="flex flex-col gap-4 border-t border-border pt-6">
      <h2 id="password-title" className="t-h2">
        {t('profile.passwordTitle')}
      </h2>
      <p className="t-body text-text-muted">{t('profile.passwordIntro')}</p>
      <FormErrors
        errors={errors}
        order={PASSWORD_FIELDS}
        general={general}
        attempt={attempt}
        idPrefix="password"
      />
      <form
        id="password-form"
        noValidate
        onSubmit={(event) => void onSubmit(event)}
        className="flex flex-col gap-5"
      >
        <TextField
          id="password-currentPassword"
          label={t('fields.currentPassword')}
          type="password"
          autoComplete="current-password"
          error={
            errors.currentPassword?.message ? fieldMessage(t, errors.currentPassword.message) : undefined
          }
          {...form.register('currentPassword')}
        />
        <TextField
          id="password-newPassword"
          label={t('fields.newPassword')}
          hint={t('fields.passwordHint')}
          type="password"
          autoComplete="new-password"
          error={errors.newPassword?.message ? fieldMessage(t, errors.newPassword.message) : undefined}
          {...form.register('newPassword')}
        />
        <div className="flex flex-col items-start gap-3">
          <Button type="submit" variant="secondary" loading={change.isPending}>
            {t('profile.passwordSubmit')}
          </Button>
          {change.isSuccess ? (
            <StatusMessage tone="success">{t('profile.passwordSaved')}</StatusMessage>
          ) : null}
        </div>
      </form>
    </section>
  );
}

function SessionsSection() {
  const { t } = useT('account');
  const to = useLocalizedPath();
  const navigate = useNavigate();
  const clearSession = useClearSession();
  const leave = () => {
    clearSession();
    void navigate(to('/cuenta/ingresar'));
  };
  const logout = useMutation({ mutationFn: () => apiSend('POST', '/api/auth/logout', {}), onSuccess: leave });
  const logoutAll = useMutation({
    mutationFn: () => apiSend('POST', '/api/auth/logout-all', {}),
    onSuccess: leave,
  });
  const error = logout.error ?? logoutAll.error;
  return (
    <section aria-labelledby="sessions-title" className="flex flex-col gap-4 border-t border-border pt-6">
      <h2 id="sessions-title" className="t-h2">
        {t('profile.sessionsTitle')}
      </h2>
      <div className="flex flex-col items-start gap-4">
        <Button
          variant="secondary"
          loading={logout.isPending}
          onClick={() => {
            logout.mutate();
          }}
        >
          {t('profile.signOut')}
        </Button>
        <div className="flex flex-col items-start gap-1.5">
          <Button
            variant="danger"
            loading={logoutAll.isPending}
            onClick={() => {
              logoutAll.mutate();
            }}
          >
            {t('profile.signOutAll')}
          </Button>
          <span className="t-ui text-text-muted">{t('profile.signOutAllHint')}</span>
        </div>
        {error ? (
          <p role="alert" className="t-body text-danger">
            {apiErrorMessage(t, error)}
          </p>
        ) : null}
      </div>
    </section>
  );
}
