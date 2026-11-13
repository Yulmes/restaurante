# Variables de entorno

Este documento crece con cada hito. Solo lista variables que el código usa **hoy**.
Plantilla: [`.env.example`](.env.example). El archivo `.env` real está ignorado por git.

La API valida sus variables al arrancar con Zod (`apps/api/src/config/env.ts`). Si alguna falta o es inválida, no arranca. Los errores nombran la variable y el problema, **nunca su valor**. Para comprobarlas sin arrancar nada: `npm run env:check`.

## API

| Variable | Obligatoria | Valores | Desde | Notas |
|---|---|---|---|---|
| `NODE_ENV` | No (por defecto `development`) | `development`, `test`, `production` | M0 | |
| `DATABASE_URL` | Sí | URL `postgres://` o `postgresql://` | M0 (rol cambiado en M2) | **Desde M2 usa el rol de la aplicación** (local: `marea_app`), no el propietario: lee y escribe datos, pero no cambia el esquema ni edita el AuditLog ([ADR 0003](docs/adr/0003-prisma-y-roles-de-base-de-datos.md)). En `production` debe incluir `sslmode=require` (o `verify-ca` / `verify-full`). Es un secreto: en producción vive en el panel del proveedor, nunca en el repositorio. |

## Prisma: migraciones, semilla y scripts de base de datos

| Variable | Obligatoria | Ejemplo local | Desde | Notas |
|---|---|---|---|---|
| `MIGRATION_DATABASE_URL` | Para migrar, sembrar y crear el usuario de la API | `postgresql://marea:…@localhost:5432/marea_baja` | M2 | Rol **propietario** del esquema. Solo lo usan la CLI de Prisma (`apps/api/prisma.config.ts`), la semilla y `db:app-role`; la API no la lee. Es un secreto en cualquier entorno real. |

`npm run db:app-role` toma el usuario y la contraseña de `DATABASE_URL` para crear el usuario de la API (contraseña de al menos 12 caracteres, distinto del propietario). Las pruebas `npm run test:db` usan las dos URLs con la base `<base>_test`.

## Docker Compose (solo desarrollo local)

| Variable | Obligatoria | Ejemplo | Notas |
|---|---|---|---|
| `POSTGRES_USER` | Sí | `marea` | Propietario del esquema: debe coincidir con `MIGRATION_DATABASE_URL` |
| `POSTGRES_PASSWORD` | Sí | `marea_dev_local` | Solo local; no reutilizar en ningún entorno real |
| `POSTGRES_DB` | Sí | `marea_baja` | |
| `POSTGRES_PORT` | No | `5432` | Puerto publicado en 127.0.0.1 |
| `MAILPIT_SMTP_PORT` | No | `1025` | SMTP de captura |
| `MAILPIT_UI_PORT` | No | `8025` | Interfaz web de Mailpit |
