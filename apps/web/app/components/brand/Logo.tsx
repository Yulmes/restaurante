import { useT } from '../../i18n/use-locale.ts';

/** Trazo continuo: la ola se cierra hacia abajo formando un bowl (§1.4). */
export const WAVE_BOWL_PATH =
  'M3 16 C10 7,17 7,22 14 S35 22,42 13 S55 7,61 14 C59 34,47 47,32 47 C17 47,6 36,4 22';

export function WaveBowl({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={Math.round((size * 52) / 64)}
      viewBox="0 0 64 52"
      aria-hidden="true"
      className={className}
    >
      <path
        d={WAVE_BOWL_PATH}
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        className="marea-draw"
      />
    </svg>
  );
}

interface LogoProps {
  layout?: 'horizontal' | 'stacked';
  /** Tamaño del isotipo en px (mínimo 24, §1.4). */
  size?: number;
}

export function Logo({ layout = 'horizontal', size = 40 }: LogoProps) {
  const { t } = useT();
  const brand = t('brand');
  const [first = brand, ...rest] = brand.split(' ');
  return (
    <span
      role="img"
      aria-label={brand}
      translate="no"
      className={`inline-flex items-center gap-3 font-display font-extrabold leading-none ${
        layout === 'stacked' ? 'text-[2.5rem]' : 'text-2xl'
      }`}
    >
      <WaveBowl size={Math.max(24, size)} />
      {layout === 'stacked' ? (
        <span aria-hidden="true" className="flex flex-col">
          <span>{first}</span>
          <span>{rest.join(' ')}</span>
        </span>
      ) : (
        <span aria-hidden="true">{brand}</span>
      )}
    </span>
  );
}
