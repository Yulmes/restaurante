import { SUPPORTED_LOCALES } from '@marea-baja/shared';
import { Link, useLocation } from 'react-router';
import { pathForLocale } from '../../i18n/locale.ts';
import { useLocale, useT } from '../../i18n/use-locale.ts';

/**
 * Selector de idioma (D2, §3.5): enlaces de texto "ES · EN" a la misma página
 * en el otro idioma, con lang, hreflang y aria-current. Sin banderas.
 */
export function LanguageSwitcher({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  const { t } = useT();
  const locale = useLocale();
  const { pathname } = useLocation();
  const muted = tone === 'dark' ? 'text-text-inverse-muted' : 'text-text-muted';
  return (
    <nav aria-label={t('language.label')} className={`t-ui flex items-center gap-2 ${muted}`}>
      {SUPPORTED_LOCALES.map((target, i) => {
        const current = target === locale;
        return (
          <span key={target} className="flex items-center gap-2">
            {i > 0 ? <span aria-hidden="true">·</span> : null}
            <Link
              to={pathForLocale(pathname, target)}
              lang={target}
              hrefLang={target}
              aria-current={current ? 'true' : undefined}
              className={`inline-flex min-h-11 min-w-11 items-center justify-center underline-offset-4 hover:underline ${
                current ? `font-bold underline ${tone === 'dark' ? 'text-text-inverse' : 'text-text'}` : ''
              }`}
            >
              {/* WCAG 2.5.3: el nombre accesible empieza con el texto visible ("ES"). */}
              {t(`language.short.${target}`)}
              <span className="sr-only">
                {' · '}
                {t(`language.name.${target}`)}
              </span>
            </Link>
          </span>
        );
      })}
    </nav>
  );
}
