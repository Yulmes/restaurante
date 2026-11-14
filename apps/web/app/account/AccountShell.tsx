import type { ReactNode } from 'react';
import { TideLine } from '../components/brand/TideLine.tsx';
import { DemoBanner } from '../components/ui/DemoBanner.tsx';
import { MAIN_ID, SkipLink } from '../components/ui/SkipLink.tsx';
import { SiteFooter, SiteHeader } from '../site/SiteLayout.tsx';

/**
 * Marco de las páginas de la cuenta (M3). Desde M4 usa la misma barra y el mismo pie que las
 * páginas públicas (§3.5), con el aviso de demostración, el salto al contenido y la línea de marea.
 * Columna angosta: formularios cortos, pensados para el celular (§3.4, §3.8).
 */
export function AccountShell({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <>
      <SkipLink />
      <DemoBanner />
      <SiteHeader />
      <main
        id={MAIN_ID}
        tabIndex={-1}
        className="mx-auto flex w-full max-w-[34rem] flex-col gap-6 px-4 pt-8 pb-16 md:pt-12"
      >
        <div className="flex flex-col gap-3">
          <h1 className="t-h1">{title}</h1>
          {intro ? <p className="t-body text-text-muted">{intro}</p> : null}
        </div>
        <TideLine className="text-border-strong" />
        {children}
      </main>
      <SiteFooter />
    </>
  );
}

/** Mensaje de resultado anunciado por lectores de pantalla (WCAG 4.1.3). */
export function StatusMessage({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'success';
}) {
  return (
    <div
      role="status"
      className={`max-w-[26rem] border border-l-4 bg-surface-raised px-4 py-3.5 t-body ${
        tone === 'success' ? 'border-text' : 'border-border-strong'
      }`}
    >
      {children}
    </div>
  );
}
