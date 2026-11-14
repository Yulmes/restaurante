import { data, Link } from 'react-router';
import { Localized } from '../catalog/components.tsx';
import { loadCatalog } from '../catalog/data.ts';
import { MenuBrowser } from '../catalog/MenuBrowser.tsx';
import { i18n } from '../i18n/config.ts';
import { localeFromPathname, pathForLocale } from '../i18n/locale.ts';
import { useLocale, useT } from '../i18n/use-locale.ts';
import { SiteLayout } from '../site/SiteLayout.tsx';
import { menuJsonLd, seoMeta } from '../site/seo.ts';
import type { Route } from './+types/categoria';

export async function loader({ request, params }: Route.LoaderArgs) {
  const catalog = await loadCatalog(localeFromPathname(new URL(request.url).pathname));
  const category = catalog.categories.find((c) => c.slug === params.categoria);
  // eslint-disable-next-line @typescript-eslint/only-throw-error -- React Router: lanzar data() responde 404.
  if (!category) throw data(null, { status: 404 });
  return { catalog, category };
}

export function meta({ location, loaderData }: Route.MetaArgs) {
  const locale = localeFromPathname(location.pathname);
  const t = i18n.getFixedT(locale, 'site');
  const name = loaderData.category.name.text;
  const firstImage = loaderData.category.products.find((p) => p.image?.provider === 'STATIC')?.image;
  return seoMeta({
    pathname: location.pathname,
    locale,
    title: `${name} · ${t('menu.metaTitle')}`,
    description: t('category.metaDescription', { name }),
    ...(firstImage ? { imageKey: firstImage.storageKey } : {}),
    jsonLd: menuJsonLd(loaderData.catalog, [loaderData.category]),
  });
}

export default function Categoria({ loaderData }: Route.ComponentProps) {
  const { t } = useT('site');
  const locale = useLocale();
  const { category } = loaderData;
  return (
    <SiteLayout>
      <div className="mx-auto flex max-w-7xl flex-col gap-10 px-4 pt-10 md:px-8 md:pt-14">
        <header className="flex max-w-3xl flex-col gap-3">
          <Link to={pathForLocale('/carta', locale)} className="self-start t-ui underline underline-offset-4">
            {t('menu.allCategories')}
          </Link>
          <h1 className="t-h1">
            <Localized value={category.name} />
          </h1>
          {category.description ? (
            <Localized value={category.description} as="p" className="t-body text-text-muted" />
          ) : null}
        </header>
        <MenuBrowser categories={[category]} showIndex={false} />
      </div>
    </SiteLayout>
  );
}
