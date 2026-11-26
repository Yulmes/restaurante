# Despliegue de Marea Baja

> **Estado (26/11/2026):** **preparado en el código (M10-1), sin desplegar.**
> - No hay cuentas, recursos, secretos ni URL pública todavía.
> - Las cuentas las crea el propietario (D14), en el orden de la sección 1.
> - Cada paso que dice **Propietario** lo hace el propietario en su cuenta. Claude puede guiar, pero no crea cuentas, no acepta términos ni maneja claves.
>
> **Decisiones:** [ADR 0010](docs/adr/0010-despliegue-tareas-proxy-y-roles.md). **Recuperación:** [RECUPERACION_ANTE_INCIDENTES.md](docs/RECUPERACION_ANTE_INCIDENTES.md). **Operación y monitoreo:** [docs/m10/OPERACION.md](docs/m10/OPERACION.md). **Pruebas después del despliegue:** [docs/m10/POST_DEPLOY.md](docs/m10/POST_DEPLOY.md).

## Arquitectura

```
Navegador ──/, /carta…──▶ Cloudflare: assets estáticos (HTML prerenderizado + SPA, CSP por página)
          ──/api/*──────▶ Worker (borra IP y secretos del cliente; agrega X-Client-IP y X-Origin-Auth)
                              └──▶ Render: API Express (un servicio gratuito) ──▶ Neon PostgreSQL
Cron Trigger del Worker (cada 30 min) ──▶ POST /api/internal/tasks (secreto de origen + de tareas)
GitHub Actions: build y deploy de la web y el Worker · migraciones (con aprobación) · backup semanal → B2 · prueba de restauración
UptimeRobot ──/api/health y /──▶ Worker
```

## 1 · Orden de las cuentas (D-M10-P10) — Propietario

Antes de cada cuenta, leé sus términos y si pide tarjeta (V6, R15). **No hay costos previstos (§9.3).**

1. **Neon:** la base. La necesitan la API, el build del prerender y los backups.
2. **Render:** la API. Tiene que ser **el único servicio gratuito del workspace** (R3, C8).
3. **Cloudflare:** el Worker, los assets y Turnstile.
4. **Resend:** sin dominio (D6), solo entrega al correo de la cuenta del propietario.
5. **Backblaze B2:** los backups.
6. **UptimeRobot:** cuando la URL pública ya responda.

Cloudinary queda pospuesto (D-M10-P4).

## 2 · Neon — Propietario (con esta guía)

1. **Proyecto:** región cercana a la de Render (Oregon, `us-west-2`), PostgreSQL 17.
2. **Cómputo:** fijo en **0,25 CU** (mínimo = máximo) (D-M10-1). Confirmar que la suspensión a los 5 min queda activa (en Free no se puede desactivar).
3. **Base:** `marea_baja`. El rol propietario es el que crea Neon; su URL es `MIGRATION_DATABASE_URL` y **solo** va al environment `production-migrations` de GitHub.
4. **Esquema y roles**, en este orden:
   1. **Migraciones:** el workflow **Migraciones de producción** (sección 7) crea las tablas, el grupo `marea_app_rw` y sus permisos (ADR 0003).
   2. **Usuario de la API**, con contraseña propia (≥ 12 caracteres), desde el editor SQL de Neon como propietario:
      ```sql
      CREATE ROLE marea_app LOGIN PASSWORD '<contraseña>' NOSUPERUSER NOCREATEDB NOCREATEROLE;
      GRANT marea_app_rw TO marea_app;
      ```
      Su URL, con `?sslmode=require`, es el `DATABASE_URL` de Render.
   3. **Rol de backups**, solo lectura:
      ```sql
      CREATE ROLE backup_reader LOGIN PASSWORD '<contraseña>' NOSUPERUSER NOCREATEDB NOCREATEROLE;
      GRANT CONNECT ON DATABASE marea_baja TO backup_reader;
      GRANT USAGE ON SCHEMA public TO backup_reader;
      GRANT SELECT ON ALL TABLES IN SCHEMA public TO backup_reader;
      GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO backup_reader;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO backup_reader;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON SEQUENCES TO backup_reader;
      ```
      Su URL, con `?sslmode=require`, es `BACKUP_DATABASE_URL` (environment `backup`).
5. **Consumo:** revisar CU-h y egreso cada semana durante el primer mes ([OPERACION.md](docs/m10/OPERACION.md)).

## 3 · Render — Propietario (con esta guía)

1. **Servicio:** "New → Blueprint" con este repositorio. Toma [`render.yaml`](render.yaml):
   - un servicio web gratuito;
   - `API_PORT=10000` (D-M10-4);
   - build `npm ci --include=dev && npm run typegen -w @marea-baja/api`;
   - arranque `npm run start -w @marea-baja/api`;
   - chequeo de salud `/api/health`;
   - **sin deploy automático**.
2. **Variables secretas** (las pide al crear el servicio; ver [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md)):
   - `DATABASE_URL` (rol `marea_app`);
   - `PUBLIC_WEB_URL` (la URL del Worker);
   - `APP_SECRET`;
   - `EMAIL_FROM` y `EMAIL_DELIVERABLE_TO` (el correo del propietario, D-M10-P8);
   - `RESEND_API_KEY`;
   - `TURNSTILE_SECRET_KEY`;
   - `ORIGIN_SECRETS`;
   - `TASKS_SECRETS`.
3. **Nunca** se carga `MIGRATION_DATABASE_URL` en Render (ADR 0003, D-M10-3).
4. **Deploy hook:** se copia a `RENDER_DEPLOY_HOOK_URL` (environment `production-migrations`). La URL es un secreto.
5. **Secretos generados por el propietario**, por ejemplo con `node -e "console.log(require('crypto').randomBytes(36).toString('base64url'))"`:
   - `APP_SECRET`;
   - un secreto de origen (va en `ORIGIN_SECRETS` de Render y en `ORIGIN_SECRET` del Worker y de GitHub);
   - un secreto de tareas (va en `TASKS_SECRETS` de Render y en `TASKS_SECRET` del Worker y de GitHub).
   Los secretos de origen y de tareas tienen que ser distintos.

## 4 · Cloudflare — Propietario (con esta guía)

1. **Turnstile:** un widget con el dominio `*.workers.dev` del Worker. La clave del sitio va a la variable `TURNSTILE_SITE_KEY` de GitHub; la secreta, a `TURNSTILE_SECRET_KEY` de Render.
2. **Worker** ([`apps/edge`](apps/edge)):
   - lo despliega el workflow **Web y Worker**;
   - antes, el propietario carga sus secretos con `npx wrangler@4.160.1 secret put ORIGIN_SECRET` y `npx wrangler@4.160.1 secret put TASKS_SECRET`, desde `apps/edge`;
   - [`wrangler.jsonc`](apps/edge/wrangler.jsonc) fija:
     - los assets de `apps/web/build/client`;
     - `html_handling: drop-trailing-slash`;
     - `run_worker_first: ["/api/*"]`;
     - el Cron Trigger `*/30 * * * *`.
3. **Token de API:** con permiso para editar Workers, en el secreto `CLOUDFLARE_API_TOKEN` de GitHub, más la variable `CLOUDFLARE_ACCOUNT_ID`.

## 5 · Resend y B2 — Propietario

- **Resend:** la clave va a `RESEND_API_KEY` (Render). Sin dominio, `EMAIL_FROM` es el remitente de pruebas de Resend y solo llega correo real a `EMAIL_DELIVERABLE_TO`; el resto queda `DEMO_ONLY` en la bandeja demo, con "Verificar (demo)" (D-M10-P1).
- **B2:**
  - un bucket **privado**;
  - una regla de ciclo de vida que oculte los archivos a los **56 días** y los borre 1 día después (≈ 8 copias semanales, D-M10-8);
  - dos claves limitadas al bucket:
    - **escritura** (sin borrar ni listar todo): `B2_WRITE_KEY_ID` / `B2_WRITE_KEY`, environment `backup`;
    - **lectura**: `B2_READ_KEY_ID` / `B2_READ_KEY`, environment `restore-test`.
  - El endpoint S3 del bucket va a la variable `B2_S3_ENDPOINT`, y `s3://<bucket>/marea-baja`, a `BACKUP_LOCATION`.
- **Claves de `age`:** `age-keygen -o marea-baja-backup.key` en la máquina del propietario.
  - La pública (`age1…`) va a la variable `AGE_RECIPIENT` (environment `backup`).
  - La privada va al secreto `AGE_IDENTITY` (environment `restore-test`) **y** al gestor de contraseñas del propietario, con una copia fuera de línea. Sin ella no se puede restaurar.

## 6 · GitHub — Propietario (D-M10-P5, D-M10-P6)

### Environments, secretos y variables

| Dónde | Secretos | Variables |
|---|---|---|
| Repositorio | `ORIGIN_SECRET`, `CLOUDFLARE_API_TOKEN` | `DEPLOY_ENABLED` (`true` activa los workflows), `SITE_URL`, `API_ORIGIN`, `TURNSTILE_SITE_KEY`, `CLOUDFLARE_ACCOUNT_ID` |
| `production-migrations` (revisor obligatorio: propietario) | `MIGRATION_DATABASE_URL`, `RENDER_DEPLOY_HOOK_URL`, `ADMIN_EMAIL`, `ORIGIN_SECRET`, `TASKS_SECRET` | — |
| `backup` | `BACKUP_DATABASE_URL`, `B2_WRITE_KEY_ID`, `B2_WRITE_KEY` | `AGE_RECIPIENT`, `BACKUP_LOCATION`, `B2_S3_ENDPOINT` |
| `restore-test` | `AGE_IDENTITY`, `B2_READ_KEY_ID`, `B2_READ_KEY` | `BACKUP_LOCATION`, `B2_S3_ENDPOINT` |

> **Pendiente de confirmar por el propietario:** el workflow **Web y Worker** usa secretos del repositorio (`ORIGIN_SECRET`, `CLOUDFLARE_API_TOKEN`) para poder correr solo cada 30 min (D10). Un environment con revisor lo frenaría en cada ejecución. La alternativa es un environment `production-web` sin revisor, que la ADR 0010 no incluye.

### Protección de `main` (D-M10-P5)

**Aplicarla recién después del merge de M10-1**: el nombre nuevo del check de pedido (D-M10-7) tiene que existir en `main`; si no, el ruleset exigiría un check que nunca llega y bloquearía todo.

1. **Ruta:** Settings → Rules → Rulesets → New branch ruleset.
   - **Nombre:** "Proteger main".
   - **Enforcement:** Active.
   - **Destino:** la rama por defecto.
2. **Bypass list:** Repository admin (el propietario), modo "Always". Es solo para emergencias.
3. **Reglas:**
   - **Restrict deletions:** sí.
   - **Block force pushes:** sí.
   - **Require a pull request before merging:** sí, con *Required approvals* = **0**. Con un solo mantenedor, GitHub no deja aprobar el PR propio. Métodos permitidos: **Merge** solamente.
   - **Require status checks to pass:** sí, con **Require branches to be up to date** activado. Los 7 checks, con los nombres exactos del job:
     - `Formato, lint, tipos y tests`
     - `Sistema de diseño y accesibilidad (Playwright)`
     - `Servicios locales (Docker Compose)`
     - `Base de datos (Prisma, restricciones y AuditLog)`
     - `Identidad (API, Mailpit y E2E de la cuenta)`
     - `Catálogo y SEO (build prerenderizado y E2E)`
     - `Pedido, pagos, operación y admin (Chromium y WebKit)`
4. **Merge en el repositorio:** Settings → General → Pull Requests, dejar solo "Allow merge commits" (squash y rebase sin marcar).
5. **Dependabot:** Settings → Advanced Security. Encender *Dependency graph* y *Dependabot alerts*. **No** encender *Dependabot security updates* ni *version updates* (sin PR automáticos).
6. **Comprobación:** abrir un PR de prueba con un cambio mínimo de documentación. El botón de merge espera los 7 checks; después, cerrarlo sin mergear.

## 7 · Primer despliegue (M10-4)

1. **Cuentas y secretos:** las secciones 1 a 6, con `DEPLOY_ENABLED` todavía sin definir.
2. **Primera migración:** activar `DEPLOY_ENABLED=true` y correr **Migraciones de producción** con `seed` = sí, `grant_admin` = no y `deploy_api` = sí.
   - El backup previo corre primero; sobre una base vacía solo verifica el circuito.
   - Después: migración, semilla y deploy de la API.
3. **Usuarios de la base:** crear `marea_app` y `backup_reader` (sección 2) si no se crearon antes. La API necesita `marea_app` para arrancar.
4. **Comprobación de la API:** `GET https://<servicio>.onrender.com/api/health` → 200. `GET …/api/auth/csrf` **sin** secreto → 403 (nadie salta el Worker).
5. **Web y Worker:** correr el workflow con `force` = sí. Hace el build leyendo la API con el secreto de origen, verifica la CSP de cada HTML y despliega.
6. **Cuenta admin:** el propietario se registra en el sitio público con su correo (llega el enlace real, porque es `EMAIL_DELIVERABLE_TO`). Después corre **Migraciones de producción** con `grant_admin` = sí (el correo sale del secreto `ADMIN_EMAIL`, nunca del log).
7. **Monitoreo:** UptimeRobot ([OPERACION.md](docs/m10/OPERACION.md)).
8. **Validación:** la suite post-deploy ([POST_DEPLOY.md](docs/m10/POST_DEPLOY.md)) y la **primera restauración real** (workflow **Backup** a mano). Es el criterio de cierre de M10.

## 8 · Vuelta atrás

| Problema | Acción |
|---|---|
| Web o Worker | Cloudflare → Workers → *Deployments* → volver a la versión anterior, o correr **Web y Worker** sobre el commit anterior |
| CSP rota en producción (emergencia) | Correr el build con `CSP_META=off` (sin el `<meta>`; `_headers` sigue) y abrir un incidente. Nunca `unsafe-inline` |
| API | Render → *Rollback* al deploy anterior (Free guarda los dos últimos) |
| Migración | Las migraciones son compatibles hacia atrás. Si hace falta volver el esquema, se restaura ([RECUPERACION_ANTE_INCIDENTES.md](docs/RECUPERACION_ANTE_INCIDENTES.md)) |
| Secreto expuesto | Rotarlo con el esquema de dos: agregar el nuevo en Render (`ORIGIN_SECRETS=viejo,nuevo`), actualizar el Worker y GitHub, y después quitar el viejo |
