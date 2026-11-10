# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).

## [Sin publicar]

### Agregado — M0 · Fundaciones

- Monorepo con npm workspaces: `apps/api` y `packages/shared`.
- TypeScript 6 en modo estricto (`tsconfig.base.json`).
- ESLint 10 con `typescript-eslint` (reglas estrictas con información de tipos), Prettier y Vitest.
- Validación de variables de entorno de la API con Zod (`NODE_ENV`, `DATABASE_URL`) y comando `env:check`.
- Lista de idiomas soportados en `@marea-baja/shared`: `es-CR` (predeterminado) y `en` (decisión D2).
- Docker Compose con PostgreSQL 17.11 y Mailpit 1.32.0, solo en 127.0.0.1.
- Workflow de CI base en GitHub Actions.
- Documentación de planificación (Fase 1, v3), README y variables de entorno.
