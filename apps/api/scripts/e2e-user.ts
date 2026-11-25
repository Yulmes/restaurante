/**
 * Solo para las E2E: crea una cuenta de cliente ya verificada en la base `<base>_e2e`.
 *
 *   node scripts/e2e-user.ts --email a@example.com --password "…" --locale en [--unverified] [--role STAFF|ADMIN]
 *
 * Las E2E registran cuentas por la interfaz, pero el límite real de 5 registros por hora por IP
 * (§8.4) impide crear más desde el mismo navegador de pruebas. Este script no cambia ese límite:
 * crea las cuentas que necesitan las pruebas de idioma directamente en la base E2E.
 * Se niega a correr contra cualquier base que no termine en `_e2e`.
 */
import { parseArgs } from 'node:util';
import { localeSchema } from '@marea-baja/shared';
import { createPrismaClient } from '../src/db/client.ts';
import { hashPassword } from '../src/modules/auth/passwords.ts';

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    password: { type: 'string' },
    locale: { type: 'string' },
    // M5: cuenta sin verificar, para probar que el checkout exige el correo verificado (D3).
    unverified: { type: 'boolean', default: false },
    // M7: rol extra (STAFF o ADMIN) para las pruebas del Pase.
    role: { type: 'string' },
  },
});
const url = process.env['DATABASE_URL'] ?? '';
if (!/\/[a-z0-9_]+_e2e(\?|$)/.test(url)) {
  console.error('e2e-user solo corre contra una base <base>_e2e.');
  process.exit(1);
}
const locale = localeSchema.parse(values.locale);
if (!values.email?.endsWith('@example.com') || !values.password) {
  console.error('Uso: --email <…@example.com> --password <…> --locale <es-CR|en>');
  process.exit(1);
}

const extraRole = values.role;
if (extraRole !== undefined && extraRole !== 'STAFF' && extraRole !== 'ADMIN') {
  console.error('--role debe ser STAFF o ADMIN.');
  process.exit(1);
}

const db = createPrismaClient(url);
try {
  const customer = await db.role.findUniqueOrThrow({ where: { key: 'CUSTOMER' } });
  const extra = extraRole ? await db.role.findUniqueOrThrow({ where: { key: extraRole } }) : null;
  await db.user.create({
    data: {
      email: values.email.toLowerCase(),
      name: 'Cuenta E2E',
      passwordHash: await hashPassword(values.password),
      locale: locale === 'es-CR' ? 'es_CR' : 'en',
      emailVerifiedAt: values.unverified ? null : new Date(),
      roles: { create: [{ roleId: customer.id }, ...(extra ? [{ roleId: extra.id }] : [])] },
    },
  });
} finally {
  await db.$disconnect();
}
