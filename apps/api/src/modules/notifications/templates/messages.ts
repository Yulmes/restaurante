import type { Locale } from '@marea-baja/shared';

/**
 * Textos de los correos de M3 en es-CR y en (D2, §8.5). Los correos de pedidos llegan en M7.
 * `{name}` se reemplaza por el nombre del usuario (escapado en el HTML).
 */
export const EMAIL_TEMPLATES = ['email-verification', 'password-reset'] as const;
export type EmailTemplate = (typeof EMAIL_TEMPLATES)[number];

export interface EmailTexts {
  subject: string;
  preheader: string;
  title: string;
  greeting: string;
  body: string;
  ctaLabel: string;
  expiry: string;
  ignore: string;
}

export const COMMON_TEXTS: Record<Locale, { fallbackLabel: string; footer: string }> = {
  'es-CR': {
    fallbackLabel: 'Si el botón no funciona, copiá este enlace en el navegador:',
    footer:
      'Marea Baja es un restaurante ficticio de demostración. Recibiste este correo porque alguien usó esta dirección en el sitio de demostración.',
  },
  en: {
    fallbackLabel: 'If the button doesn’t work, copy this link into your browser:',
    footer:
      'Marea Baja is a fictional demo restaurant. You received this email because someone used this address on the demo site.',
  },
};

export const EMAIL_TEXTS: Record<EmailTemplate, Record<Locale, EmailTexts>> = {
  'email-verification': {
    'es-CR': {
      subject: 'Confirmá tu correo · Marea Baja',
      preheader: 'Un paso más para poder pagar tus pedidos.',
      title: 'Confirmá tu correo',
      greeting: 'Hola, {name}:',
      body: 'Gracias por crear tu cuenta en Marea Baja. Para poder pagar tus pedidos, confirmá que este correo es tuyo.',
      ctaLabel: 'Confirmar mi correo',
      expiry: 'El enlace vale 24 horas y se puede usar una sola vez.',
      ignore: 'Si no creaste esta cuenta, ignorá este mensaje.',
    },
    en: {
      subject: 'Confirm your email · Marea Baja',
      preheader: 'One more step before you can pay for your orders.',
      title: 'Confirm your email',
      greeting: 'Hi {name},',
      body: 'Thanks for creating your Marea Baja account. To pay for your orders, please confirm that this email address is yours.',
      ctaLabel: 'Confirm my email',
      expiry: 'The link is valid for 24 hours and can be used only once.',
      ignore: 'If you didn’t create this account, you can ignore this message.',
    },
  },
  'password-reset': {
    'es-CR': {
      subject: 'Restablecé tu contraseña · Marea Baja',
      preheader: 'Pediste cambiar la contraseña de tu cuenta.',
      title: 'Restablecé tu contraseña',
      greeting: 'Hola, {name}:',
      body: 'Recibimos un pedido para restablecer la contraseña de tu cuenta. Al cambiarla, se cierran todas tus sesiones abiertas.',
      ctaLabel: 'Elegir una contraseña nueva',
      expiry: 'El enlace vale 30 minutos y se puede usar una sola vez.',
      ignore: 'Si no lo pediste, ignorá este mensaje: tu contraseña no cambia.',
    },
    en: {
      subject: 'Reset your password · Marea Baja',
      preheader: 'You asked to change your account password.',
      title: 'Reset your password',
      greeting: 'Hi {name},',
      body: 'We received a request to reset your account password. Changing it signs you out of every open session.',
      ctaLabel: 'Choose a new password',
      expiry: 'The link is valid for 30 minutes and can be used only once.',
      ignore: 'If you didn’t ask for this, ignore this message: your password stays the same.',
    },
  },
};
