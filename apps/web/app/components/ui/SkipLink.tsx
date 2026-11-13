import { useT } from '../../i18n/use-locale.ts';

export const MAIN_ID = 'contenido';

export function SkipLink() {
  const { t } = useT();
  return (
    <a
      href={`#${MAIN_ID}`}
      className="absolute top-2 left-2 z-50 -translate-y-24 bg-action px-4 py-3 t-ui text-text-inverse focus:translate-y-0"
    >
      {t('skipToContent')}
    </a>
  );
}
