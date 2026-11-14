/**
 * Cambia los roles de un usuario existente (RBAC, M3). Lo ejecuta el propietario; la pantalla
 * de clientes del admin llega en M8.
 *
 *   npm run users:set-role -w @marea-baja/api -- --email ana@ejemplo.cr --role ADMIN --reason "Primer admin"
 *
 * `--role` se puede repetir (por ejemplo, CUSTOMER y STAFF). Usa `DATABASE_URL` (rol de la
 * aplicación) y deja una entrada en el AuditLog en la misma transacción. No imprime datos
 * personales más allá del correo enmascarado.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { roleKeySchema } from '@marea-baja/shared';
import { maskEmail } from '../src/config/logger.ts';
import { createPrismaClient } from '../src/db/client.ts';
import { UserNotFoundError, setUserRoles } from '../src/modules/users/roles.ts';

const rootEnvFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile);

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    role: { type: 'string', multiple: true },
    reason: { type: 'string' },
  },
});

const roles = (values.role ?? []).map((role) => roleKeySchema.safeParse(role.toUpperCase()));
if (!values.email || roles.length === 0 || roles.some((r) => !r.success)) {
  console.error('Uso: --email <correo> --role <CUSTOMER|STAFF|ADMIN> [--role …] [--reason "<motivo>"]');
  process.exit(1);
}
const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  console.error('Falta DATABASE_URL (copiá .env.example a .env).');
  process.exit(1);
}

const db = createPrismaClient(databaseUrl);
try {
  const result = await setUserRoles(db, {
    email: values.email,
    roles: roles.flatMap((r) => (r.success ? [r.data] : [])),
    actor: null,
    reason: values.reason ?? 'Script del propietario (users:set-role)',
  });
  console.log(
    result.changed
      ? `Roles de ${maskEmail(values.email)}: ${result.before.join(', ')} → ${result.after.join(', ')}. Sus sesiones rotan en la próxima petición.`
      : `Sin cambios: ${maskEmail(values.email)} ya tenía ${result.after.join(', ')}.`,
  );
} catch (error) {
  if (error instanceof UserNotFoundError) {
    console.error(error.message);
    process.exitCode = 1;
  } else {
    throw error;
  }
} finally {
  await db.$disconnect();
}
