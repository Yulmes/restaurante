import { useT } from '../../i18n/use-locale.ts';

/** Aviso permanente de entorno de demostración (§3.6, §7.4). No se superpone al contenido. */
export function DemoBanner() {
  const { t } = useT();
  return (
    <p className="border-b border-border bg-surface-raised px-4 py-2 text-center text-[0.8125rem] leading-5 text-text-muted">
      {t('demoBanner')}
    </p>
  );
}
