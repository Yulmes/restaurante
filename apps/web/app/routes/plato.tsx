import type { CatalogOptionGroup } from '@marea-baja/shared';
import { data, Link } from 'react-router';
import { DietaryTags, DishPicture, Localized } from '../catalog/components.tsx';
import { HALF_COLUMN_SIZES } from '../catalog/images.ts';
import { findProduct, liveProduct, loadCatalog, useLiveCatalog } from '../catalog/data.ts';
import { Price } from '../components/ui/Price.tsx';
import { Tag } from '../components/ui/Tag.tsx';
import { localeFromPathname, pathForLocale } from '../i18n/locale.ts';
import { useLocale, useT } from '../i18n/use-locale.ts';
import { SiteLayout } from '../site/SiteLayout.tsx';
import { menuItemJsonLd, seoMeta } from '../site/seo.ts';
import type { Route } from './+types/plato';

export async function loader({ request, params }: Route.LoaderArgs) {
  const catalog = await loadCatalog(localeFromPathname(new URL(request.url).pathname));
  const found = findProduct(catalog, params.categoria, params.plato);
  // eslint-disable-next-line @typescript-eslint/only-throw-error -- React Router: lanzar data() responde 404.
  if (!found) throw data(null, { status: 404 });
  return { catalog, ...found };
}

export function meta({ location, loaderData }: Route.MetaArgs) {
  const locale = localeFromPathname(location.pathname);
  const { product, category, catalog } = loaderData;
  const name = product.translatedName ? `${product.name} (${product.translatedName})` : product.name;
  return seoMeta({
    pathname: location.pathname,
    locale,
    title: `${name} · ${category.name.text} · Marea Baja`,
    description: product.description.text,
    type: 'article',
    ...(product.image?.provider === 'STATIC' ? { imageKey: product.image.storageKey } : {}),
    jsonLd: {
      '@context': 'https://schema.org',
      ...menuItemJsonLd(product, category, locale, catalog.currency),
    },
  });
}

function ruleKey(group: CatalogOptionGroup): {
  key: 'chooseOne' | 'chooseUpTo' | 'chooseBetween';
  min: number;
  max: number;
} {
  if (group.minSelect === 1 && group.maxSelect === 1) return { key: 'chooseOne', min: 1, max: 1 };
  if (group.minSelect === 0) return { key: 'chooseUpTo', min: 0, max: group.maxSelect };
  return { key: 'chooseBetween', min: group.minSelect, max: group.maxSelect };
}

/**
 * Página del plato (M4, informativa por decisión del propietario): foto 4:5, nombre original,
 * descripción, etiquetas, precio y disponibilidad en vivo, y los grupos de opciones con su
 * precio adicional como información. Elegir opciones, la cantidad y "Agregar" llegan con el
 * carrito (M5).
 */
export default function Plato({ loaderData }: Route.ComponentProps) {
  const { t } = useT('site');
  const { t: tc } = useT();
  const locale = useLocale();
  const { product, category } = loaderData;
  const live = useLiveCatalog(locale);
  const current = liveProduct(product, live.data);

  return (
    <SiteLayout>
      <article className="mx-auto grid max-w-7xl gap-10 px-4 pt-8 md:grid-cols-12 md:px-8 md:pt-12">
        <div className="md:col-span-6">
          {product.image ? (
            <figure className="flex flex-col gap-2">
              <DishPicture image={product.image} sizes={HALF_COLUMN_SIZES} priority />
              <figcaption className="text-sm leading-5 text-text-muted">{t('product.photoNote')}</figcaption>
            </figure>
          ) : null}
        </div>
        <div className="flex flex-col gap-6 md:col-span-5 md:col-start-8">
          <Link
            to={pathForLocale(`/carta/${category.slug}`, locale)}
            className="self-start t-ui underline underline-offset-4"
          >
            {t('product.back', { name: category.name.text })}
          </Link>
          <header className="flex flex-col gap-2">
            <h1 className="t-h1" translate="no">
              {product.name}
            </h1>
            {product.translatedName ? <p className="t-body-lg">{product.translatedName}</p> : null}
          </header>
          <Localized value={product.description} as="p" className="t-body-lg text-text-muted" />
          <div className="flex flex-wrap gap-2">
            {current.isAvailable ? null : <Tag variant="muted">{tc('tags.soldOutToday')}</Tag>}
            <DietaryTags tags={product.tags} />
          </div>
          <div
            className="flex items-baseline justify-between gap-4 border-y border-border py-4"
            aria-live="polite"
          >
            <span className="t-ui">{t('product.priceLabel')}</span>
            <span className="flex flex-col items-end">
              <span className={current.isAvailable ? 'text-2xl' : 'text-2xl text-text-muted line-through'}>
                <Price amountMinor={current.basePriceMinor} />
              </span>
              <span className="text-sm text-text-muted">{t('product.taxIncluded')}</span>
            </span>
          </div>
          {current.isAvailable ? null : <p className="t-body">{t('product.soldOutNote')}</p>}

          {current.optionGroups.length > 0 ? (
            <section aria-labelledby="opciones" className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <h2 id="opciones" className="t-h3">
                  {t('product.optionsTitle')}
                </h2>
                <p className="text-sm leading-5 text-text-muted">{t('product.optionsNote')}</p>
              </div>
              {current.optionGroups.map((group) => {
                const rule = ruleKey(group);
                return (
                  <div key={group.id} className="flex flex-col gap-2">
                    <h3 className="t-ui text-text">
                      <Localized value={group.name} />
                      <span className="font-normal text-text-muted">
                        {' · '}
                        {t(`product.${rule.key}`, { min: rule.min, max: rule.max })}
                      </span>
                    </h3>
                    <ul className="flex flex-col">
                      {group.options.map((option) => (
                        <li
                          key={option.id}
                          className="flex items-baseline justify-between gap-4 border-b border-border py-2 t-body"
                        >
                          <span className={option.isAvailable ? '' : 'text-text-muted'}>
                            <Localized value={option.name} />
                            {option.isDefault ? (
                              <span className="text-text-muted">{` · ${t('product.default')}`}</span>
                            ) : null}
                            {option.isAvailable ? null : (
                              <span className="text-text-muted">{` · ${t('product.unavailableOption')}`}</span>
                            )}
                          </span>
                          {option.priceDeltaMinor > 0 ? (
                            <span className="text-text-muted">
                              {tc('price.plus')}
                              <Price amountMinor={option.priceDeltaMinor} />
                            </span>
                          ) : (
                            <span className="text-sm text-text-muted">{t('product.noExtra')}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </section>
          ) : null}
          <p className="border-l-4 border-border-strong bg-surface-raised px-4 py-3 text-sm leading-6">
            {t('product.orderSoon')}
          </p>
        </div>
      </article>
    </SiteLayout>
  );
}
