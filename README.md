# Marea Baja

Aplicación web full-stack de **Marea Baja**, una cevichería nikkei **ficticia** de demostración (San José, Costa Rica; dirección ficticia). Proyecto 1 de 4 del portafolio.

**Estado:** hito **M1 · Sistema de diseño**. Ya existen el sistema visual, los componentes base y la infraestructura de idiomas (es-CR y en), visibles en la página interna `/_design`. Todavía no hay carta real, API funcional ni base de datos con esquema: llegan en los hitos siguientes.

- Planificación aprobada: [docs/planificacion/Propuesta Restaurante · Fase 1.md](docs/planificacion/Propuesta%20Restaurante%20·%20Fase%201.md)
- Auditoría de planificación: [docs/planificacion/AUDITORIA_COMPLETA_RESTAURANTE.md](docs/planificacion/AUDITORIA_COMPLETA_RESTAURANTE.md)
- Plan del portafolio: [PORTFOLIO_MASTER_PLAN.md](PORTFOLIO_MASTER_PLAN.md)

## Requisitos

- Node.js 24 (ver `.nvmrc`) y npm 11
- Docker Desktop (o Docker Engine) con Docker Compose

## Estructura actual

```
apps/web/         React 19 + React Router 7 (modo framework) + Vite + Tailwind 4: sistema de diseño e i18n
apps/api/         API (por ahora solo la validación de variables de entorno)
packages/shared/  Idiomas (es-CR, en) y formato de dinero (CRC/USD)
tools/eslint/     Regla local que prohíbe textos de interfaz literales (D2)
docker-compose.yml  PostgreSQL 17 y Mailpit para desarrollo local
.github/workflows/  CI: calidad, sistema de diseño y accesibilidad, servicios
```

`apps/edge` se crea en el hito que lo necesita (ver la propuesta, §4.1 y §12).

## Web en desarrollo

```bash
npm run dev -w @marea-baja/web
```

- Sistema de diseño (interno, no indexado): http://127.0.0.1:5173/_design · inglés: http://127.0.0.1:5173/en/_design
- Pruebas de navegador: ver [TESTING.md](TESTING.md). Internacionalización: [docs/I18N.md](docs/I18N.md).

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
