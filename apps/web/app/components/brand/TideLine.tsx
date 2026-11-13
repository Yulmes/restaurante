/** Línea de marea: único motivo gráfico recurrente (§2.1). Decorativa. */
export function TideLine({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 1200 18"
      preserveAspectRatio="none"
      aria-hidden="true"
      className={['block h-[18px] w-full', className].filter(Boolean).join(' ')}
    >
      <path
        d="M0 9 C100 1,200 17,300 9 S500 1,600 9 S800 17,900 9 S1100 1,1200 9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
