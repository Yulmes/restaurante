import { DIETARY_TAGS, type CatalogCategory, type CatalogProduct, type DietaryTag } from '@marea-baja/shared';
import { useId, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ProductSheet } from '../cart/ProductSheet.tsx';
import { MenuLine } from '../components/ui/MenuLine.tsx';
import { Tag } from '../components/ui/Tag.tsx';
import { pathForLocale } from '../i18n/locale.ts';
import { useLocale, useT } from '../i18n/use-locale.ts';
import { DietaryTags, Localized } from './components.tsx';
import { liveProduct, useLiveCatalog } from './data.ts';

/**
 * Carta en lista editorial (§2.1, §2.4): índice de categorías, búsqueda y filtros por etiqueta
 * en línea (nunca tapan la lista en el celular) y las líneas de carta de M1. Se conserva el
 * orden de la carta impresa. Precio y disponibilidad se actualizan en vivo al hidratar (D10).
 */
const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

export function MenuBrowser({
  categories,
  showIndex = true,
}: {
  /** Categorías a mostrar (toda la carta o una sola). */
  categories: readonly CatalogCategory[];
  showIndex?: boolean;
}) {
  const { t } = useT('site');
  const { t: tc } = useT();
  const locale = useLocale();
  const live = useLiveCatalog(locale);
  const [query, setQuery] = useState('');
  const [tags, setTags] = useState<ReadonlySet<DietaryTag>>(new Set());
  const searchId = useId();
  const filtering = query.trim() !== '' || tags.size > 0;
  // En el celular, búsqueda y filtros se pliegan para que la carta empiece arriba (§2.4).
  const [panelOpen, setPanelOpen] = useState(false);
  const panelId = useId();
  // M5: la hoja de producto se abre desde "Agregar" con el precio y las opciones en vivo.
  const [sheet, setSheet] = useState<CatalogProduct | null>(null);

  const visible = useMemo(() => {
    const words = normalize(query).split(/\s+/).filter(Boolean);
    return categories
      .map((category) => ({
        category,
        products: category.products.filter((product) => {
          if ([...tags].some((tag) => !product.tags.includes(tag))) return false;
          const haystack = normalize(
            [product.name, product.translatedName ?? '', product.description.text].join(' '),
          );
          return words.every((word) => haystack.includes(word));
        }),
      }))
      .filter((entry) => entry.products.length > 0);
  }, [categories, query, tags]);
  const count = visible.reduce((sum, entry) => sum + entry.products.length, 0);

  const toggle = (tag: DietaryTag) => {
    setTags((current) => {
      const next = new Set(current);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  return (
    <div className="grid gap-10 lg:grid-cols-12">
      <div className="flex flex-col gap-6 lg:col-span-3">
        {showIndex ? (
          <nav aria-label={t('menu.indexLabel')} className="lg:sticky lg:top-24">
            <ul className="flex flex-wrap gap-x-4 gap-y-1 lg:flex-col">
              {visible.map(({ category }) => (
                <li key={category.slug}>
                  <a
                    href={`#${category.slug}`}
                    className="inline-flex min-h-11 items-center t-ui underline-offset-4 hover:underline"
                  >
                    <Localized value={category.name} />
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
        <button
          type="button"
          aria-expanded={panelOpen}
          aria-controls={panelId}
          onClick={() => {
            setPanelOpen((open) => !open);
          }}
          className="inline-flex min-h-11 items-center self-start border-b border-text t-ui lg:hidden"
        >
          {t('menu.searchToggle')}
          {filtering ? ` · ${t('menu.results', { count })}` : ''}
        </button>
        <div
          id={panelId}
          className={`${panelOpen ? 'flex' : 'hidden'} flex-col gap-4 border-t border-border pt-5 lg:flex`}
          role="search"
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor={searchId} className="t-ui text-text">
              {t('menu.searchLabel')}
            </label>
            <span id={`${searchId}-hint`} className="text-sm leading-5 text-text-muted">
              {t('menu.searchHint')}
            </span>
            <input
              id={searchId}
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              aria-describedby={`${searchId}-hint`}
              className="h-12 rounded-[var(--radius-control)] border border-border bg-surface-raised px-3.5 text-base text-text hover:border-border-strong focus-visible:border-text focus-visible:outline-offset-0"
            />
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="t-ui text-text">{t('menu.filtersLabel')}</legend>
            <div className="flex flex-wrap gap-2 pt-1">
              {DIETARY_TAGS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  aria-pressed={tags.has(tag)}
                  onClick={() => {
                    toggle(tag);
                  }}
                  className={`min-h-11 rounded-[var(--radius-control)] border px-3 text-sm font-medium tracking-[0.05em] uppercase ${
                    tags.has(tag)
                      ? 'border-text bg-action text-text-inverse'
                      : 'border-border-strong text-text hover:bg-surface-raised'
                  }`}
                >
                  {t(`tags.${tag}`)}
                </button>
              ))}
            </div>
          </fieldset>
          {filtering ? (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setTags(new Set());
              }}
              className="self-start t-ui underline underline-offset-4"
            >
              {t('menu.clear')}
            </button>
          ) : null}
          <p role="status" className="text-sm leading-5 text-text-muted">
            {filtering ? t('menu.results', { count }) : ''}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-12 lg:col-span-8 lg:col-start-5">
        {live.isError ? (
          <p role="alert" className="border-l-4 border-border-strong bg-surface-raised px-4 py-3 t-body">
            {t('menu.liveError')}
          </p>
        ) : null}
        {visible.length === 0 ? (
          <div className="flex flex-col gap-2 border-t border-border pt-6">
            <h2 className="t-h3">{t('menu.emptyTitle')}</h2>
            <p className="t-body text-text-muted">{t('menu.emptyBody')}</p>
          </div>
        ) : (
          visible.map(({ category, products }) => (
            <section
              key={category.slug}
              id={category.slug}
              aria-labelledby={`${category.slug}-title`}
              className="scroll-mt-24"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-text pb-2">
                <h2 id={`${category.slug}-title`} className="t-h2">
                  <Localized value={category.name} />
                </h2>
                {showIndex ? (
                  <Link
                    to={pathForLocale(`/carta/${category.slug}`, locale)}
                    className="t-ui underline-offset-4 hover:underline"
                  >
                    {t('menu.seeCategory', { name: category.name.text })}
                  </Link>
                ) : null}
              </div>
              {category.description ? (
                <Localized value={category.description} as="p" className="pt-3 t-body text-text-muted" />
              ) : null}
              <div>
                {products.map((product) => {
                  const current = liveProduct(product, live.data);
                  return (
                    <MenuLine
                      key={product.slug}
                      name={product.name}
                      translatedName={product.translatedName}
                      description={product.description.text}
                      {...(product.description.lang === locale
                        ? {}
                        : { descriptionLang: product.description.lang })}
                      priceMinor={current.basePriceMinor}
                      soldOut={!current.isAvailable}
                      soldOutLabel={tc('tags.soldOutToday')}
                      href={pathForLocale(`/carta/${category.slug}/${product.slug}`, locale)}
                      action={
                        current.isAvailable ? (
                          <button
                            type="button"
                            onClick={() => {
                              setSheet({ ...product, ...current });
                            }}
                            className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-text px-4 t-ui hover:bg-surface-raised"
                          >
                            {t('cart.addShort')}
                            <span className="sr-only"> {product.name}</span>
                          </button>
                        ) : undefined
                      }
                      tags={
                        product.tags.length > 0 || !current.isAvailable ? (
                          <>
                            {current.isAvailable ? null : (
                              <Tag variant="muted">{tc('tags.soldOutToday')}</Tag>
                            )}
                            <DietaryTags tags={product.tags} />
                          </>
                        ) : undefined
                      }
                    />
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>
      <ProductSheet
        product={sheet}
        onClose={() => {
          setSheet(null);
        }}
      />
    </div>
  );
}
