# ADR 0003 · Prisma 7 y roles separados en PostgreSQL

- **Estado:** aceptado (decisión técnica dentro del alcance aprobado de M2).
- **Hito:** M2 · Datos
- **Relacionado:** propuesta §4.4 (Prisma), §6 (modelo), §8.6 (AuditLog), R-AUD-01.

## Contexto

La propuesta fija Prisma como ORM y pide que el AuditLog sea de solo inserción con dos defensas: el rol de la aplicación solo tiene `INSERT` y `SELECT` sobre la tabla, y un trigger rechaza `UPDATE` y `DELETE` aunque alguien tenga permisos (§8.6). Para que los permisos signifiquen algo, la API no puede conectarse con el rol que creó las tablas: el propietario de una tabla siempre puede cambiar sus permisos.

## Decisiones

### 1. Prisma 7.10.1 (estable), no la 8

- El 13/11/2026 la etiqueta `latest` de npm apunta a `8.0.0-rc.33`, una versión candidata. Se usa **7.10.1**, la última estable (publicada el 15/10/2026), con versión exacta como el resto del repositorio.
- Configuración propia de Prisma 7:
  - `apps/api/prisma.config.ts` con la URL de la CLI;
  - generador `prisma-client` con salida en `apps/api/src/generated/prisma`;
  - adaptador `@prisma/adapter-pg` sobre `pg`.
- El cliente generado **no se versiona** (`.gitignore`). Se genera con `npm run typegen`, que ya corre antes de `lint` y `typecheck` (como los tipos de React Router en M1).
- El cliente generado es TypeScript que Node 24 ejecuta sin compilación previa: la semilla y los scripts corren con `node archivo.ts`, igual que `env:check` en M0.

### 2. Dos roles de base de datos

| Rol | Quién lo usa | Permisos |
|---|---|---|
| Propietario del esquema (local: `marea`) | CLI de Prisma (migraciones), semilla, scripts de mantenimiento | Dueño de las tablas |
| `marea_app_rw` (grupo, sin login) | — | `SELECT`, `INSERT`, `UPDATE`, `DELETE` en las tablas de datos; **solo `SELECT` e `INSERT` en `AuditLog`**; nada sobre `_prisma_migrations`; sin `CREATE` en el esquema |
| Usuario de la API (local: `marea_app`) | La API, con `DATABASE_URL` | Miembro de `marea_app_rw`; sin superusuario, `CREATEROLE` ni `CREATEDB` |

- Variables: `DATABASE_URL` (API, rol de la aplicación) y `MIGRATION_DATABASE_URL` (CLI y scripts, propietario).
- La migración crea el grupo `marea_app_rw` y le da los permisos, incluidos los **privilegios por defecto** para las tablas de migraciones futuras.
- El usuario con login y su contraseña **no** viven en las migraciones, porque serían un secreto versionado. En local y en CI los crea `npm run db:app-role`, que toma usuario y contraseña de `DATABASE_URL`. En producción los crea el propietario en M10, con la guía de `DEPLOYMENT.md`.

### 3. Lo que Prisma no expresa va en SQL de migración

Los CHECK, el índice funcional `lower(email)`, el trigger del AuditLog y los grants están en `20261113194400_restricciones_auditoria_y_permisos`. Prisma no los representa en `schema.prisma`, pero:

- `npm run db:drift` (también en CI) comprueba que la base migrada y el esquema no tienen diferencias. Se probó que falla si el esquema cambia sin migración.
- Cada restricción tiene un test contra PostgreSQL real (`apps/api/test/*.db.test.ts`).

### 4. Identificadores UUID generados por la base

Todas las claves primarias son `uuid` con `gen_random_uuid()` como valor por defecto en la base. Así cualquier inserción, por Prisma o por SQL, recibe un id válido. PostgreSQL 17 lo trae incorporado.

## Consecuencias

- La API nunca podrá alterar el esquema ni el historial de auditoría, aunque tenga un error o sea comprometida.
- Hay que crear dos credenciales por entorno. En M10 se documentan en `DEPLOYMENT.md` junto a la cuenta de Neon (D14).
- Las purgas de retención del AuditLog (§8.6, punto 5) requieren el rol propietario y desactivar el trigger dentro de un script de mantenimiento. Ese script no existe todavía; se escribe cuando haya una política de retención (M8–M10).
- Para pasar a Prisma 8 cuando sea estable hace falta una revisión aparte: no se actualiza automáticamente.
