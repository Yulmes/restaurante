import { loadCatalog } from '../catalog/data.ts';
import { MenuBrowser } from '../catalog/MenuBrowser.tsx';
import { i18n } from '../i18n/config.ts';
import { localeFromPathname } from '../i18n/locale.ts';
import { useT } from '../i18n/use-locale.ts';
import { SiteLayout } from '../site/SiteLayout.tsx';
import { menuJsonLd, seoMeta } from '../site/seo.ts';
import type { Route } from './+types/carta';

export async function loader({ request }: Route.LoaderArgs) {
  return { catalog: await loadCatalog(localeFromPathname(new URL(request.url).pathname)) };
}

export function meta({ location, loaderData }: Route.MetaArgs) {
  const locale = localeFromPathname(location.pathname);
  const t = i18n.getFixedT(locale, 'site');
  return seoMeta({
    pathname: location.pathname,
    locale,
    title: t('menu.metaTitle'),
    description: t('menu.metaDescription'),
    jsonLd: menuJsonLd(loaderData.catalog, loaderData.catalog.categories),
  });
}

/** Carta completa (§2.4: elegir rápido; lo primero, nombre y precio por categoría). */
export default function Carta({ loaderData }: Route.ComponentProps) {
  const { t } = useT('site');
  return (
    <SiteLayout>
      <div className="mx-auto flex max-w-7xl flex-col gap-10 px-4 pt-10 md:px-8 md:pt-14">
        <header className="flex max-w-3xl flex-col gap-3">
          <h1 className="t-h1">{t('menu.title')}</h1>
          <p className="t-body text-text-muted">{t('menu.intro')}</p>
        </header>
        <MenuBrowser categories={loaderData.catalog.categories} />
      </div>
    </SiteLayout>
  );
}
