import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { Links, Meta, Outlet, Scripts, ScrollRestoration, isRouteErrorResponse } from 'react-router';
import type { Route } from './+types/root';
import { i18n } from './i18n/config.ts';
import { useLocale, useT } from './i18n/use-locale.ts';
import './styles/app.css';
import { COLON_FONT_CSS } from './styles/fonts.ts';

export const links: Route.LinksFunction = () => [
  { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
];

export function Layout({ children }: { children: ReactNode }) {
  const locale = useLocale();
  return (
    <html lang={locale}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light" />
        <meta name="theme-color" content="#EEF2EF" />
        <style>{COLON_FONT_CSS}</style>
        <Meta />
        <Links />
      </head>
      <body>
        <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  // Datos remotos con TanStack Query (§4.4): un cliente por pestaña.
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { mutations: { retry: false } } }));
  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
    </QueryClientProvider>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const { t } = useT();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-3 px-4 py-16">
      <h1 className="t-h1">{notFound ? t('errors.notFoundTitle') : t('errors.genericTitle')}</h1>
      <p className="t-body text-text-muted">
        {notFound ? t('errors.notFoundBody') : t('errors.genericBody')}
      </p>
    </main>
  );
}
