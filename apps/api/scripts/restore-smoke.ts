/**
 * Humo de la aplicación sobre una base restaurada (ADR 0010, D-M10-8): lo corre
 * `ops/backup/restore-test.sh` después de restaurar y de `prisma migrate status`.
 *
 *   RESTORE_DATABASE_URL=… node scripts/restore-smoke.ts
 *
 * Usa el cliente de Prisma y los servicios reales de la API (no SQL suelto): si el esquema
 * restaurado no sirve para la aplicación, falla. Solo imprime conteos y "OK"; nunca datos.
 */
import { createPrismaClient } from '../src/db/client.ts';
import { systemClock } from '../src/lib/clock.ts';
import { CatalogService } from '../src/modules/catalog/service.ts';

const url = process.env['RESTORE_DATABASE_URL'];
if (!url) {
  console.error('Falta RESTORE_DATABASE_URL.');
  process.exit(1);
}

const db = createPrismaClient(url);
try {
  const catalog = new CatalogService(db, systemClock);
  const es = await catalog.catalog('es-CR');
  const en = await catalog.catalog('en');
  const products = es.categories.reduce((sum, category) => sum + category.products.length, 0);
  if (es.categories.length === 0 || products === 0) throw new Error('la carta restaurada está vacía');
  if (en.categories.length !== es.categories.length) throw new Error('la carta en inglés no coincide');
  await catalog.openingHours();
  await catalog.version();

  const settings = await db.restaurantSettings.count();
  if (settings !== 1) throw new Error('falta la configuración del restaurante');
  const [users, orders, payments, audit] = await Promise.all([
    db.user.count(),
    db.order.count(),
    db.payment.count(),
    db.auditLog.count(),
  ]);
  // Las relaciones se leen como la API: un pedido con su pago e historial, si hay pedidos.
  if (orders > 0) {
    await db.order.findFirstOrThrow({ include: { payment: true, statusHistory: true, items: true } });
  }

  console.log(
    `OK: carta ${String(es.categories.length)} categorías / ${String(products)} platos; ` +
      `${String(users)} usuarios, ${String(orders)} pedidos, ${String(payments)} pagos, ${String(audit)} auditorías`,
  );
} catch (error) {
  console.error(`FAIL: ${error instanceof Error ? error.message : 'error'}`);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
