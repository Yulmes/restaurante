import { resolveLocale, type DemoInboxResponse } from '@marea-baja/shared';
import { Router } from 'express';
import type { PrismaClient } from '../../generated/prisma/client.ts';
import { authOf, requireAuth } from '../../middleware/rbac.ts';
import { readPayload } from './outbox.ts';
import { isEmailTemplate, isOrderTemplate, renderInboxEmail } from './templates/render.ts';

/**
 * Bandeja de demostración (§8.5, M7): los correos de la propia cuenta con su estado honesto.
 * - `DEMO_ONLY`: "Notificación de demostración — este correo no se envió".
 * - `SENT`: "Enviado a tu@correo · aceptado por el proveedor".
 * - `QUEUED` y `FAILED` también se muestran tal cual.
 *
 * Nunca devuelve enlaces: los de un solo uso (verificación, recuperación) no salen de la base, y
 * los de pedidos se reemplazan por el id del pedido, que la web enlaza a su propia página.
 */
const INBOX_LIMIT = 50;
const ORDER_PATH = /\/(?:cuenta\/pedidos|en\/account\/orders)\/([0-9a-f-]{36})$/;

export async function demoInbox(
  db: PrismaClient,
  userId: string,
  options: { demoVerification: boolean } = { demoVerification: false },
): Promise<DemoInboxResponse> {
  // M10 (D-M10-P1): solo el último correo de verificación, de una cuenta sin verificar, en la demo.
  let verifiableId: string | null = null;
  if (options.demoVerification) {
    const user = await db.user.findUnique({ where: { id: userId }, select: { emailVerifiedAt: true } });
    if (user && !user.emailVerifiedAt) {
      const latest = await db.emailOutbox.findFirst({
        where: { userId, template: 'email-verification' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true, status: true },
      });
      if (latest?.status === 'DEMO_ONLY') verifiableId = latest.id;
    }
  }
  const rows = await db.emailOutbox.findMany({
    where: { userId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: INBOX_LIMIT,
    select: {
      id: true,
      template: true,
      status: true,
      to: true,
      locale: true,
      payload: true,
      createdAt: true,
      sentAt: true,
    },
  });
  return {
    messages: rows.flatMap((row) => {
      if (!isEmailTemplate(row.template)) return [];
      const locale = resolveLocale(row.locale.replace('_', '-'));
      const data = readPayload(row.payload);
      const { subject, body } = renderInboxEmail(row.template, locale, data);
      const orderId = isOrderTemplate(row.template)
        ? (ORDER_PATH.exec(data.actionUrl ?? '')?.[1] ?? null)
        : null;
      return [
        {
          id: row.id,
          template: row.template,
          status: row.status,
          to: row.to,
          locale,
          subject,
          body,
          orderId,
          demoVerifiable: row.id === verifiableId,
          createdAt: row.createdAt.toISOString(),
          sentAt: row.sentAt ? row.sentAt.toISOString() : null,
        },
      ];
    }),
  };
}

export function notificationRouter(db: PrismaClient, demoVerification = false): Router {
  const router = Router();
  router.get('/me/notifications', requireAuth, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await demoInbox(db, authOf(req).userId, { demoVerification }));
  });
  return router;
}
