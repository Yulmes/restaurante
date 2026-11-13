import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Logo } from '../components/brand/Logo.tsx';
import { TideLine } from '../components/brand/TideLine.tsx';
import { DemoBanner } from '../components/ui/DemoBanner.tsx';
import { LanguageSwitcher } from '../components/ui/LanguageSwitcher.tsx';
import { MAIN_ID, SkipLink } from '../components/ui/SkipLink.tsx';
import { useLocalizedPath } from './links.ts';

/**
 * Marco de las páginas de la cuenta (M3). Usa los componentes del sistema de M1 sin cambiarlos:
 * aviso de demostración, salto al contenido, marca, selector de idioma y línea de marea.
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
  const to = useLocalizedPath();
  return (
    <>
      <SkipLink />
      <DemoBanner />
      <header className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 md:px-8">
        <Link to={to('/')} className="rounded-[var(--radius-control)]">
          <Logo />
        </Link>
        <LanguageSwitcher />
      </header>
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
