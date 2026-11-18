import { Link } from 'react-router';
import { CatchBoard, DietaryTags, DishPicture, Localized, PagePicture } from '../catalog/components.tsx';
import {
  FEATURED_PRODUCT_SLUG,
  liveProduct,
  loadCatalog,
  loadOpeningHours,
  useLiveCatalog,
} from '../catalog/data.ts';
import { PAGE_PHOTOS, HALF_COLUMN_SIZES } from '../catalog/images.ts';
import { buttonClassName } from '../components/ui/Button.tsx';
import { Price } from '../components/ui/Price.tsx';
import { Tag } from '../components/ui/Tag.tsx';
import { i18n } from '../i18n/config.ts';
import { localeFromPathname, pathForLocale } from '../i18n/locale.ts';
import { useLocale, useT } from '../i18n/use-locale.ts';
import { SectionDivider, SiteLayout } from '../site/SiteLayout.tsx';
import { restaurantJsonLd, seoMeta } from '../site/seo.ts';
import type { Route } from './+types/inicio';

/** Se ejecuta en el build (prerender, §4.2). */
export async function loader({ request }: Route.LoaderArgs) {
  const locale = localeFromPathname(new URL(request.url).pathname);
  const [catalog, hours] = await Promise.all([loadCatalog(locale), loadOpeningHours()]);
  return { catalog, hours };
}

export function meta({ location, loaderData }: Route.MetaArgs) {
  const locale = localeFromPathname(location.pathname);
  const t = i18n.getFixedT(locale, 'site');
  return seoMeta({
    pathname: location.pathname,
    locale,
    title: t('home.metaTitle'),
    description: t('home.metaDescription'),
    imageKey: PAGE_PHOTOS.brand,
    jsonLd: restaurantJsonLd(locale, loaderData.hours),
  });
}

/**
 * Portada (§2.4): lo primero que se lee es la pesca del día y el plato de la casa. Sin hero
 * genérico, sin tarjetas de "beneficios" ni testimonios.
 */
export default function Inicio({ loaderData }: Route.ComponentProps) {
  const { t } = useT('site');
  const { t: tc } = useT();
  const locale = useLocale();
  const { catalog } = loaderData;
  const live = useLiveCatalog(locale);
  const featured = catalog.categories
    .flatMap((category) => category.products.map((product) => ({ category, product })))
    .find((entry) => entry.product.slug === FEATURED_PRODUCT_SLUG);
  const current = featured ? liveProduct(featured.product, live.data) : null;

  return (
    <SiteLayout>
      <section className="mx-auto grid max-w-7xl gap-10 px-4 pt-10 pb-14 md:grid-cols-12 md:px-8 md:pt-16">
        <div className="flex flex-col justify-center gap-5 md:col-span-5">
          <p className="t-ui text-text-muted">{t('home.eyebrow')}</p>
          <h1 className="t-display">{tc('slogan')}</h1>
          <p className="t-body-lg text-text-muted">{t('home.lead')}</p>
          <div>
            <Link to={pathForLocale('/carta', locale)} className={buttonClassName()}>
              {t('home.ctaMenu')}
            </Link>
          </div>
        </div>
        {featured && current ? (
          <article className="md:col-span-6 md:col-start-7" aria-labelledby="plato-de-la-casa">
            {featured.product.image ? (
              <DishPicture image={featured.product.image} sizes={HALF_COLUMN_SIZES} priority />
            ) : null}
            <div className="flex flex-col gap-2 border-b border-border py-4">
              <p className="t-ui text-text-muted">{t('home.featuredLabel')}</p>
              <div className="flex items-baseline justify-between gap-4">
                <h2 id="plato-de-la-casa" className="t-h3">
                  <span translate="no">{featured.product.name}</span>
                </h2>
                <span className={current.isAvailable ? '' : 'text-text-muted line-through'}>
                  <Price amountMinor={current.basePriceMinor} />
                </span>
              </div>
              <Localized value={featured.product.description} as="p" className="t-body text-text-muted" />
              <div className="flex flex-wrap gap-2">
                {current.isAvailable ? null : <Tag variant="muted">{tc('tags.soldOutToday')}</Tag>}
                <DietaryTags tags={featured.product.tags} />
              </div>
              <Link
                to={pathForLocale(`/carta/${featured.category.slug}/${featured.product.slug}`, locale)}
                className="self-start pt-1 t-ui underline underline-offset-4"
              >
                {t('home.featuredCta')}
              </Link>
            </div>
          </article>
        ) : null}
      </section>

      <CatchBoard />

      <section aria-labelledby="categorias" className="mx-auto max-w-7xl px-4 py-16 md:px-8">
        <div className="grid gap-8 md:grid-cols-12">
          <div className="flex flex-col gap-3 md:col-span-4">
            <h2 id="categorias" className="t-h2">
              {t('home.categoriesTitle')}
            </h2>
            <p className="t-body text-text-muted">{t('home.categoriesIntro')}</p>
          </div>
          <ul className="md:col-span-7 md:col-start-6">
            {catalog.categories.map((category) => (
              <li key={category.slug} className="border-b border-border">
                <Link
                  to={pathForLocale(`/carta/${category.slug}`, locale)}
                  className="flex min-h-14 items-baseline justify-between gap-4 py-3 underline-offset-4 hover:underline"
                >
                  <span className="font-display text-xl font-semibold">
                    <Localized value={category.name} />
                  </span>
                  <span className="t-ui text-text-muted">
                    {t('home.dishCount', { count: category.products.length })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <SectionDivider />

      <section
        aria-labelledby="barra"
        className="mx-auto grid max-w-7xl gap-10 px-4 py-16 md:grid-cols-12 md:px-8"
      >
        <div className="md:col-span-7">
          <PagePicture
            photoKey={PAGE_PHOTOS.craft}
            alt={t('photos.craft')}
            sizes="(min-width: 768px) 58vw, 100vw"
          />
        </div>
        <div className="flex flex-col justify-center gap-4 md:col-span-4 md:col-start-9">
          <h2 id="barra" className="t-h2">
            {t('home.aboutTitle')}
          </h2>
          <p className="t-body">{t('home.aboutBody')}</p>
          <Link
            to={pathForLocale('/nosotros', locale)}
            className="self-start t-ui underline underline-offset-4"
          >
            {t('home.aboutCta')}
          </Link>
        </div>
      </section>

      <section aria-labelledby="retiro-delivery" className="bg-surface-raised">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-16 md:grid-cols-12 md:px-8">
          <div className="flex flex-col justify-center gap-4 md:col-span-4">
            <h2 id="retiro-delivery" className="t-h2">
              {t('home.visitTitle')}
            </h2>
            <p className="t-body">{t('home.visitBody')}</p>
            <Link
              to={pathForLocale('/visitanos', locale)}
              className="self-start t-ui underline underline-offset-4"
            >
              {t('home.visitCta')}
            </Link>
          </div>
          <div className="md:col-span-7 md:col-start-6">
            <PagePicture
              photoKey={PAGE_PHOTOS.coast}
              alt={t('photos.coast')}
              sizes="(min-width: 768px) 58vw, 100vw"
            />
          </div>
        </div>
      </section>
    </SiteLayout>
  );
}
