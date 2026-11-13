/**
 * `EmailProvider` (§8.5): `send(message) → { accepted, providerMessageId?, error? }`.
 * - `MailpitProvider`: desarrollo y CI. Usa la API HTTP de envío de Mailpit (`/api/v1/send`), que
 *   entrega por la misma vía que SMTP sin sumar una biblioteca SMTP (ADR 0004).
 * - `ResendProvider`: API HTTPS de Resend. En esta fase solo prueba la integración (D6, C9).
 * - `MemoryEmailProvider`: pruebas automáticas.
 * `DemoInboxProvider` y el estado `DEMO_ONLY` llegan con la bandeja de demostración (M7).
 */
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface SendResult {
  accepted: boolean;
  providerMessageId?: string;
  error?: string;
}

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<SendResult>;
}

const TIMEOUT_MS = 10_000;

/** `Marea Baja <no-reply@x>` → `{ name, email }`. */
export function parseFrom(from: string): { name?: string; email: string } {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  if (match?.[2]) return match[1] ? { name: match[1], email: match[2] } : { email: match[2] };
  return { email: from.trim() };
}

async function postJson(
  fetchImpl: typeof fetch,
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ ok: boolean; status: number; json: unknown }> {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json: unknown = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, json };
}

function stringField(value: unknown, field: string): string | undefined {
  if (typeof value !== 'object' || value === null || !(field in value)) return undefined;
  const result = (value as Record<string, unknown>)[field];
  return typeof result === 'string' ? result : undefined;
}

export class MailpitProvider implements EmailProvider {
  readonly name = 'mailpit';
  readonly #url: string;
  readonly #from: { name?: string; email: string };
  readonly #fetch: typeof fetch;

  constructor(baseUrl: string, from: string, fetchImpl: typeof fetch = fetch) {
    this.#url = `${baseUrl.replace(/\/+$/, '')}/api/v1/send`;
    this.#from = parseFrom(from);
    this.#fetch = fetchImpl;
  }

  async send(message: EmailMessage): Promise<SendResult> {
    try {
      const result = await postJson(this.#fetch, this.#url, {
        From: { Email: this.#from.email, Name: this.#from.name ?? '' },
        To: [{ Email: message.to }],
        Subject: message.subject,
        HTML: message.html,
        Text: message.text,
      });
      const id = stringField(result.json, 'ID');
      if (!result.ok || !id) return { accepted: false, error: `Mailpit respondió ${String(result.status)}` };
      return { accepted: true, providerMessageId: id };
    } catch (error) {
      return { accepted: false, error: error instanceof Error ? error.name : 'Error de red' };
    }
  }
}

export const RESEND_API_URL = 'https://api.resend.com/emails';

export class ResendProvider implements EmailProvider {
  readonly name = 'resend';
  readonly #apiKey: string;
  readonly #from: string;
  readonly #fetch: typeof fetch;

  constructor(apiKey: string, from: string, fetchImpl: typeof fetch = fetch) {
    this.#apiKey = apiKey;
    this.#from = from;
    this.#fetch = fetchImpl;
  }

  async send(message: EmailMessage): Promise<SendResult> {
    try {
      const result = await postJson(
        this.#fetch,
        RESEND_API_URL,
        {
          from: this.#from,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
        },
        { authorization: `Bearer ${this.#apiKey}` },
      );
      const id = stringField(result.json, 'id');
      // §8.5: SENT solo si Resend lo aceptó y devolvió un id.
      if (!result.ok || !id) {
        const detail = stringField(result.json, 'name') ?? stringField(result.json, 'message');
        return {
          accepted: false,
          error: `Resend respondió ${String(result.status)}${detail ? `: ${detail}` : ''}`,
        };
      }
      return { accepted: true, providerMessageId: id };
    } catch (error) {
      return { accepted: false, error: error instanceof Error ? error.name : 'Error de red' };
    }
  }
}

export class MemoryEmailProvider implements EmailProvider {
  readonly name = 'memory';
  readonly sent: EmailMessage[] = [];
  /** Las pruebas lo activan para simular un proveedor caído. */
  failing = false;

  send(message: EmailMessage): Promise<SendResult> {
    if (this.failing) return Promise.resolve({ accepted: false, error: 'Proveedor simulado caído' });
    this.sent.push(message);
    return Promise.resolve({ accepted: true, providerMessageId: `memory-${String(this.sent.length)}` });
  }
}
