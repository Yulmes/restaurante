import { PagePicture } from '../catalog/components.tsx';
import { PAGE_PHOTOS } from '../catalog/images.ts';
import { i18n } from '../i18n/config.ts';
import { localeFromPathname } from '../i18n/locale.ts';
import { useT } from '../i18n/use-locale.ts';
import { SectionDivider, SiteLayout } from '../site/SiteLayout.tsx';
import { seoMeta } from '../site/seo.ts';
import type { Route } from './+types/nosotros';

export function meta({ location }: Route.MetaArgs) {
  const locale = localeFromPathname(location.pathname);
  const t = i18n.getFixedT(locale, 'site');
  return seoMeta({
    pathname: location.pathname,
    locale,
    title: t('about.metaTitle'),
    description: t('about.metaDescription'),
    imageKey: PAGE_PHOTOS.craft,
  });
}

/**
 * Nosotros (M4). Textos en BORRADOR pendientes de aprobación del propietario
 * (docs/m4/CONTENIDO_EDITORIAL.md): solo usan hechos aprobados (§1.1, carta de M2).
 */
export default function Nosotros() {
  const { t } = useT('site');
  return (
    <SiteLayout>
      <div className="mx-auto flex max-w-7xl flex-col gap-14 px-4 pt-10 md:px-8 md:pt-14">
        <header className="grid gap-6 md:grid-cols-12">
          <div className="flex flex-col gap-4 md:col-span-6">
            <h1 className="t-h1">{t('about.title')}</h1>
            <p className="t-body-lg text-text-muted">{t('about.lead')}</p>
          </div>
        </header>
        <section aria-labelledby="origen" className="grid gap-10 md:grid-cols-12">
          <div className="md:col-span-7">
            <PagePicture
              photoKey={PAGE_PHOTOS.craft}
              alt={t('photos.craft')}
              variant="hero"
              sizes="(min-width: 768px) 58vw, 100vw"
              priority
            />
          </div>
          <div className="flex flex-col justify-center gap-4 md:col-span-4 md:col-start-9">
            <h2 id="origen" className="t-h2">
              {t('about.originTitle')}
            </h2>
            <p className="t-body">{t('about.originBody')}</p>
          </div>
        </section>
        <SectionDivider />
        <section aria-labelledby="mar" className="grid gap-10 md:grid-cols-12">
          <div className="flex flex-col justify-center gap-4 md:col-span-4">
            <h2 id="mar" className="t-h2">
              {t('about.seaTitle')}
            </h2>
            <p className="t-body">{t('about.seaBody')}</p>
          </div>
          <div className="md:col-span-7 md:col-start-6">
            <PagePicture
              photoKey={PAGE_PHOTOS.catch}
              alt={t('photos.catch')}
              variant="hero"
              sizes="(min-width: 768px) 58vw, 100vw"
            />
          </div>
        </section>
        <section aria-labelledby="oficio" className="grid gap-10 md:grid-cols-12">
          <div className="md:col-span-4">
            <PagePicture
              photoKey={PAGE_PHOTOS.ingredient}
              alt={t('photos.ingredient')}
              variant="card"
              sizes="(min-width: 768px) 33vw, 100vw"
            />
          </div>
          <div className="flex flex-col justify-center gap-4 md:col-span-5 md:col-start-7">
            <h2 id="oficio" className="t-h2">
              {t('about.craftTitle')}
            </h2>
            <p className="t-body">{t('about.craftBody')}</p>
            <h2 className="pt-6 t-h3">{t('about.demoTitle')}</h2>
            <p className="t-body text-text-muted">{t('about.demoBody')}</p>
          </div>
        </section>
      </div>
    </SiteLayout>
  );
}
