import type { ReactNode } from 'react';

export type TagVariant = 'default' | 'highlight' | 'muted';

const styles: Record<TagVariant, string> = {
  default: 'border-border-strong text-text-muted',
  highlight: 'border-highlight bg-highlight text-text',
  muted: 'border-border-strong bg-surface-raised text-text-muted',
};

/** Etiqueta con texto (nunca solo color ni ícono, §3.6). */
export function Tag({ variant = 'default', children }: { variant?: TagVariant; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-[var(--radius-control)] border px-2 py-1 text-xs leading-none font-medium tracking-[0.05em] uppercase ${styles[variant]}`}
    >
      {children}
    </span>
  );
}
