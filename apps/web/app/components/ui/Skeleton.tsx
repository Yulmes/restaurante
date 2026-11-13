import { useT } from '../../i18n/use-locale.ts';

/** Esqueleto con la forma real de una línea de carta (§3.6). Sin destello animado. */
export function MenuLineSkeleton({ lines = 3 }: { lines?: number }) {
  const { t } = useT();
  return (
    <div role="status" aria-label={t('loading')} className="flex flex-col">
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          aria-hidden="true"
          className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2.5 border-b border-border py-4"
        >
          <span className="h-5 w-3/5 rounded-[var(--radius-control)] bg-linea" />
          <span className="h-5 w-16 rounded-[var(--radius-control)] bg-linea" />
          <span className="col-span-2 h-3.5 w-4/5 rounded-[var(--radius-control)] bg-linea/70" />
        </div>
      ))}
    </div>
  );
}
