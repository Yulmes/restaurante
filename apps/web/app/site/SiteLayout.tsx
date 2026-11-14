import { useEffect, useRef, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import { Logo } from '../components/brand/Logo.tsx';
import { TideLine } from '../components/brand/TideLine.tsx';
import { DemoBanner } from '../components/ui/DemoBanner.tsx';
import { LanguageSwitcher } from '../components/ui/LanguageSwitcher.tsx';
import { MAIN_ID, SkipLink } from '../components/ui/SkipLink.tsx';
import { pathForLocale } from '../i18n/locale.ts';
import { useLocale, useT } from '../i18n/use-locale.ts';

/**
 * Marco de las páginas públicas (M4, §3.5): barra superior sobria con el wordmark, Carta ·
 * Pesca del día · Nosotros · Ubicación y horario, Cuenta y el selector ES · EN. En el celular, un botón
 * abre una hoja a pantalla completa (`<dialog>`: foco atrapado y Escape). El botón
 * "Pedido · 2 · ₡18.500" llega con el carrito (M5).
 */
const LINKS = [
  { key: 'menu', path: '/carta' },
  { key: 'catch', path: '/#pesca-del-dia' },
  { key: 'about', path: '/nosotros' },
  { key: 'visit', path: '/visitanos' },
] as const;

function useLinks() {
  const locale = useLocale();
  const { t } = useT('site');
  return LINKS.map((link) => {
    const [path = '/', hash] = link.path.split('#');
    return {
      key: link.key,
      label: t(`nav.${link.key}`),
      to: `${pathForLocale(path, locale)}${hash ? `#${hash}` : ''}`,
    };
  });
}

function MobileMenu() {
  const { t } = useT('site');
  const locale = useLocale();
  const links = useLinks();
  const dialog = useRef<HTMLDialogElement>(null);
  const { pathname, hash } = useLocation();
  // Al navegar, la hoja se cierra.
  useEffect(() => {
    dialog.current?.close();
  }, [pathname, hash]);
  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        aria-haspopup="dialog"
        className="inline-flex min-h-11 items-center px-2 t-ui underline-offset-4 hover:underline"
      >
        {t('nav.open')}
      </button>
      <dialog
        ref={dialog}
        aria-label={t('nav.dialogLabel')}
        className="m-0 h-dvh max-h-none w-screen max-w-none bg-surface p-0 text-text backdrop:bg-tinta/40"
      >
        <div className="flex h-full flex-col gap-8 px-4 py-4">
          <div className="flex items-center justify-between">
            <Logo />
            <button
              type="button"
              onClick={() => dialog.current?.close()}
              className="inline-flex min-h-11 items-center px-2 t-ui underline underline-offset-4"
            >
              {t('nav.close')}
            </button>
          </div>
          <nav aria-label={t('nav.label')}>
            <ul className="flex flex-col">
              {links.map((link) => (
                <li key={link.key} className="border-b border-border">
                  <Link
                    to={link.to}
                    className="flex min-h-14 items-center font-display text-2xl font-semibold"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
              <li className="border-b border-border">
                <Link
                  to={pathForLocale('/cuenta', locale)}
                  className="flex min-h-14 items-center font-display text-2xl font-semibold"
                >
                  {t('nav.account')}
                </Link>
              </li>
            </ul>
          </nav>
          <LanguageSwitcher />
        </div>
      </dialog>
    </div>
  );
}

export function SiteHeader() {
  const { t } = useT('site');
  const locale = useLocale();
  const links = useLinks();
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur-[2px]">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 md:px-8">
        <Link to={pathForLocale('/', locale)} aria-label={t('nav.home')} className="shrink-0">
          <Logo size={32} />
        </Link>
        <nav aria-label={t('nav.label')} className="hidden md:block">
          <ul className="flex items-center gap-6">
            {links.map((link) => (
              <li key={link.key}>
                <NavLink
                  to={link.to}
                  end={link.key !== 'menu'}
                  className={({ isActive }) =>
                    `inline-flex min-h-11 items-center t-ui underline-offset-8 hover:underline ${
                      isActive && link.key !== 'catch' ? 'underline decoration-2' : ''
                    }`
                  }
                >
                  {link.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="hidden items-center gap-5 md:flex">
          <NavLink
            to={pathForLocale('/cuenta', locale)}
            className="inline-flex min-h-11 items-center t-ui underline-offset-8 hover:underline"
          >
            {t('nav.account')}
          </NavLink>
          <LanguageSwitcher />
        </div>
        <MobileMenu />
      </div>
    </header>
  );
}

export function SiteFooter() {
  const { t } = useT('site');
  const locale = useLocale();
  return (
    <footer className="mt-24 bg-surface-inverse text-text-inverse">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 md:grid-cols-12 md:px-8">
        <div className="flex flex-col gap-3 md:col-span-5">
          <Logo />
          <p className="t-body text-text-inverse-muted">{t('footer.demo')}</p>
        </div>
        <address className="flex flex-col gap-1 not-italic md:col-span-4">
          <span className="t-body">{t('footer.address')}</span>
          <span className="text-sm leading-6 text-text-inverse-muted">{t('footer.fictional')}</span>
          <Link
            to={pathForLocale('/visitanos', locale)}
            className="mt-2 inline-flex min-h-11 items-center t-ui underline underline-offset-4"
          >
            {t('footer.hours')}
          </Link>
        </address>
        <div className="flex flex-col gap-3 md:col-span-3">
          <p className="text-sm leading-6 text-text-inverse-muted">{t('footer.credits')}</p>
        </div>
      </div>
    </footer>
  );
}

/** Página pública: aviso de demostración, salto al contenido, barra, contenido y pie. */
export function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SkipLink />
      <DemoBanner />
      <SiteHeader />
      <main id={MAIN_ID} tabIndex={-1}>
        {children}
      </main>
      <SiteFooter />
    </>
  );
}

/** Divisor de sección con la línea de marea (§2.1). */
export function SectionDivider() {
  return (
    <div className="mx-auto max-w-7xl px-4 md:px-8">
      <TideLine className="text-border-strong" />
    </div>
  );
}
