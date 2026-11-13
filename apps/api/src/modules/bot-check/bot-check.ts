/**
 * Verificación del desafío anti-bots en el servidor (D8, §8.4). El frontend nunca decide si el
 * desafío pasó: la API valida el token y, ante cualquier duda, falla de forma cerrada.
 *
 * Validación V7 (documentación de Cloudflare, consultada el 13/11/2026):
 * - Endpoint: `POST https://challenges.cloudflare.com/turnstile/v0/siteverify` (`secret`, `response`,
 *   `remoteip`). Los tokens duran 300 s, son de un solo uso y miden hasta 2048 caracteres.
 * - CSP del widget: `script-src` y `frame-src` `https://challenges.cloudflare.com`.
 * - Claves de prueba: sitekey `1x00000000000000000000AA` (siempre pasa) y secreto
 *   `1x0000000000000000000000000000000AA`; devuelven el token ficticio `XXXX.DUMMY.TOKEN.XXXX`,
 *   que las claves secretas de producción rechazan.
 */
export interface BotCheck {
  /** `true` solo si el proveedor confirmó el token. Errores de red o tiempo agotado → `false`. */
  verify(token: string, remoteIp: string | undefined): Promise<boolean>;
}

export const TURNSTILE_SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
export const TURNSTILE_DUMMY_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';
const TIMEOUT_MS = 10_000;

export class TurnstileBotCheck implements BotCheck {
  readonly #secret: string;
  readonly #fetch: typeof fetch;

  constructor(secret: string, fetchImpl: typeof fetch = fetch) {
    this.#secret = secret;
    this.#fetch = fetchImpl;
  }

  async verify(token: string, remoteIp: string | undefined): Promise<boolean> {
    if (token.length === 0 || token.length > 2048) return false;
    const body = new URLSearchParams({ secret: this.#secret, response: token });
    if (remoteIp) body.set('remoteip', remoteIp);
    try {
      const response = await this.#fetch(TURNSTILE_SITEVERIFY_URL, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) return false;
      const result: unknown = await response.json();
      return typeof result === 'object' && result !== null && 'success' in result && result.success === true;
    } catch {
      // Turnstile no responde: el desafío falla de forma cerrada, sin bloquear la cuenta (V7, R22).
      return false;
    }
  }
}

/**
 * Proveedor falso para desarrollo, CI y pruebas: acepta solo el token ficticio de las claves de
 * prueba de Cloudflare. Nunca se usa en producción (la validación del entorno lo impide).
 */
export class FakeBotCheck implements BotCheck {
  verify(token: string): Promise<boolean> {
    return Promise.resolve(token === TURNSTILE_DUMMY_TOKEN);
  }
}
