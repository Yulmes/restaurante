import { describe, expect, it } from 'vitest';
import {
  FakeBotCheck,
  TURNSTILE_DUMMY_TOKEN,
  TURNSTILE_SITEVERIFY_URL,
  TurnstileBotCheck,
} from './bot-check.ts';

interface Call {
  url: string;
  body: URLSearchParams;
}

function fakeFetch(respond: () => Response | Promise<Response>): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  // El verificador siempre llama con la URL en texto y un URLSearchParams como cuerpo.
  const impl = ((input: string, init?: { body?: URLSearchParams }) => {
    calls.push({ url: input, body: new URLSearchParams(init?.body) });
    return Promise.resolve(respond());
  }) as unknown as typeof fetch;
  return { fetch: impl, calls };
}

describe('Turnstile en el servidor (D8, V7)', () => {
  it('envía secreto, token e IP a siteverify y acepta solo success: true', async () => {
    const ok = fakeFetch(() => Response.json({ success: true }));
    expect(await new TurnstileBotCheck('secreto', ok.fetch).verify('tok', '203.0.113.9')).toBe(true);
    expect(ok.calls[0]?.url).toBe(TURNSTILE_SITEVERIFY_URL);
    expect(Object.fromEntries(ok.calls[0]?.body ?? [])).toEqual({
      secret: 'secreto',
      response: 'tok',
      remoteip: '203.0.113.9',
    });

    const rejected = fakeFetch(() =>
      Response.json({ success: false, 'error-codes': ['invalid-input-response'] }),
    );
    expect(await new TurnstileBotCheck('secreto', rejected.fetch).verify('tok', undefined)).toBe(false);
  });

  it('falla de forma cerrada si Turnstile no responde o responde mal', async () => {
    const down = fakeFetch(() => Promise.reject(new TypeError('fetch failed')));
    expect(await new TurnstileBotCheck('s', down.fetch).verify('tok', undefined)).toBe(false);
    const error500 = fakeFetch(() => new Response('oops', { status: 500 }));
    expect(await new TurnstileBotCheck('s', error500.fetch).verify('tok', undefined)).toBe(false);
    const notJson = fakeFetch(() => new Response('<html>', { status: 200 }));
    expect(await new TurnstileBotCheck('s', notJson.fetch).verify('tok', undefined)).toBe(false);
  });

  it('rechaza tokens vacíos o de más de 2048 caracteres sin consultar', async () => {
    const spy = fakeFetch(() => Response.json({ success: true }));
    const check = new TurnstileBotCheck('s', spy.fetch);
    expect(await check.verify('', undefined)).toBe(false);
    expect(await check.verify('x'.repeat(2049), undefined)).toBe(false);
    expect(spy.calls).toHaveLength(0);
  });

  it('el proveedor falso acepta solo el token ficticio de las claves de prueba', async () => {
    const fake = new FakeBotCheck();
    expect(await fake.verify(TURNSTILE_DUMMY_TOKEN)).toBe(true);
    expect(await fake.verify('cualquier-otro')).toBe(false);
  });
});
