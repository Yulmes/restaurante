/** Ayudas de las E2E de identidad: Mailpit, registro e inicio de sesión. */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';
import { E2E_DATABASE_URL } from '../../playwright.auth.config.ts';

export const MAILPIT = 'http://127.0.0.1:8025';
export const PASSWORD = 'una frase larga para la demo';

export function uniqueEmail(prefix: string): string {
  return `${prefix}.${String(Date.now())}.${String(Math.floor(Math.random() * 1e6))}@example.com`;
}

export interface MailpitSummary {
  ID: string;
  Subject: string;
}

/** Espera el correo enviado a `to` y devuelve asunto, texto y el enlace con el token. */
export async function waitForEmail(
  page: Page,
  to: string,
): Promise<{ subject: string; text: string; link: string }> {
  let found: MailpitSummary | undefined;
  await expect
    .poll(
      async () => {
        const res = await page.request.get(`${MAILPIT}/api/v1/search`, { params: { query: `to:"${to}"` } });
        const body = (await res.json()) as { messages: MailpitSummary[] };
        found = body.messages[0];
        return found?.ID;
      },
      { timeout: 15_000 },
    )
    .toBeTruthy();
  const res = await page.request.get(`${MAILPIT}/api/v1/message/${found?.ID ?? ''}`);
  const message = (await res.json()) as { Subject: string; Text: string };
  const link = /https?:\/\/\S+#token=[A-Za-z0-9_-]{43}/.exec(message.Text)?.[0];
  if (!link) throw new Error('El correo no tiene enlace con token');
  return { subject: message.Subject, text: message.Text, link };
}

export async function register(
  page: Page,
  path: string,
  data: { name: string; email: string },
): Promise<void> {
  await page.goto(path);
  await page.locator('#register-name').fill(data.name);
  await page.locator('#register-email').fill(data.email);
  await page.locator('#register-password').fill(PASSWORD);
  await page.locator('#register-form button[type=submit]').click();
}

export async function signIn(page: Page, path: string, email: string, password = PASSWORD): Promise<void> {
  await page.goto(path);
  await page.locator('#login-email').fill(email);
  await page.locator('#login-password').fill(password);
  await page.locator('#login-form button[type=submit]').click();
}

const API_DIR = fileURLToPath(new URL('../../../api/', import.meta.url));

/**
 * Cuenta verificada creada directamente en la base E2E (`apps/api/scripts/e2e-user.ts`).
 * El límite real de 5 registros por hora por IP (§8.4) no deja registrar más cuentas por la
 * interfaz desde el mismo navegador de pruebas; el registro ya se prueba en identidad.spec.ts.
 */
export function createVerifiedAccount(locale: 'es-CR' | 'en'): string {
  const email = uniqueEmail(`cuenta-${locale}`);
  execFileSync(
    'node',
    ['scripts/e2e-user.ts', '--email', email, '--password', PASSWORD, '--locale', locale],
    {
      cwd: API_DIR,
      env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL },
      stdio: 'pipe',
    },
  );
  return email;
}
