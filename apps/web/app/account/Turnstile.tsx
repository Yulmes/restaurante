import { useEffect, useRef, useState } from 'react';
import { useLocale, useT } from '../i18n/use-locale.ts';

/**
 * Widget de Cloudflare Turnstile (D8). Se carga **solo** cuando la API respondió
 * `challengeRequired`: nunca aparece de forma permanente. El token se valida en el servidor;
 * este componente solo lo obtiene.
 *
 * CSP necesaria (V7): `script-src` y `frame-src` `https://challenges.cloudflare.com`, solo en la
 * página de inicio de sesión (se configura en M10 con el resto de la CSP de la web).
 * En desarrollo, sin `VITE_TURNSTILE_SITE_KEY`, se usa la clave de prueba de Cloudflare que
 * siempre pasa (`1x00000000000000000000AA`).
 */
const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const TEST_SITE_KEY = '1x00000000000000000000AA';

interface TurnstileApi {
  render(element: HTMLElement, options: Record<string, unknown>): string;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export function turnstileSiteKey(): string {
  const configured: unknown = import.meta.env['VITE_TURNSTILE_SITE_KEY'];
  if (typeof configured === 'string' && configured !== '') return configured;
  return import.meta.env.DEV ? TEST_SITE_KEY : '';
}

let loading: Promise<TurnstileApi> | null = null;
function loadTurnstile(): Promise<TurnstileApi> {
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    if (window.turnstile) {
      resolve(window.turnstile);
      return;
    }
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error('turnstile'));
    };
    script.onerror = () => {
      reject(new Error('turnstile'));
    };
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}

export function TurnstileChallenge({ onToken }: { onToken: (token: string | null) => void }) {
  const { t } = useT('account');
  const locale = useLocale();
  const container = useRef<HTMLDivElement>(null);
  const [unavailable, setUnavailable] = useState(false);
  const callback = useRef(onToken);
  callback.current = onToken;

  useEffect(() => {
    const siteKey = turnstileSiteKey();
    if (!siteKey) {
      setUnavailable(true);
      return;
    }
    let widgetId: string | null = null;
    let cancelled = false;
    loadTurnstile()
      .then((api) => {
        if (cancelled || !container.current) return;
        widgetId = api.render(container.current, {
          sitekey: siteKey,
          language: locale === 'en' ? 'en' : 'es',
          theme: 'light',
          callback: (token: string) => {
            callback.current(token);
          },
          'expired-callback': () => {
            callback.current(null);
          },
          'error-callback': () => {
            callback.current(null);
            setUnavailable(true);
          },
        });
      })
      .catch(() => {
        // Falla cerrada (V7): sin desafío no hay login, pero la recuperación sigue disponible.
        if (!cancelled) setUnavailable(true);
      });
    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [locale]);

  return (
    <div className="flex flex-col gap-2">
      <p className="t-ui text-text">{t('turnstile.label')}</p>
      <div ref={container} data-testid="turnstile" className="min-h-[65px]" />
      {unavailable ? <p className="t-body text-danger">{t('turnstile.unavailable')}</p> : null}
    </div>
  );
}
