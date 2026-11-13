# Variables de entorno

Este documento crece con cada hito. Solo lista variables que el código usa **hoy**.
Plantilla: [`.env.example`](.env.example). El archivo `.env` real está ignorado por git.

La API valida sus variables al arrancar con Zod (`apps/api/src/config/env.ts`). Si alguna falta o es inválida, no arranca. Los errores nombran la variable y el problema, **nunca su valor**. Para comprobarlas sin arrancar nada: `npm run env:check`.

## API

| Variable | Obligatoria | Valores | Desde | Notas |
|---|---|---|---|---|
| `NODE_ENV` | No (por defecto `development`) | `development`, `test`, `production` | M0 | |
| `DATABASE_URL` | Sí | URL `postgres://` o `postgresql://` | M0 (rol cambiado en M2) | **Desde M2 usa el rol de la aplicación** (local: `marea_app`), no el propietario: lee y escribe datos, pero no cambia el esquema ni edita el AuditLog ([ADR 0003](docs/adr/0003-prisma-y-roles-de-base-de-datos.md)). En `production` debe incluir `sslmode=require` (o `verify-ca` / `verify-full`). Es un secreto: en producción vive en el panel del proveedor, nunca en el repositorio. |

## API: servidor HTTP e identidad (M3)

| Variable | Obligatoria | Valores / ejemplo | Notas |
|---|---|---|---|
| `API_PORT` | No (por defecto `3000`) | `3000` | Puerto de la API. En desarrollo, Vite reenvía `/api` a este puerto |
| `LOG_LEVEL` | No | `fatal` … `trace`, `silent` | Por defecto `info` en producción y `debug` en desarrollo |
| `PUBLIC_WEB_URL` | Sí | `http://127.0.0.1:5173` | Origen exacto de la web. Se exige en `Origin` (CSRF, §8.3) y se usa en los enlaces de los correos. En producción debe ser `https://` |
| `APP_SECRET` | Sí | Al menos 32 caracteres | Clave de los tokens CSRF de invitados y del hash de las IP en los límites. **Secreto**: en producción, uno aleatorio y largo, distinto en cada entorno |
| `EMAIL_PROVIDER` | No (por defecto `mailpit`) | `mailpit`, `resend`, `memory` | `memory` solo para pruebas. En producción debe ser `resend` (D6) |
| `EMAIL_FROM` | Sí | `Marea Baja <no-reply@marea-baja.test>` | Remitente. Sin dominio propio (D6), Resend solo acepta su remitente de pruebas (`onboarding@resend.dev`) |
| `MAILPIT_URL` | No (por defecto `http://127.0.0.1:8025`) | URL | API HTTP de Mailpit para enviar en desarrollo (ADR 0004) |
| `RESEND_API_KEY` | Con `EMAIL_PROVIDER=resend` | `re_…` | **Secreto.** La crea el propietario con su cuenta de Resend (D14) |
| `BOT_CHECK_PROVIDER` | No (por defecto `fake`) | `turnstile`, `fake` | `fake` acepta solo el token ficticio de las claves de prueba de Cloudflare. En producción debe ser `turnstile` (D8) |
| `TURNSTILE_SECRET_KEY` | Con `BOT_CHECK_PROVIDER=turnstile` | — | **Secreto.** Clave secreta del widget de Turnstile (D14) |
| `TURNSTILE_GLOBAL_THRESHOLD` | No (por defecto `50`) | Entero positivo | Valor por defecto del umbral global de fallos de login. Manda `RestaurantSettings` (semilla: 50) |
| `TURNSTILE_WINDOW_MINUTES` | No (por defecto `60`) | Entero positivo | Ventana del umbral. Manda `RestaurantSettings` (semilla: 60) |

### Web

| Variable | Obligatoria | Notas |
|---|---|---|
| `VITE_TURNSTILE_SITE_KEY` | En producción | Clave pública del widget de Turnstile. En desarrollo, si falta, se usa la clave de prueba de Cloudflare que siempre pasa |
| `API_PROXY_TARGET` | No | Solo desarrollo: a qué API reenvía Vite `/api` (por defecto `http://127.0.0.1:3000`). Las E2E de identidad la apuntan a su propia API |

## Prisma: migraciones, semilla y scripts de base de datos

| Variable | Obligatoria | Ejemplo local | Desde | Notas |
|---|---|---|---|---|
| `MIGRATION_DATABASE_URL` | Para migrar, sembrar y crear el usuario de la API | `postgresql://marea:…@localhost:5432/marea_baja` | M2 | Rol **propietario** del esquema. Solo lo usan la CLI de Prisma (`apps/api/prisma.config.ts`), la semilla y `db:app-role`; la API no la lee. Es un secreto en cualquier entorno real. |

`npm run db:app-role` toma el usuario y la contraseña de `DATABASE_URL` para crear el usuario de la API (contraseña de al menos 12 caracteres, distinto del propietario). Las pruebas `npm run test:db` usan las dos URLs con la base `<base>_test`, y las E2E de identidad, con `<base>_e2e`.

## Docker Compose (solo desarrollo local)

| Variable | Obligatoria | Ejemplo | Notas |
|---|---|---|---|
| `POSTGRES_USER` | Sí | `marea` | Propietario del esquema: debe coincidir con `MIGRATION_DATABASE_URL` |
| `POSTGRES_PASSWORD` | Sí | `marea_dev_local` | Solo local; no reutilizar en ningún entorno real |
| `POSTGRES_DB` | Sí | `marea_baja` | |
| `POSTGRES_PORT` | No | `5432` | Puerto publicado en 127.0.0.1 |
| `MAILPIT_SMTP_PORT` | No | `1025` | SMTP de captura |
| `MAILPIT_UI_PORT` | No | `8025` | Interfaz web de Mailpit |
