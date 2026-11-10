# Variables de entorno

Este documento crece con cada hito. Solo lista variables que el código usa **hoy**.
Plantilla: [`.env.example`](.env.example). El archivo `.env` real está ignorado por git.

La API valida sus variables al arrancar con Zod (`apps/api/src/config/env.ts`). Si alguna falta o es inválida, no arranca. Los errores nombran la variable y el problema, **nunca su valor**. Para comprobarlas sin arrancar nada: `npm run env:check`.

## API

| Variable | Obligatoria | Valores | Desde | Notas |
|---|---|---|---|---|
| `NODE_ENV` | No (por defecto `development`) | `development`, `test`, `production` | M0 | |
| `DATABASE_URL` | Sí | URL `postgres://` o `postgresql://` | M0 | En `production` debe incluir `sslmode=require` (o `verify-ca` / `verify-full`). Es un secreto: en producción vive en el panel del proveedor, nunca en el repositorio. |

## Docker Compose (solo desarrollo local)

| Variable | Obligatoria | Ejemplo | Notas |
|---|---|---|---|
| `POSTGRES_USER` | Sí | `marea` | Debe coincidir con `DATABASE_URL` |
| `POSTGRES_PASSWORD` | Sí | `marea_dev_local` | Solo local; no reutilizar en ningún entorno real |
| `POSTGRES_DB` | Sí | `marea_baja` | |
| `POSTGRES_PORT` | No | `5432` | Puerto publicado en 127.0.0.1 |
| `MAILPIT_SMTP_PORT` | No | `1025` | SMTP de captura |
| `MAILPIT_UI_PORT` | No | `8025` | Interfaz web de Mailpit |
