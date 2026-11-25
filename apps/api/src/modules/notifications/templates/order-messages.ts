import type { Locale } from '@marea-baja/shared';

/**
 * Correos de pedidos (M7, §8.5) en es-CR y en (D2). De clientes: pedido recibido, confirmado, en
 * preparación, listo / en camino, entregado, cancelado y reembolso. De administración: "nuevo
 * pedido por confirmar".
 *
 * Marcadores: `{name}` (nombre de quien recibe), `{code}` (código del pedido), `{amount}` (monto
 * del reembolso, ya formateado) y `{fulfillment}` (retiro o delivery). Todo valor se escapa al
 * entrar al HTML. Ningún correo lleva la dirección, el teléfono ni datos de pago.
 */
export const ORDER_EMAIL_TEMPLATES = [
  'order-received',
  'order-confirmed',
  'order-preparing',
  'order-ready',
  'order-out-for-delivery',
  'order-delivered',
  'order-cancelled',
  'order-refunded',
  'staff-new-order',
] as const;
export type OrderEmailTemplate = (typeof ORDER_EMAIL_TEMPLATES)[number];

export interface OrderEmailTexts {
  subject: string;
  preheader: string;
  title: string;
  greeting: string;
  body: string;
  ctaLabel: string;
}

const HELLO: Record<Locale, string> = { 'es-CR': 'Hola, {name}:', en: 'Hi {name},' };
const VIEW: Record<Locale, string> = { 'es-CR': 'Ver mi pedido', en: 'View my order' };

export const FULFILLMENT_TEXTS: Record<Locale, Record<'PICKUP' | 'DELIVERY', string>> = {
  'es-CR': { PICKUP: 'retiro en el local', DELIVERY: 'delivery' },
  en: { PICKUP: 'pickup', DELIVERY: 'delivery' },
};

export const ORDER_COMMON_TEXTS: Record<Locale, { codeLabel: string }> = {
  'es-CR': { codeLabel: 'Pedido' },
  en: { codeLabel: 'Order' },
};

function texts(
  es: Omit<OrderEmailTexts, 'greeting' | 'ctaLabel'> & Partial<OrderEmailTexts>,
  en: Omit<OrderEmailTexts, 'greeting' | 'ctaLabel'> & Partial<OrderEmailTexts>,
): Record<Locale, OrderEmailTexts> {
  return {
    'es-CR': { greeting: HELLO['es-CR'], ctaLabel: VIEW['es-CR'], ...es },
    en: { greeting: HELLO.en, ctaLabel: VIEW.en, ...en },
  };
}

export const ORDER_EMAIL_TEXTS: Record<OrderEmailTemplate, Record<Locale, OrderEmailTexts>> = {
  'order-received': texts(
    {
      subject: 'Recibimos tu pedido {code} · Marea Baja',
      preheader: 'El local lo revisa y te avisamos apenas lo confirme.',
      title: 'Recibimos tu pedido',
      body: 'Tu pedido {code} quedó registrado. El local lo revisa y te avisamos apenas lo confirme.',
    },
    {
      subject: 'We received your order {code} · Marea Baja',
      preheader: 'The restaurant is reviewing it; we’ll let you know once it’s confirmed.',
      title: 'We received your order',
      body: 'Your order {code} has been placed. The restaurant is reviewing it and we’ll let you know as soon as it’s confirmed.',
    },
  ),
  'order-confirmed': texts(
    {
      subject: 'Confirmamos tu pedido {code} · Marea Baja',
      preheader: 'Ya está en la fila de la cocina.',
      title: 'Pedido confirmado',
      body: 'El local confirmó tu pedido {code}. Ya está en la fila de la cocina.',
    },
    {
      subject: 'Your order {code} is confirmed · Marea Baja',
      preheader: 'It’s now in the kitchen queue.',
      title: 'Order confirmed',
      body: 'The restaurant confirmed your order {code}. It’s now in the kitchen queue.',
    },
  ),
  'order-preparing': texts(
    {
      subject: 'Tu pedido {code} está en preparación · Marea Baja',
      preheader: 'La cocina empezó a prepararlo.',
      title: 'En preparación',
      body: 'La cocina empezó a preparar tu pedido {code}.',
    },
    {
      subject: 'Your order {code} is being prepared · Marea Baja',
      preheader: 'The kitchen has started on it.',
      title: 'Being prepared',
      body: 'The kitchen has started preparing your order {code}.',
    },
  ),
  'order-ready': texts(
    {
      subject: 'Tu pedido {code} está listo para retirar · Marea Baja',
      preheader: 'Ya podés pasar por el local.',
      title: 'Listo para retirar',
      body: 'Tu pedido {code} está listo. Ya podés pasar a retirarlo; decí el código en la barra.',
    },
    {
      subject: 'Your order {code} is ready for pickup · Marea Baja',
      preheader: 'You can come by the restaurant now.',
      title: 'Ready for pickup',
      body: 'Your order {code} is ready. Come by to pick it up and give the code at the counter.',
    },
  ),
  'order-out-for-delivery': texts(
    {
      subject: 'Tu pedido {code} va en camino · Marea Baja',
      preheader: 'Salió del local hacia tu dirección.',
      title: 'En camino',
      body: 'Tu pedido {code} salió del local y va en camino a tu dirección.',
    },
    {
      subject: 'Your order {code} is on its way · Marea Baja',
      preheader: 'It has left the restaurant for your address.',
      title: 'On its way',
      body: 'Your order {code} has left the restaurant and is on its way to your address.',
    },
  ),
  'order-delivered': texts(
    {
      subject: 'Entregamos tu pedido {code} · Marea Baja',
      preheader: 'Gracias por pedir en Marea Baja.',
      title: 'Pedido entregado',
      body: 'Tu pedido {code} fue entregado. Gracias por pedir en Marea Baja.',
    },
    {
      subject: 'Your order {code} was delivered · Marea Baja',
      preheader: 'Thanks for ordering from Marea Baja.',
      title: 'Order delivered',
      body: 'Your order {code} was delivered. Thanks for ordering from Marea Baja.',
    },
  ),
  'order-cancelled': texts(
    {
      subject: 'Cancelamos tu pedido {code} · Marea Baja',
      preheader: 'El pedido no sigue adelante.',
      title: 'Pedido cancelado',
      body: 'Tu pedido {code} fue cancelado. Si se había reservado o cobrado algo con la tarjeta demo, se liberó o se devolvió. En esta demostración no se mueve dinero real.',
    },
    {
      subject: 'Your order {code} was cancelled · Marea Baja',
      preheader: 'The order won’t go ahead.',
      title: 'Order cancelled',
      body: 'Your order {code} was cancelled. Anything held or charged on the demo card has been released or refunded. No real money moves in this demo.',
    },
  ),
  'order-refunded': texts(
    {
      subject: 'Devolvimos {amount} de tu pedido {code} · Marea Baja',
      preheader: 'Se registró una devolución a la tarjeta demo.',
      title: 'Devolución registrada',
      body: 'Se registró una devolución de {amount} del pedido {code} a la tarjeta demo. Es una demostración: no se movió dinero real.',
    },
    {
      subject: 'We refunded {amount} of your order {code} · Marea Baja',
      preheader: 'A refund to the demo card has been recorded.',
      title: 'Refund recorded',
      body: 'A refund of {amount} for order {code} has been recorded on the demo card. This is a demo: no real money moved.',
    },
  ),
  'staff-new-order': texts(
    {
      subject: 'Nuevo pedido por confirmar: {code} · Marea Baja',
      preheader: 'Está esperando en el Pase.',
      title: 'Nuevo pedido por confirmar',
      body: 'Entró el pedido {code} ({fulfillment}). Está esperando la confirmación del local en el Pase.',
      ctaLabel: 'Abrir el Pase',
    },
    {
      subject: 'New order to confirm: {code} · Marea Baja',
      preheader: 'It’s waiting on the Pass.',
      title: 'New order to confirm',
      body: 'Order {code} ({fulfillment}) just came in. It’s waiting for the restaurant to confirm it on the Pass.',
      ctaLabel: 'Open the Pass',
    },
  ),
};
