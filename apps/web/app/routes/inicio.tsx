import { Link } from 'react-router';
import { Logo } from '../components/brand/Logo.tsx';
import { TideLine } from '../components/brand/TideLine.tsx';
import { DemoBanner } from '../components/ui/DemoBanner.tsx';
import { LanguageSwitcher } from '../components/ui/LanguageSwitcher.tsx';
import { MAIN_ID, SkipLink } from '../components/ui/SkipLink.tsx';
import { i18n } from '../i18n/config.ts';
import { localeFromPathname, pathForLocale } from '../i18n/locale.ts';
import { useLocation } from 'react-router';
import { useT } from '../i18n/use-locale.ts';
import type { Route } from './+types/inicio';

export function meta({ location }: Route.MetaArgs) {
  const t = i18n.getFixedT(localeFromPathname(location.pathname), 'common');
  return [{ title: t('home.metaTitle') }, { name: 'robots', content: 'noindex' }];
}

/** Portada provisional de M1. La portada real (hero, carta, pesca del día) es de M4. */
export default function Inicio() {
  const { t } = useT();
  const { pathname } = useLocation();
  return (
    <>
      <SkipLink />
      <DemoBanner />
      <header className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 md:px-8">
        <Logo />
        <LanguageSwitcher />
      </header>
      <main id={MAIN_ID} tabIndex={-1} className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-16 md:px-8">
        <h1 className="t-display">{t('slogan')}</h1>
        <p className="t-body-lg text-text-muted">{t('home.underConstruction')}</p>
        <p>
          <Link
            to={pathForLocale(`/_design`, localeFromPathname(pathname))}
            className="t-ui underline underline-offset-4"
          >
            {t('home.designLink')}
          </Link>
        </p>
        <TideLine className="text-text-muted" />
      </main>
    </>
  );
}
