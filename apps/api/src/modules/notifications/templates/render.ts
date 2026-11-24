import { readFileSync } from 'node:fs';
import type { Locale } from '@marea-baja/shared';
import { COMMON_TEXTS, EMAIL_TEXTS, TOKEN_EMAIL_TEMPLATES, type TokenEmailTemplate } from './messages.ts';
import {
  FULFILLMENT_TEXTS,
  ORDER_COMMON_TEXTS,
  ORDER_EMAIL_TEMPLATES,
  ORDER_EMAIL_TEXTS,
  type OrderEmailTemplate,
} from './order-messages.ts';

/**
 * Renderiza los correos (ADR 0004): HTML compatible con Gmail y Outlook (tablas, compilado desde
 * MJML) más su versión de texto plano. Todo valor se escapa antes de entrar al HTML.
 *
 * - Correos con enlace de un solo uso (M3): `layout.html`.
 * - Correos de pedidos y el aviso al staff (M7): `order-layout.html`.
 */
const LAYOUT = readFileSync(new URL('./layout.html', import.meta.url), 'utf8');
const ORDER_LAYOUT = readFileSync(new URL('./order-layout.html', import.meta.url), 'utf8');

export const EMAIL_TEMPLATES = [...TOKEN_EMAIL_TEMPLATES, ...ORDER_EMAIL_TEMPLATES] as const;
export type EmailTemplate = TokenEmailTemplate | OrderEmailTemplate;

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export interface EmailData {
  name: string;
  /** Enlace del botón: el token de un solo uso (M3) o la página del pedido (M7). */
  actionUrl: string;
  /** M7: código del pedido (`MB-…`). */
  orderCode?: string;
  /** M7: monto del reembolso, ya formateado en el idioma del correo. */
  amount?: string;
  /** M7: modalidad del pedido, para el aviso al staff. */
  fulfillmentType?: 'PICKUP' | 'DELIVERY';
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

export function isEmailTemplate(value: string): value is EmailTemplate {
  return (EMAIL_TEMPLATES as readonly string[]).includes(value);
}

export function isOrderTemplate(value: string): value is OrderEmailTemplate {
  return (ORDER_EMAIL_TEMPLATES as readonly string[]).includes(value);
}

function fill(layout: string, values: Record<string, string>): string {
  return layout.replace(/\{\{([a-zA-Z]+)\}\}/g, (match, key: string) => {
    const value = values[key];
    if (value === undefined) throw new Error(`Falta el valor ${match} en la plantilla.`);
    return escapeHtml(value);
  });
}

/** Reemplaza `{name}`, `{code}`, `{amount}` y `{fulfillment}` en un texto de pedido. */
function orderText(text: string, locale: Locale, data: EmailData): string {
  return text
    .replaceAll('{name}', data.name)
    .replaceAll('{code}', data.orderCode ?? '')
    .replaceAll('{amount}', data.amount ?? '')
    .replaceAll('{fulfillment}', data.fulfillmentType ? FULFILLMENT_TEXTS[locale][data.fulfillmentType] : '');
}

function orderTexts(template: OrderEmailTemplate, locale: Locale, data: EmailData) {
  const texts = ORDER_EMAIL_TEXTS[template][locale];
  return {
    subject: orderText(texts.subject, locale, data),
    preheader: orderText(texts.preheader, locale, data),
    title: orderText(texts.title, locale, data),
    greeting: orderText(texts.greeting, locale, data),
    body: orderText(texts.body, locale, data),
    ctaLabel: texts.ctaLabel,
  };
}

export function renderEmail(template: EmailTemplate, locale: Locale, data: EmailData): RenderedEmail {
  if (!/^https?:\/\//.test(data.actionUrl)) throw new Error('El enlace del correo debe ser http(s).');
  const common = COMMON_TEXTS[locale];

  if (isOrderTemplate(template)) {
    if (!data.orderCode) throw new Error('Los correos de pedidos necesitan el código del pedido.');
    const texts = orderTexts(template, locale, data);
    const codeLabel = ORDER_COMMON_TEXTS[locale].codeLabel;
    const html = fill(ORDER_LAYOUT, {
      lang: locale,
      ...texts,
      codeLabel,
      code: data.orderCode,
      ctaUrl: data.actionUrl,
      fallbackLabel: common.fallbackLabel,
      footer: common.footer,
    });
    const text = [
      'Marea Baja',
      '',
      `${codeLabel} ${data.orderCode}`,
      texts.title,
      '',
      texts.greeting,
      '',
      texts.body,
      '',
      `${texts.ctaLabel}: ${data.actionUrl}`,
      '',
      '—',
      common.footer,
      '',
    ].join('\n');
    return { subject: texts.subject, html, text };
  }

  const texts = EMAIL_TEXTS[template][locale];
  const greeting = texts.greeting.replace('{name}', data.name);
  const html = fill(LAYOUT, {
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

/**
 * Versión del correo para la bandeja de demostración (§8.5): asunto y párrafos, **sin ningún
 * enlace**. Los correos con enlace de un solo uso solo muestran su texto general: el enlace nunca
 * sale de la base hacia la bandeja (y ya se borró al enviarlo).
 */
export function renderInboxEmail(
  template: EmailTemplate,
  locale: Locale,
  data: Partial<EmailData>,
): { subject: string; body: string[] } {
  if (isOrderTemplate(template)) {
    const texts = orderTexts(template, locale, { name: '', actionUrl: '', ...data });
    const greeting = data.name ? texts.greeting : null;
    return { subject: texts.subject, body: [texts.title, ...(greeting ? [greeting] : []), texts.body] };
  }
  const texts = EMAIL_TEXTS[template][locale];
  return { subject: texts.subject, body: [texts.title, texts.body, texts.expiry] };
}
