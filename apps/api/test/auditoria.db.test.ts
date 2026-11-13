/**
 * AuditLog de solo inserción y permisos del rol de la aplicación (propuesta §8.6, R-AUD-01).
 * - El rol de la aplicación solo tiene SELECT e INSERT sobre el AuditLog.
 * - El trigger rechaza UPDATE, DELETE y TRUNCATE aunque el rol tenga permisos (propietario).
 */
import { describe, expect, it } from 'vitest';
import { PG, appUrl, expectPgError, inRolledBackTx, insertAudit, insertUser, ownerUrl } from './db.ts';

describe('rol de la aplicación sobre el AuditLog', () => {
  it('puede insertar y leer', async () => {
    await inRolledBackTx(appUrl(), async (q) => {
      const id = await insertAudit(q, 'p-lectura');
      const { rows } = await q(`SELECT "action", "after" FROM "AuditLog" WHERE "id" = $1`, [id]);
      expect(rows[0]).toEqual({ action: 'product.price_changed', after: { basePriceMinor: 900000 } });
    });
  });

  it.each([
    ['UPDATE', `UPDATE "AuditLog" SET "reason" = 'editado'`],
    ['DELETE', `DELETE FROM "AuditLog"`],
    ['TRUNCATE', `TRUNCATE "AuditLog"`],
  ])('no tiene permiso de %s', async (_operation, sql) => {
    await expectPgError(
      appUrl(),
      async (q) => {
        await insertAudit(q);
        await q(sql);
      },
      { code: PG.insufficientPrivilege, message: /permission denied/ },
    );
  });
});

describe('trigger del AuditLog (aunque el rol tenga permisos)', () => {
  it.each([
    ['UPDATE', `UPDATE "AuditLog" SET "reason" = 'editado'`],
    ['DELETE', `DELETE FROM "AuditLog"`],
    ['TRUNCATE', `TRUNCATE "AuditLog"`],
  ])('el propietario tampoco puede hacer %s', async (operation, sql) => {
    await expectPgError(
      ownerUrl(),
      async (q) => {
        await insertAudit(q);
        await q(sql);
      },
      { code: PG.insufficientPrivilege, message: new RegExp(`solo inserción: ${operation}`) },
    );
  });

  it('no se puede borrar un usuario con entradas de auditoría (la traza no queda huérfana)', async () => {
    await expectPgError(
      ownerUrl(),
      async (q) => {
        const userId = await insertUser(q);
        await q(
          `INSERT INTO "AuditLog" ("actorUserId", "action", "entityType", "entityId") VALUES ($1::uuid, 'x', 'User', $1::text)`,
          [userId],
        );
        await q(`DELETE FROM "User" WHERE "id" = $1`, [userId]);
      },
      { code: PG.foreignKeyViolation },
    );
  });
});

describe('alcance del rol de la aplicación', () => {
  it('lee y escribe las tablas de datos', async () => {
    await inRolledBackTx(appUrl(), async (q) => {
      const userId = await insertUser(q, 'app@marea.test');
      await q(`UPDATE "User" SET "name" = 'Otro nombre' WHERE "id" = $1`, [userId]);
      await q(`DELETE FROM "User" WHERE "id" = $1`, [userId]);
      const { rows } = await q(`SELECT count(*)::int AS total FROM "Product"`);
      expect((rows[0] as { total: number }).total).toBeGreaterThan(0);
    });
  });

  it('no puede cambiar el esquema', async () => {
    await expectPgError(appUrl(), (q) => q(`CREATE TABLE "Intrusa" ("id" int)`), {
      code: PG.insufficientPrivilege,
    });
    await expectPgError(appUrl(), (q) => q(`DROP TABLE "Product"`), { code: PG.insufficientPrivilege });
    await expectPgError(appUrl(), (q) => q(`DROP TRIGGER "AuditLog_no_update_delete" ON "AuditLog"`), {
      code: PG.insufficientPrivilege,
    });
  });

  it('no ve el historial de migraciones', async () => {
    await expectPgError(appUrl(), (q) => q(`SELECT * FROM "_prisma_migrations"`), {
      code: PG.insufficientPrivilege,
    });
  });

  it('no es superusuario ni puede crear roles o bases', async () => {
    await inRolledBackTx(appUrl(), async (q) => {
      const { rows } = await q(
        `SELECT rolsuper, rolcreaterole, rolcreatedb, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
      );
      expect(rows[0]).toEqual({
        rolsuper: false,
        rolcreaterole: false,
        rolcreatedb: false,
        rolbypassrls: false,
      });
    });
  });
});
