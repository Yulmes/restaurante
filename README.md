# Marea Baja

Aplicación web full-stack de **Marea Baja**, una cevichería nikkei **ficticia** de demostración (San José, Costa Rica; dirección ficticia). Proyecto 1 de 4 del portafolio.

**Estado:** hito **M0 · Fundaciones**. Todavía no hay frontend, API funcional ni base de datos con esquema: esos llegan en los hitos siguientes.

- Planificación aprobada: [docs/planificacion/Propuesta Restaurante · Fase 1.md](docs/planificacion/Propuesta%20Restaurante%20·%20Fase%201.md)
- Auditoría de planificación: [docs/planificacion/AUDITORIA_COMPLETA_RESTAURANTE.md](docs/planificacion/AUDITORIA_COMPLETA_RESTAURANTE.md)
- Plan del portafolio: [PORTFOLIO_MASTER_PLAN.md](PORTFOLIO_MASTER_PLAN.md)

## Requisitos

- Node.js 24 (ver `.nvmrc`) y npm 11
- Docker Desktop (o Docker Engine) con Docker Compose

## Estructura actual

```
apps/api/         API (en M0: solo la validación de variables de entorno)
packages/shared/  Constantes y esquemas compartidos (en M0: idiomas es-CR y en)
docker-compose.yml  PostgreSQL 17 y Mailpit para desarrollo local
.github/workflows/  CI base
```

`apps/web` y `apps/edge` se crean en los hitos que los necesitan (ver la propuesta, §4.1 y §12).

## Primeros pasos

```bash
npm ci
```

```bash
cp .env.example .env
```

```bash
npm run services:up
```

- PostgreSQL: `localhost:5432` (usuario, contraseña y base en `.env`)
- Mailpit (correos capturados): http://localhost:8025

```bash
npm run env:check
```

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run check` | Formato, lint, tipos y tests (lo mismo que corre la CI) |
| `npm run format` / `format:check` | Prettier |
| `npm run lint` | ESLint con reglas estrictas de TypeScript |
| `npm run typecheck` | TypeScript en modo estricto en todos los paquetes |
| `npm run test` | Vitest |
| `npm run env:check` | Valida las variables de entorno sin mostrar sus valores |
| `npm run services:up` / `services:down` | Levanta o baja PostgreSQL y Mailpit |

Variables de entorno: [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md).
