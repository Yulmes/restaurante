import { readFileSync } from 'node:fs';
import type { Locale } from '@marea-baja/shared';
import { COMMON_TEXTS, EMAIL_TEXTS, type EmailTemplate } from './messages.ts';

/**
 * Renderiza un correo de M3 (ADR 0004): HTML compatible con Gmail y Outlook (tablas, compilado
 * desde MJML) más su versión de texto plano. Todo valor se escapa antes de entrar al HTML.
 */
const LAYOUT = readFileSync(new URL('./layout.html', import.meta.url), 'utf8');

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export interface EmailData {
  name: string;
  /** Enlace con el token de un solo uso. */
  actionUrl: string;
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

export function renderEmail(template: EmailTemplate, locale: Locale, data: EmailData): RenderedEmail {
  if (!/^https?:\/\//.test(data.actionUrl)) throw new Error('El enlace del correo debe ser http(s).');
  const texts = EMAIL_TEXTS[template][locale];
  const common = COMMON_TEXTS[locale];
  const greeting = texts.greeting.replace('{name}', data.name);
  const values: Record<string, string> = {
    lang: locale,
    subject: texts.subject,
    preheader: texts.preheader,
    title: texts.title,
    greeting,
    body: texts.body,
    ctaLabel: texts.ctaLabel,
    ctaUrl: data.actionUrl,
    expiry: texts.expiry,
    fallbackLabel: common.fallbackLabel,
    ignore: texts.ignore,
    footer: common.footer,
  };
  const html = LAYOUT.replace(/\{\{([a-zA-Z]+)\}\}/g, (match, key: string) => {
    const value = values[key];
    if (value === undefined) throw new Error(`Falta el valor ${match} en la plantilla.`);
    return escapeHtml(value);
  });
  const text = [
    'Marea Baja',
    '',
    texts.title,
    '',
    greeting,
    '',
    texts.body,
    '',
    `${texts.ctaLabel}: ${data.actionUrl}`,
    '',
    texts.expiry,
    texts.ignore,
    '',
    '—',
    common.footer,
    '',
  ].join('\n');
  return { subject: texts.subject, html, text };
}
