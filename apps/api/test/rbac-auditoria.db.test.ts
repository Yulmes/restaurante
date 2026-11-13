/**
 * RBAC (§8.7, R-SEC-06), AuditLog transaccional (§8.6, R-AUD-01) y outbox (§8.5).
 */
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HOUR, MINUTE } from '../src/lib/clock.ts';
import { requireRole, requireVerifiedEmail } from '../src/middleware/rbac.ts';
import { recordAudit } from '../src/modules/audit/audit.ts';
import { OUTBOX_MAX_ATTEMPTS, enqueueEmail, processOutbox } from '../src/modules/notifications/outbox.ts';
import { setUserRoles } from '../src/modules/users/roles.ts';
import { createLogger } from '../src/config/logger.ts';
import { PG, expectPgError, appUrl } from './db.ts';
import { Browser, buildApi, registerUser, setCookie, signIn, uniqueEmail, type TestApi } from './http.ts';

const routes = Router();
routes.get('/test/staff', requireRole('STAFF', 'ADMIN'), (_req, res) => {
  res.json({ ok: true });
});
routes.get('/test/admin', requireRole('ADMIN'), (_req, res) => {
  res.json({ ok: true });
});
routes.get('/test/verified', requireVerifiedEmail, (_req, res) => {
  res.json({ ok: true });
});

let api: TestApi;
beforeAll(() => {
  api = buildApi({ extraRoutes: routes });
});
afterAll(async () => {
  await api.close();
});

async function userWithRoles(
  roles: ('CUSTOMER' | 'STAFF' | 'ADMIN')[],
  verify = true,
): Promise<{ email: string; browser: Browser }> {
  const { email } = await registerUser(api, { verify });
  if (roles.join() !== 'CUSTOMER')
    await setUserRoles(api.db, { email, roles, actor: null, reason: 'prueba' });
  return { email, browser: await signIn(api, email) };
}

describe('RBAC: matriz de roles (§8.7)', () => {
  it.each([
    ['invitado', null, 401, 401, 401],
    ['cliente sin verificar', ['CUSTOMER'], 403, 403, 403],
    ['cliente verificado', ['CUSTOMER'], 403, 403, 200],
    ['staff', ['STAFF'], 200, 403, 200],
    ['admin', ['ADMIN'], 200, 200, 200],
  ] as const)(
    '%s → staff %i, admin %i, pagar (verificado) %i',
    async (label, roles, staff, admin, verified) => {
      const browser = roles
        ? (await userWithRoles([...roles], label !== 'cliente sin verificar')).browser
        : new Browser(api);
      expect((await browser.get('/api/test/staff')).status).toBe(staff);
      expect((await browser.get('/api/test/admin')).status).toBe(admin);
      const pay = await browser.get('/api/test/verified');
      expect(pay.status).toBe(verified);
      if (label === 'cliente sin verificar')
        expect(pay.body).toMatchObject({ error: { code: 'EMAIL_NOT_VERIFIED' } });
    },
  );
});

describe('cambio de roles con AuditLog en la misma transacción', () => {
  it('cambia los roles, deja la entrada con el correo enmascarado y rota las sesiones con la política de staff', async () => {
    const { email } = await registerUser(api, { verify: true });
    const browser = await signIn(api, email);
    const requestId = randomUUID();
    const result = await setUserRoles(api.db, {
      email,
      roles: ['CUSTOMER', 'STAFF'],
      actor: null,
      reason: 'Contratación de cocina',
      requestId,
    });
    expect(result).toMatchObject({ before: ['CUSTOMER'], after: ['CUSTOMER', 'STAFF'], changed: true });

    const entry = await api.db.auditLog.findFirstOrThrow({
      where: { entityId: result.userId, action: 'user.roles_changed' },
    });
    expect(entry).toMatchObject({
      entityType: 'user',
      actorUserId: null,
      reason: 'Contratación de cocina',
      requestId,
      before: { email: expect.stringMatching(/^c\*\*\*@example\.com$/) as string, roles: ['CUSTOMER'] },
      after: { roles: ['CUSTOMER', 'STAFF'] },
    });
    expect(JSON.stringify(entry)).not.toContain(email);

    // La sesión abierta rota en la próxima petición y pasa a vencer en 12 h como máximo.
    const res = await browser.get('/api/auth/me');
    expect(res.status).toBe(200);
    expect(setCookie(res, 'mb_session')).toBeDefined();
    expect((res.body as { user: { roles: string[] } }).user.roles).toEqual(['CUSTOMER', 'STAFF']);
    const session = await api.db.session.findFirstOrThrow({
      where: { userId: result.userId, revokedAt: null },
    });
    expect(session.absoluteExpiresAt.getTime() - session.createdAt.getTime()).toBeLessThanOrEqual(12 * HOUR);
    api.clock.advance(2 * HOUR + MINUTE);
    expect((await browser.get('/api/auth/me')).status).toBe(401);
  });

  it('si la entrada de auditoría falla, el cambio de roles no se confirma (rollback)', async () => {
    const { email } = await registerUser(api);
    await expect(
      setUserRoles(api.db, {
        email,
        roles: ['ADMIN'],
        // Actor inexistente: la clave foránea del AuditLog falla dentro de la transacción.
        actor: { userId: randomUUID(), role: 'ADMIN' },
        reason: 'debe revertirse',
      }),
    ).rejects.toThrow();
    const user = await api.db.user.findFirstOrThrow({
      where: { email },
      include: { roles: { include: { role: true } } },
    });
    expect(user.roles.map((r) => r.role.key)).toEqual(['CUSTOMER']);
    expect(await api.db.auditLog.count({ where: { entityId: user.id } })).toBe(0);
  });

  it('si el cambio falla después de auditar, la entrada tampoco queda', async () => {
    const { email } = await registerUser(api);
    const user = await api.db.user.findFirstOrThrow({ where: { email } });
    await expect(
      api.db.$transaction(async (tx) => {
        await recordAudit(tx, {
          actor: null,
          action: 'user.roles_changed',
          entityType: 'user',
          entityId: user.id,
          after: { roles: ['ADMIN'] },
        });
        throw new Error('fallo posterior');
      }),
    ).rejects.toThrow('fallo posterior');
    expect(await api.db.auditLog.count({ where: { entityId: user.id } })).toBe(0);
  });

  it('la entrada creada por la aplicación no se puede editar ni borrar (solo inserción)', async () => {
    const { email } = await registerUser(api);
    const { userId } = await setUserRoles(api.db, { email, roles: ['STAFF'], actor: null, reason: 'prueba' });
    const entry = await api.db.auditLog.findFirstOrThrow({ where: { entityId: userId } });
    await expectPgError(appUrl(), (q) => q(`UPDATE "AuditLog" SET reason = 'x' WHERE id = $1`, [entry.id]), {
      code: PG.insufficientPrivilege,
    });
    await expectPgError(appUrl(), (q) => q(`DELETE FROM "AuditLog" WHERE id = $1`, [entry.id]), {
      code: PG.insufficientPrivilege,
    });
  });
});

describe('outbox (§8.5)', () => {
  it('un correo encolado en una transacción revertida no existe', async () => {
    const to = uniqueEmail('revertido');
    await expect(
      api.db.$transaction(async (tx) => {
        await enqueueEmail(
          tx,
          {
            userId: null,
            to,
            locale: 'es-CR',
            template: 'password-reset',
            data: { name: 'A', actionUrl: 'http://web.test/x' },
          },
          api.clock.now(),
        );
        throw new Error('la operación falló');
      }),
    ).rejects.toThrow();
    expect(await api.db.emailOutbox.count({ where: { to } })).toBe(0);
  });

  it('reintenta con espera exponencial y queda FAILED tras 5 intentos, sin el enlace', async () => {
    const to = uniqueEmail('caido');
    await api.db.$transaction((tx) =>
      enqueueEmail(
        tx,
        {
          userId: null,
          to,
          locale: 'en',
          template: 'email-verification',
          data: { name: 'A', actionUrl: 'http://web.test/v#token=x' },
        },
        api.clock.now(),
      ),
    );
    api.email.failing = true;
    const logger = createLogger({ level: 'silent' });
    try {
      for (let attempt = 1; attempt <= OUTBOX_MAX_ATTEMPTS; attempt += 1) {
        await processOutbox({ db: api.db, provider: api.email, clock: api.clock, logger });
        const row = await api.db.emailOutbox.findFirstOrThrow({ where: { to } });
        expect(row.attempts).toBe(attempt);
        if (attempt < OUTBOX_MAX_ATTEMPTS) {
          expect(row.status).toBe('QUEUED');
          expect(row.nextAttemptAt.getTime() - api.clock.now().getTime()).toBe(2 ** (attempt - 1) * MINUTE);
          // Antes de la espera no se reintenta.
          await processOutbox({ db: api.db, provider: api.email, clock: api.clock, logger });
          expect((await api.db.emailOutbox.findFirstOrThrow({ where: { to } })).attempts).toBe(attempt);
          api.clock.advance(2 ** (attempt - 1) * MINUTE);
        } else {
          expect(row.status).toBe('FAILED');
          expect(row.lastError).toContain('caído');
          expect(row.payload).toEqual({});
        }
      }
    } finally {
      api.email.failing = false;
    }
  });
});
