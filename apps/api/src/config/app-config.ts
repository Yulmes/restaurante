import type { Env } from './env.ts';

/** Configuración de la app derivada del entorno validado. Las pruebas la construyen a mano. */
export interface AppConfig {
  production: boolean;
  /** Origen exacto de la web (`https://…`), exigido en `Origin` (§8.3). */
  webOrigin: string;
  /** Base de los enlaces de los correos. */
  publicWebUrl: string;
  appSecret: string;
  emailFrom: string;
  turnstileDefaults: { threshold: number; windowMinutes: number };
  /** D-M5-3: pedidos fuera de horario solo con el modo de demostración explícito (por defecto, no). */
  ordersAllowOutsideHours: boolean;
  /** §7.4: la tarjeta demo solo se acepta con `DEMO_PAYMENTS_ENABLED=true` (por defecto, no). */
  demoPaymentsEnabled: boolean;
  /** M7: a cuánto tiempo sin confirmar se cancela un pedido y se anula su pago (§7.1, 20 min). */
  orderConfirmationTimeoutMs: number;
  /** M10 (D-M10-2): secretos de origen aceptados. Vacío: sin Worker delante (desarrollo y pruebas). */
  originSecrets: readonly string[];
  /** M10 (D-M10-1): secretos del endpoint interno de tareas. Vacío: el endpoint no existe (404). */
  tasksSecrets: readonly string[];
  /** M10 (D-M10-P1): verificación del correo desde la bandeja demo. */
  demoEmailVerification: boolean;
}

export function appConfigFromEnv(env: Env): AppConfig {
  return {
    production: env.NODE_ENV === 'production',
    webOrigin: new URL(env.PUBLIC_WEB_URL).origin,
    publicWebUrl: env.PUBLIC_WEB_URL.replace(/\/+$/, ''),
    appSecret: env.APP_SECRET,
    emailFrom: env.EMAIL_FROM,
    turnstileDefaults: {
      threshold: env.TURNSTILE_GLOBAL_THRESHOLD,
      windowMinutes: env.TURNSTILE_WINDOW_MINUTES,
    },
    ordersAllowOutsideHours: env.ORDERS_ALLOW_OUTSIDE_HOURS,
    demoPaymentsEnabled: env.DEMO_PAYMENTS_ENABLED,
    orderConfirmationTimeoutMs: env.ORDER_CONFIRMATION_TIMEOUT_MINUTES * 60_000,
    originSecrets: env.ORIGIN_SECRETS,
    tasksSecrets: env.TASKS_SECRETS,
    demoEmailVerification: env.DEMO_EMAIL_VERIFICATION_ENABLED,
  };
}

/**
 * Cookies (§8.2): en producción `__Host-` obliga `Secure`, `Path=/` y sin `Domain`.
 * En desarrollo, sin `Secure` porque no hay HTTPS local.
 */
export function cookieNames(config: AppConfig): { session: string; guestCsrf: string } {
  return config.production
    ? { session: '__Host-mb_session', guestCsrf: '__Host-mb_csrf' }
    : { session: 'mb_session', guestCsrf: 'mb_csrf' };
}
