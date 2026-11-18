import type { CatalogImage, DietaryTag, Locale, LocalizedText } from '@marea-baja/shared';
import type { ReactNode } from 'react';
import { Hanko } from '../components/brand/Hanko.tsx';
import { Tag } from '../components/ui/Tag.tsx';
import { useLocale, useT } from '../i18n/use-locale.ts';
import { catalogPicture, staticPicture, type PictureSources } from './images.ts';
import { useCatchBoard } from './data.ts';

/**
 * Texto del catálogo en su idioma real (§4.5): si falta la traducción, llega en es-CR y se
 * marca con `lang` para que los lectores de pantalla lo pronuncien bien.
 */
export function Localized({
  value,
  as: As = 'span',
  className,
}: {
  value: LocalizedText;
  as?: 'span' | 'p';
  className?: string;
}) {
  const locale = useLocale();
  return (
    <As className={className} lang={value.lang === locale ? undefined : value.lang}>
      {value.text}
    </As>
  );
}

function Picture({
  sources,
  alt,
  className,
  sizes,
  priority = false,
}: {
  sources: PictureSources;
  alt: string;
  className?: string;
  sizes: string;
  priority?: boolean;
}) {
  return (
    <picture>
      <source type="image/avif" srcSet={sources.avif} sizes={sizes} />
      <source type="image/webp" srcSet={sources.webp} sizes={sizes} />
      <img
        src={sources.fallback}
        alt={alt}
        width={sources.width}
        height={sources.height}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        {...(priority ? { fetchPriority: 'high' as const } : {})}
        className={className}
      />
    </picture>
  );
}

/** Foto de un plato (4:5) desde el catálogo. Radio 0 en fotografías (§2.1). */
export function DishPicture({
  image,
  sizes,
  priority,
  className,
}: {
  image: CatalogImage;
  sizes: string;
  priority?: boolean;
  className?: string;
}) {
  const locale = useLocale();
  const sources = catalogPicture(image, 'card');
  if (!sources) return null;
  return (
    <span lang={image.alt.lang === locale ? undefined : image.alt.lang}>
      <Picture
        sources={sources}
        alt={image.alt.text}
        sizes={sizes}
        {...(priority === undefined ? {} : { priority })}
        className={['block aspect-[4/5] w-full object-cover', className].filter(Boolean).join(' ')}
      />
    </span>
  );
}

/** Foto de página (ambiente, oficio, costa), con su texto alternativo traducido. */
export function PagePicture({
  photoKey,
  alt,
  variant = 'hero',
  sizes,
  priority,
  className,
}: {
  photoKey: string;
  alt: string;
  variant?: 'hero' | 'card' | 'thumb';
  sizes: string;
  priority?: boolean;
  className?: string;
}) {
  const ratio = variant === 'hero' ? 'aspect-[3/2]' : variant === 'card' ? 'aspect-[4/5]' : 'aspect-square';
  return (
    <Picture
      sources={staticPicture(photoKey, variant)}
      alt={alt}
      sizes={sizes}
      {...(priority === undefined ? {} : { priority })}
      className={['block w-full object-cover', ratio, className].filter(Boolean).join(' ')}
    />
  );
}

/**
 * Etiquetas de la carta (§3.6): Picante / Sin gluten / Vegetariano, siempre con texto.
 * `GLUTEN_FREE` se muestra como "Sin gluten" (M4): la etiqueta solo existe donde los ingredientes
 * la justifican (revisión de la carta de M2) y no afirma nada sobre contaminación cruzada.
 */
export function DietaryTags({ tags }: { tags: readonly DietaryTag[] }): ReactNode {
  const { t } = useT('site');
  if (tags.length === 0) return null;
  return tags.map((tag) => <Tag key={tag}>{t(`tags.${tag}`)}</Tag>);
}

function formatBoardDate(date: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}

/**
 * Pizarra de pesca del día (§1.1, §3.6): banda Tinta, tabla de pescado, puerto y hora, y el
 * hanko de frescura. Se consulta en vivo (no depende del prerender). Especie y puerto son
 * nombres propios en español (M2).
 */
export function CatchBoard({ headingLevel = 2 }: { headingLevel?: 2 | 3 }) {
  const { t } = useT('site');
  const locale = useLocale();
  const board = useCatchBoard();
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const data = board.data?.board;
  return (
    <section
      id="pesca-del-dia"
      aria-labelledby="pesca-del-dia-title"
      className="scroll-mt-24 bg-surface-inverse text-text-inverse"
    >
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-14 md:grid-cols-12 md:px-8">
        <div className="flex flex-col gap-4 md:col-span-4">
          <Heading id="pesca-del-dia-title" className="t-h2">
            {t('catch.title')}
          </Heading>
          <p className="t-body text-text-inverse-muted">{t('catch.intro')}</p>
          <div className="pt-2">
            <Hanko size={56} />
          </div>
        </div>
        <div className="md:col-span-7 md:col-start-6" aria-live="polite" aria-busy={board.isPending}>
          {board.isPending ? (
            <p className="t-body text-text-inverse-muted">{t('catch.loading')}</p>
          ) : board.isError ? (
            <p className="t-body">{t('catch.error')}</p>
          ) : !data ? (
            <p className="t-body">{t('catch.empty')}</p>
          ) : (
            <table className="w-full border-collapse text-left">
              <caption className="pb-3 text-left t-ui text-action-on-dark">
                {data.isToday
                  ? t('catch.dateToday', { date: formatBoardDate(data.date, locale) })
                  : t('catch.datePast', { date: formatBoardDate(data.date, locale) })}
              </caption>
              <thead>
                <tr className="border-b border-tinta-800 text-sm text-text-inverse-muted">
                  <th scope="col" className="py-2 pr-4 font-medium">
                    {t('catch.species')}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    {t('catch.port')}
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    {t('catch.arrived')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={`${item.species}-${item.port}`} className="border-b border-tinta-800">
                    <td className="py-3 pr-4 font-display text-lg font-semibold" lang="es-CR">
                      {item.species}
                    </td>
                    <td className="py-3 pr-4 t-body" lang="es-CR">
                      {item.port}
                    </td>
                    <td className="py-3 text-right t-price">{item.arrivedAt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </section>
  );
}
