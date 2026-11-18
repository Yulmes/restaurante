import type { Locale, OpeningHoursResponse } from '@marea-baja/shared';
import { PagePicture } from '../catalog/components.tsx';
import { loadOpeningHours } from '../catalog/data.ts';
import { PAGE_PHOTOS, HALF_COLUMN_SIZES } from '../catalog/images.ts';
import { i18n } from '../i18n/config.ts';
import { localeFromPathname } from '../i18n/locale.ts';
import { useLocale, useT } from '../i18n/use-locale.ts';
import { SiteLayout } from '../site/SiteLayout.tsx';
import { restaurantJsonLd, seoMeta } from '../site/seo.ts';
import type { Route } from './+types/visitanos';

export async function loader() {
  return { hours: await loadOpeningHours() };
}

export function meta({ location, loaderData }: Route.MetaArgs) {
  const locale = localeFromPathname(location.pathname);
  const t = i18n.getFixedT(locale, 'site');
  return seoMeta({
    pathname: location.pathname,
    locale,
    title: t('visit.metaTitle'),
    description: t('visit.metaDescription'),
    imageKey: PAGE_PHOTOS.coast,
    jsonLd: restaurantJsonLd(locale, loaderData.hours),
  });
}

/** Lunes primero, como se lee un horario en Costa Rica. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];

function dayName(day: number, locale: Locale): string {
  // 4 de enero de 1970 fue domingo.
  return new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(1970, 0, 4 + day)),
  );
}

function time(minutes: number, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(
    new Date(Date.UTC(1970, 0, 1, Math.floor(minutes / 60), minutes % 60)),
  );
}

function HoursTable({ hours }: { hours: OpeningHoursResponse }) {
  const { t } = useT('site');
  const locale = useLocale();
  return (
    <table className="w-full border-collapse">
      <caption className="sr-only">{t('visit.hoursTitle')}</caption>
      <tbody>
        {WEEK.map((day) => {
          const ranges = hours.days.filter((h) => h.dayOfWeek === day);
          return (
            <tr key={day} className="border-b border-border">
              <th scope="row" className="py-3 pr-4 text-left font-medium t-body capitalize">
                {dayName(day, locale)}
              </th>
              <td className="py-3 text-right t-body">
                {ranges.length === 0
                  ? t('visit.closed')
                  : ranges
                      .map((r) =>
                        t('visit.hoursRange', {
                          opens: time(r.opensMinutes, locale),
                          closes: time(r.closesMinutes, locale),
                        }),
                      )
                      .join(', ')}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * Ubicación y horario (ruta `/visitanos`, M4, D4): dirección, horario y modalidades. El local se
 * comunica como punto de retiro; la propuesta contempla solo retiro y delivery (sin reservas ni
 * mesas) y los pedidos en línea llegan en M5. Textos aprobados (docs/m4/CONTENIDO_EDITORIAL.md).
 */
export default function Visitanos({ loaderData }: Route.ComponentProps) {
  const { t } = useT('site');
  const { hours } = loaderData;
  return (
    <SiteLayout>
      <div className="mx-auto flex max-w-7xl flex-col gap-12 px-4 pt-10 md:px-8 md:pt-14">
        <header className="flex max-w-3xl flex-col gap-4">
          <h1 className="t-h1">{t('visit.title')}</h1>
          <p className="t-body-lg text-text-muted">{t('visit.lead')}</p>
        </header>
        <div className="grid gap-10 md:grid-cols-12">
          <div className="flex flex-col gap-10 md:col-span-5">
            <section aria-labelledby="direccion" className="flex flex-col gap-2">
              <h2 id="direccion" className="t-h3">
                {t('visit.addressTitle')}
              </h2>
              <address className="t-body not-italic">{t('footer.address')}</address>
              <p className="text-sm leading-6 text-text-muted">{t('footer.fictional')}</p>
            </section>
            <section aria-labelledby="horario" className="flex flex-col gap-2">
              <h2 id="horario" className="t-h3">
                {t('visit.hoursTitle')}
              </h2>
              <HoursTable hours={hours} />
            </section>
            <section aria-labelledby="como-pedir" className="flex flex-col gap-2">
              <h2 id="como-pedir" className="t-h3">
                {t('visit.modesTitle')}
              </h2>
              <ul className="flex list-disc flex-col gap-1 pl-5 t-body">
                {hours.pickupEnabled ? <li>{t('visit.pickup')}</li> : null}
                {hours.deliveryEnabled ? <li>{t('visit.delivery')}</li> : null}
              </ul>
              <p className="t-body text-text-muted">{t('visit.dineIn')}</p>
            </section>
            <section aria-labelledby="contacto" className="flex flex-col gap-2">
              <h2 id="contacto" className="t-h3">
                {t('visit.contactTitle')}
              </h2>
              <p className="t-body text-text-muted">{t('visit.contactBody')}</p>
            </section>
          </div>
          <div className="md:col-span-6 md:col-start-7">
            <PagePicture
              photoKey={PAGE_PHOTOS.coast}
              alt={t('photos.coast')}
              variant="card"
              sizes={HALF_COLUMN_SIZES}
              priority
            />
          </div>
        </div>
      </div>
    </SiteLayout>
  );
}
