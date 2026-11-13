# Marea Baja

Aplicación web full-stack de **Marea Baja**, una cevichería nikkei **ficticia** de demostración (San José, Costa Rica; dirección ficticia). Proyecto 1 de 4 del portafolio.

**Estado:** hito **M3 · Identidad**. Ya existen:

- el sistema visual y la infraestructura de idiomas (M1, página interna `/_design`);
- la base de datos con su carta semilla bilingüe (M2, [DATABASE.md](DATABASE.md));
- la API de identidad y las pantallas de la cuenta (M3, [SECURITY.md](SECURITY.md)): registro, verificación por correo, inicio de sesión, recuperación, perfil, sesiones, CSRF, límites, Turnstile condicional y RBAC.

La carta pública, el carrito y los pedidos llegan en los hitos siguientes.

- Planificación aprobada: [docs/planificacion/Propuesta Restaurante · Fase 1.md](docs/planificacion/Propuesta%20Restaurante%20·%20Fase%201.md)
- Auditoría de planificación: [docs/planificacion/AUDITORIA_COMPLETA_RESTAURANTE.md](docs/planificacion/AUDITORIA_COMPLETA_RESTAURANTE.md)
- Plan del portafolio: [PORTFOLIO_MASTER_PLAN.md](PORTFOLIO_MASTER_PLAN.md)

## Requisitos

- Node.js 24 (ver `.nvmrc`) y npm 11
- Docker Desktop (o Docker Engine) con Docker Compose

## Estructura actual

```
apps/web/         React 19 + React Router 7 (modo framework) + Vite + Tailwind 4: sistema de diseño e i18n
apps/api/         API Express 5: identidad (M3) sobre el esquema Prisma, las migraciones y la semilla (M2)
packages/shared/  Idiomas (es-CR, en), formato de dinero (CRC/USD) y contratos Zod de la API
tools/eslint/     Regla local que prohíbe textos de interfaz literales (D2)
docker-compose.yml  PostgreSQL 17 y Mailpit para desarrollo local
.github/workflows/  CI: calidad, sistema de diseño y accesibilidad, base de datos, identidad, servicios
```

`apps/edge` se crea en el hito que lo necesita (ver la propuesta, §4.1 y §12).

## Web y API en desarrollo

Con PostgreSQL y Mailpit levantados y la base preparada (ver "Primeros pasos"), en dos terminales:

```bash
npm run dev -w @marea-baja/api
```

```bash
npm run dev -w @marea-baja/web
```

- Cuenta: http://127.0.0.1:5173/cuenta/registro · inglés: http://127.0.0.1:5173/en/account/register. Los correos llegan a Mailpit: http://127.0.0.1:8025
- Sistema de diseño (interno, no indexado): http://127.0.0.1:5173/_design · inglés: http://127.0.0.1:5173/en/_design
- Para dar el rol de staff o admin a una cuenta existente: `npm run users:set-role -w @marea-baja/api -- --email <correo> --role ADMIN --reason "<motivo>"` (queda en el AuditLog)
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

```bash
npm run db:setup
```

`db:setup` aplica las migraciones, crea el usuario de la API y carga la carta semilla. Detalles: [DATABASE.md](DATABASE.md).

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run check` | Formato, lint, tipos y tests (lo mismo que corre la CI) |
| `npm run format` / `format:check` | Prettier |
| `npm run lint` | ESLint con reglas estrictas de TypeScript |
| `npm run typecheck` | TypeScript en modo estricto en todos los paquetes |
| `npm run test` | Vitest (pruebas unitarias) |
| `npm run test:db` | Pruebas contra PostgreSQL: restricciones, AuditLog, permisos, semilla e integración de la API de identidad |
| `npm run test:e2e:auth -w @marea-baja/web` | E2E de identidad con API, base `<base>_e2e` y Mailpit |
| `npm run db:setup` | Migraciones, usuario de la API y semilla |
| `npm run env:check` | Valida las variables de entorno sin mostrar sus valores |
| `npm run services:up` / `services:down` | Levanta o baja PostgreSQL y Mailpit |

Variables de entorno: [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md).
