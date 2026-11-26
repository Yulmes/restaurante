# B0 de M10 · Despliegue · Auditoría de preparación y preflight

> **Fecha:** 26/11/2026. **Autorización:** B0 de M10, del propietario (26/11/2026). Es solo auditoría y preparación: no crea cuentas ni recursos, no configura proveedores ni GitHub, no despliega y no cambia código, dependencias ni datos.
>
> **Estado:** completado. Este documento se escribió local y sin commit (el B0 no autorizaba commits); se integra con M10-1. **Seguimiento (M10-1):** ver `VALIDACIONES_M10.md`.
>
> **Seguimiento (M10-0, 26/11/2026):** las decisiones de este B0 quedan en la [ADR 0010](../adr/0010-despliegue-tareas-proxy-y-roles.md). D-M10-1 resuelve R-M10-1 en el diseño; D-M10-2, la IP del cliente; D-M10-3, las migraciones. R-M7-3 y las banderas de la demo siguen esperando al propietario.
>
> **Convenciones:**
> - "Verificado" = comprobado en el repositorio, en GitHub con la sesión del propietario o en la página oficial del proveedor (leída el 26/11/2026).
> - "Hipótesis" = deducción que hay que confirmar en M10.

## 1 · Dictamen

**M10 está LISTO CON CONDICIONES**, y no se puede pasar a producción sin resolver antes cinco puntos:

1. **Base de datos despierta 24/7 (nuevo, R-M10-1).** La API corre la reconciliación de pagos cada 5 s, el barrido cada minuto y el outbox cada 30 s, todos contra la base. Con UptimeRobot manteniendo la API despierta (D9), Neon nunca llegaría a suspenderse. A 0,25 CU serían unas 186 CU-h al mes contra las 100 del plan gratuito: la base se suspendería a mitad de mes. La propuesta (§9.5) supone lo contrario ("mantiene despierta la API pero no la base"). **Requiere una decisión técnica antes de desplegar.**
2. **IP del cliente detrás del proxy (R5, R-SEC-09).** La API usa la IP del socket (`trust proxy` en `false`). Detrás del Worker y de Render, todos los visitantes compartirían la IP del proxy, y los límites por IP (login 30 / 15 min, ráfagas 300 / 5 min) serían globales: unos pocos intentos dejarían sin servicio a todos. El secreto de origen y `X-Client-IP` **son obligatorios antes de abrir la URL pública**.
3. **Verificación del correo en la demo pública (R-M7-3).** Crear pedidos y pagar exige correo verificado (`requireVerifiedEmail`). Sin dominio (D6), Resend solo entrega al correo del propietario, así que **un visitante no puede verificar su cuenta ni pedir**. Es una decisión del propietario.
4. **Cuentas externas (D14)**, creadas por el propietario.
5. **Revisión nativa de 引潮 (V2)**, obligatoria antes de producción.

El repositorio, el CI y el entorno local están sanos y no hay bloqueos de Git ni de GitHub.

## 2 · Git y GitHub (verificado)

| Elemento | Estado |
|---|---|
| `main` / `origin/main` / HEAD | `c856bad` (merge del PR #15), sincronizadas, árbol limpio salvo `.claude/` |
| PR e issues | Ninguno abierto. PR #1 a #15 mergeados con merge commit |
| CI en `main` | 7/7 en `c856bad` (run 45870390949) y en `9ee7b0b` |
| Ramas | `m0`–`m9`, `b0-post-m9`, `integracion/m4-lang-documento` y `m3-lang-documento`, conservadas |
| Worktrees | El principal y `Restaurante-m3-lang`. Sin stashes ni tags |
| Workflow | Solo `ci.yml`: `permissions: contents: read`, acciones fijadas a SHA, concurrencia por ref, 7 jobs |
| Secrets y variables de Actions | **Ninguno** (ni de repositorio ni de *environment*) |
| *Environments* | **Ninguno** (0 por la API) |
| Protección de ramas y rulesets | **Ninguna** (`protected: false`; sin rulesets) |
| Ajustes de merge | Merge commit, squash y rebase permitidos; sin auto-merge; no borra las ramas al mergear |
| Actions | Todas las acciones permitidas; aprobación para colaboradores nuevos; `GITHUB_TOKEN` de solo lectura por defecto |
| Seguridad | Secret Protection y **push protection activos**. Dependency graph, alertas de Dependabot y CodeQL **apagados** |
| Despliegues | Ninguno registrado |

### Propuesta de protección de `main` (para una autorización futura; no se configuró)

Es un ruleset de rama sobre `main`, compatible con el flujo histórico (PR con merge commit, un solo mantenedor):

| Regla | Valor propuesto | Motivo |
|---|---|---|
| Exigir PR antes del merge | Sí, **0 aprobaciones** | Con un solo mantenedor, GitHub no deja aprobar el PR propio; exigir 1 bloquearía todo |
| Checks obligatorios | Los 7 jobs de `ci.yml`, por su nombre visible ("Formato, lint, tipos y tests", "Sistema de diseño y accesibilidad (Playwright)", "Servicios locales (Docker Compose)", "Base de datos (Prisma, restricciones y AuditLog)", "Identidad (API, Mailpit y E2E de la cuenta)", "Catálogo y SEO (build prerenderizado y E2E)", "Pedido, pagos, operación y admin (…)") | Hace obligatorio lo que hoy garantiza el procedimiento |
| Rama al día con `main` | Sí | Un solo mantenedor: casi sin fricción |
| Bloquear force push y borrado | Sí | Coincide con las reglas del proyecto |
| Historia lineal | **No** | El proyecto usa merge commits |
| Métodos de merge | Solo merge commit (ajuste del repositorio) | Igual que M0–M9 |
| Bypass | El propietario, solo para emergencias, documentado | Evita quedar bloqueado si el CI de GitHub falla |

**Además:**
- encender el dependency graph y las alertas de Dependabot (sin PR automáticos);
- crear los *environments* `production`, `backup` y `restore-test` (§10) con sus secretos al llegar a cada subfase.

**Limitación:** si se cambia el nombre de un job, el check obligatorio queda pendiente para siempre. Hay que actualizar el ruleset junto con `ci.yml`.

## 3 · Arquitectura de despliegue (propuesta §5, contrastada con el código)

```
Navegador ──GET /, /carta/…──▶ Cloudflare: assets estáticos (HTML prerenderizado + SPA)
          ──/api/*──────────▶ Worker (agrega X-Origin-Auth + X-Client-IP) ──▶ Render: API Express ──▶ Neon PostgreSQL
                                                                                 ├─▶ Resend (outbox)
                                                                                 └─▶ Turnstile siteverify (solo sobre el umbral)
GitHub Actions: build + prerender + deploy de assets · deploy hook de Render · cron de tareas · pg_dump cifrado → B2 · prueba de restauración
UptimeRobot ──/api/health cada 5 min──▶ Worker
```

| Componente | Estado en el código | Falta para M10 |
|---|---|---|
| Web estática con prerender (57 HTML) | Listo (`ssr: false`, prerender en es-CR y en) | `VITE_SITE_URL`, `CATALOG_API_URL` y `VITE_TURNSTILE_SITE_KEY` en el build; el destino de los assets |
| Worker `/api/*` | **No existe** (`apps/edge` se crea "en el hito que lo necesita") | Todo: proxy, `X-Origin-Auth`, `X-Client-IP` |
| API: secreto de origen e IP | **No implementado.** El logger ya oculta `x-origin-auth` | Middleware que rechace sin secreto (403) y tome `X-Client-IP` solo con secreto válido |
| `/api/health` | Listo: no toca la base, fuera del límite de ráfagas | — |
| `/api/health/ready` (§9.5) | **No existe** | Implementarlo, protegido por el secreto de origen |
| Tareas periódicas | `setInterval` dentro del proceso de la API | Endpoint interno y disparador externo (ver la sección 8) |
| Imágenes | `StaticProvider` (variantes AVIF/WebP en el build) | Cloudinary no se usa: el admin solo edita el texto alternativo (D-M8-2) |
| `DEPLOYMENT.md` y `docs/RECUPERACION_ANTE_INCIDENTES.md` | **No existen** | Escribirlos en M10 |

## 4 · Dependencias (verificado)

| Hallazgo | Evidencia | Exposición real | Prioridad |
|---|---|---|---|
| 44 avisos de `npm audit` (41 moderados, 3 altos) | `npm audit --json` | — | — |
| 3 altos: `effect` 3.20.0 (ReDoS en `Schema.TemplateLiteral`) → `@prisma/config` → `prisma` | `npm ls`; la corrección es Prisma 6.12, una versión mayor hacia atrás | **Solo la CLI de Prisma** (build y migraciones). El runtime de `@prisma/client` importa `@prisma/client/runtime/client`, `@prisma/adapter-pg` y `pg`; **no** `effect` ni `@prisma/config` (verificado en el cliente generado y en el runtime) | Baja; seguimiento |
| Por qué aparecen con `--omit=dev` | `prisma` es *peer* opcional de `@prisma/client` (`devOptional` en el lockfile) | Con `--omit=dev --omit=optional`, la auditoría de producción da **0 avisos** | — |
| 41 moderados: `glob`, `minimatch` (por `mjml`), `eslint`, `typescript-eslint` | `npm audit` | Herramientas de desarrollo y de build (los correos se compilan en el build) | Baja |
| `effect@3.20.0` marcado *invalid* para `@hookform/resolvers@7.0.6` (pide `^4`) | `npm ls` | *Peer* opcional del resolver de Effect, que la web no usa (usa Zod); `npm ci` funciona en CI | Baja |

**Requisitos de build y migración que importan en el despliegue (hipótesis a confirmar en M10):**
- **Cliente de Prisma:** `apps/api/src/generated` está ignorado por git. El despliegue tiene que correr `prisma generate`, que es una `devDependency`. Si el build de Render instala con `NODE_ENV=production` (que omite las de desarrollo), el build falla. Hay que instalar con las de desarrollo en el build o generar el cliente en CI.
- **Migraciones y rol propietario:** `prisma migrate deploy` usa `MIGRATION_DATABASE_URL`, del rol propietario. Si las migraciones corren en el *pre-deploy* de Render, esa URL queda en el entorno de la API y anula la separación de roles de la ADR 0003. **Recomendación:** correr las migraciones desde un job de GitHub Actions con un *environment* protegido, después del backup previo a cada migración (§10), y dejar a Render solo con `DATABASE_URL` (rol de la aplicación).

**Recomendación general:**
- No actualizar dependencias en M10 salvo un aviso que afecte al runtime.
- Revisar Prisma 7.x cuando salga una versión que corrija `effect`.

## 5 · Variables de entorno (verificado contra `apps/api/src/config/env.ts`, `.env.example`, el código de la web y `ENVIRONMENT_VARIABLES.md`)

El documento, la plantilla y el código **coinciden**. En producción, la validación con Zod **exige**:
- `sslmode=require` en `DATABASE_URL`;
- `https://` en `PUBLIC_WEB_URL`;
- `EMAIL_PROVIDER=resend` y `RESEND_API_KEY`;
- `BOT_CHECK_PROVIDER=turnstile` y `TURNSTILE_SECRET_KEY`.

| Variable | Componente | Tipo | Producción | Proveedor | Preparación |
|---|---|---|---|---|---|
| `NODE_ENV` | API | Runtime | `production` | — | Lista |
| `DATABASE_URL` | API | **Secreto**, runtime | Rol de la aplicación, con `sslmode=require` | Neon | Falta la cuenta |
| `MIGRATION_DATABASE_URL` | CLI de Prisma, semilla, `db:app-role` | **Secreto**, migración | Rol propietario; **no** en el entorno de la API (sección 4) | Neon | Falta la cuenta |
| `API_PORT` | API | Runtime | El puerto que asigne Render. **La API lee `API_PORT`, no `PORT`**: hay que fijarla igual al puerto de Render (hipótesis: 10000; confirmar en la documentación de Render en M10) | Render | Falta decidir |
| `LOG_LEVEL` | API | Runtime | `info` (por defecto en producción) | — | Lista |
| `PUBLIC_WEB_URL` | API (CSRF `Origin`, enlaces de correos) | Runtime | `https://<proyecto>.workers.dev` u origen elegido | Cloudflare | Falta el origen |
| `APP_SECRET` | API (CSRF de invitados, hash de IP) | **Secreto** | ≥ 32 caracteres aleatorios, propio de producción | — | Lo genera el propietario en M10 |
| `EMAIL_PROVIDER` / `EMAIL_FROM` / `RESEND_API_KEY` | API | Runtime / **secreto** | `resend` / `onboarding@resend.dev` (sin dominio, D6) / clave | Resend | Falta la cuenta |
| `EMAIL_DELIVERABLE_TO` | API | Runtime | Correo del propietario | — | Falta decidir junto con R-M7-3 |
| `MAILPIT_URL` | API | Solo desarrollo | — | — | No aplica |
| `BOT_CHECK_PROVIDER` / `TURNSTILE_SECRET_KEY` | API | Runtime / **secreto** | `turnstile` / clave | Cloudflare | Falta la cuenta |
| `TURNSTILE_GLOBAL_THRESHOLD` / `TURNSTILE_WINDOW_MINUTES` | API | Runtime | Por defecto 50 / 60 (manda `RestaurantSettings`) | — | Lista |
| `ORDERS_ALLOW_OUTSIDE_HOURS` | API | Demo | **Decisión** (sección 11) | — | Falta decidir |
| `DEMO_PAYMENTS_ENABLED` | API | Demo | **Decisión** (sección 11); por defecto `false` | — | Falta decidir |
| `ORDER_CONFIRMATION_TIMEOUT_MINUTES` | API | Runtime | 20 (por defecto) | — | Lista |
| `VITE_SITE_URL` | Build web (canónicas, sitemap, JSON-LD) | Build | Origen público `https://` | Cloudflare | Falta el origen. Si falta, publica URL locales |
| `VITE_TURNSTILE_SITE_KEY` | Build web | Build, pública | Clave del sitio | Cloudflare | Falta la cuenta |
| `CATALOG_API_URL` | Build web (prerender) | Build | URL de la API desplegada | Render | Falta el despliegue |
| `API_PROXY_TARGET`, `DEV_CERT_DIR`, `PORT` (preview) | Herramientas locales | Desarrollo | — | — | No aplica |
| `POSTGRES_*`, `MAILPIT_*` | Docker Compose | Solo local | — | — | No aplica |

**Variables que M10 tendrá que agregar** (no existen hoy; los nombres se fijan en M10):
- el secreto de origen del Worker y de la API;
- el secreto del endpoint interno de tareas;
- la URL o clave del *deploy hook* de Render;
- las claves de B2 (escritura y lectura separadas);
- la clave pública de `age` y la privada en el *environment* `restore-test`;
- la URL del rol `backup_reader`;
- el token de Cloudflare para desplegar los assets.

## 6 · Seguridad de producción

| Área | Estado verificado | Falta o riesgo |
|---|---|---|
| Proxy e IP | `trust proxy` en `false`; IP del socket | **Bloqueante** (sección 1, punto 2) |
| Acceso directo a `*.onrender.com` | Sin secreto de origen: la API responde a cualquiera | Rechazo con 403 sin `X-Origin-Auth` (§5). El *deploy hook* y `/api/health/ready` también lo necesitan |
| CORS | La API no usa middleware CORS (mismo origen) | Confirmar en la suite post-deploy que no hay `Access-Control-Allow-Origin` (§11) |
| Cookies | `__Host-` en producción, `HttpOnly`, `SameSite=Lax`, `Secure` con `production` | Prueba post-deploy (R-SEC-02) |
| CSRF | `Origin`/`Sec-Fetch-Site` + token sincronizador | Prueba post-deploy (R-SEC-04). `PUBLIC_WEB_URL` tiene que coincidir con el origen real |
| Sesiones, roles y límites | Verificados en M3–M9; M9-07 y M9-08 corregidos | R-M9-1 (cota teórica) abierto y aceptado |
| Turnstile | `TurnstileBotCheck` llama a `siteverify` con `remoteip` y una espera de 10 s; la producción exige `turnstile` | La llamada real nunca se probó (pospuesta a M10); `remoteip` depende del punto 2 |
| Cabeceras | `helmet()` en la API; `x-powered-by` apagado | La CSP de la web va en el hosting o el Worker (R-M9-2) |
| Logs | Pino con redacción (incluye `x-origin-auth`); los errores 5xx no exponen detalles | Confirmar que los logs de Render no muestran secretos al arrancar (el arranque solo registra el puerto, el proveedor de correo, el de Turnstile y la bandera de pagos demo) |
| Secretos en el repositorio | Push protection activo; `.env` ignorado | R-SEC-11 (gitleaks en CI) sigue planificado |
| Docker | Solo para desarrollo; puertos en `127.0.0.1` | No se usa en producción |
| Base de datos | Rol de la aplicación sin DDL ni edición del AuditLog (ADR 0003) | Mantener `MIGRATION_DATABASE_URL` fuera de la API (sección 4); rol `backup_reader` |

### CSP y scripts en línea (R-M9-2), sobre el build local de 57 HTML

- Cada página trae **5 a 9 scripts en línea**:
  - `window.__reactRouterContext` (2 variantes);
  - `streamController…` (**56 variantes**, una por página);
  - `import` del módulo de la ruta (13 variantes);
  - 4 fragmentos fijos: la restauración del scroll, `$RB`/`$RC`/`$RT` de React y un `console.log`;
  - JSON-LD (`application/ld+json`, 52 variantes).
- **JSON-LD no se ejecuta y `script-src` no lo afecta.** Hay además 1 `<style>` en línea por página. No hay scripts externos de terceros, salvo Turnstile en el login.
- **Consecuencia:** una CSP con hashes tiene que ser **por página** y regenerarse en cada build, porque los hashes cambian con el contenido y con cada versión de React Router.
- **Procedimiento propuesto para M10 (sin implementar):**
  1. un paso posterior al build calcula el SHA-256 de cada script ejecutable y del `<style>` de cada HTML;
  2. escribe las cabeceras por ruta, con `_headers` de los assets de Cloudflare si su soporte se confirma, o con el Worker;
  3. agrega `https://challenges.cloudflare.com` a `script-src` y `frame-src` solo en el login;
  4. agrega `frame-ancestors 'none'` y `object-src 'none'`;
  5. empieza en `Content-Security-Policy-Report-Only` y pasa a imponerla cuando una E2E de humo no registre violaciones.
- **Riesgo de mantenimiento:** sin ese paso automático, cualquier cambio de contenido rompe la página. La CSP nunca se escribe a mano.

## 7 · Prerender y rebuild (R-M8-3, D10, C6, R13, R20)

**Estado:**
- **Build:** `react-router build` prerenderiza 57 HTML (las rutas dinámicas salen de la API del catálogo) y `seo-files.ts` escribe el sitemap, robots y `catalog-version.json`.
- **Versión del catálogo:** la API expone `GET /api/public/catalog-version` desde memoria, sin tocar la base (R20).
- **Datos vivos:** precios y disponibilidad se piden en vivo al hidratar (D10). Lo que queda viejo en el HTML es lo que leen los buscadores y lo que se ve antes de hidratar (R-M8-3, R13).

**Estrategia aprobada (D10, C6), sin implementar:**
- un workflow de GitHub Actions cada 30 min compara `catalog-version` con la versión publicada y **solo reconstruye si cambió**, además de poder lanzarse a mano;
- la frecuencia se cambia editando el `schedule`.

**Lo que falta en M10:**
- el workflow;
- el destino de los assets y un despliegue atómico (si el build falla, queda la versión anterior; el build ya falla en lugar de publicar una carta vacía);
- la verificación posterior: comparar `catalog-version.json` publicado con la API y un humo de la portada y de la carta.

**Riesgos verificados en la documentación oficial de GitHub** (la sección del `schedule` se leyó en un resumen de la página; volver a confirmarla en M10):
- el intervalo mínimo es de 5 min;
- puede retrasarse en horas de carga;
- **en un repositorio público, los workflows programados se desactivan después de 60 días sin actividad.** Ese límite afecta al rebuild, al backup semanal y al cron de tareas, y necesita monitoreo (sección 10).
- Además, cada consulta a `catalog-version` despierta Render si estaba dormido, aunque con D9 no duerme.

## 8 · Cron y tareas periódicas (R-M7-1, R-M6-3) y consumo de Neon (R-M10-1, nuevo)

**Estado actual** (`apps/api/src/server.ts`): todo corre con `setInterval` dentro de la API y no hace nada mientras está dormida.

| Tarea | Cada | Toca la base |
|---|---|---|
| Reconciliación de pagos (operaciones `REQUESTED` vencidas, 20 por vuelta) | 5 s | Sí |
| Barrido de pedidos: sin pagar a los 30 min, sin confirmar a los `ORDER_CONFIRMATION_TIMEOUT_MINUTES` | 1 min | Sí |
| Outbox de correos | 30 s | Sí |
| Purga de ventanas de límites de más de 24 h | Periódica | Sí |

**Lo que se verificó:**
- **Neon Free:** 100 CU-h por proyecto al mes (≈ 400 h a 0,25 CU). Suspende a los 5 min sin actividad y **no se puede desactivar en Free**. Al agotar las CU-h, suspende el cómputo hasta el mes siguiente y las conexiones fallan (SQLSTATE 53000). No borra datos.
- **Render Free:** 750 h por workspace al mes. Se duerme a los 15 min sin tráfico, despierta en ≈ 1 min y **no tiene cron jobs en Free** (cuestan desde $1 al mes por servicio).
- **Cloudflare Workers Free:** permite 5 Cron Triggers por cuenta, con 10 ms de CPU cada uno.

**Conclusión (R-M10-1):**
- **Por qué no alcanza:** con D9 (monitor 24/7) la API no duerme, y los temporizadores consultan la base cada 5 s, así que Neon no se suspende nunca: ≈ 744 h × 0,25 CU ≈ 186 CU-h contra 100.
- **A quién afecta:** el plan gratuito no alcanza un mes completo con el diseño actual. Es un problema del entorno desplegado, no del código local.
- **Alternativas, a decidir en M10 con autorización:**
  - **A (recomendada, coherente con §5 y R-M7-1):**
    - en producción, apagar los temporizadores del proceso y exponer un endpoint interno (protegido por el secreto de origen y uno propio) que corra la reconciliación, el barrido, el outbox y la purga;
    - dispararlo desde fuera cada 10–15 min. GitHub Actions no garantiza la hora; un Cron Trigger del Worker sí está en Free.
    - Con un disparo cada 15 min, la base despierta ≈ 1/3 del tiempo (≈ 60 CU-h), más el tráfico real.
    - **Costo:** los pedidos vencidos se cancelan hasta 15 min tarde y los correos salen hasta 15 min tarde, salvo que el envío se dispare al encolar.
    - Hay que diseñarlo junto con R-M6-3 (reintentos sin tope).
  - **B:** subir los intervalos de los temporizadores (por ejemplo, más de 5 min). Es más simple, pero igual impide que Neon se suspenda si el intervalo es menor que 5 min.
  - **C:** plan pago de Neon. Está fuera del escenario $0 (§9.3) y requiere aprobación.
  - **D:** renunciar al monitor 24/7 (cambia D9).
- **Criterios de aceptación propuestos:**
  - con la API ociosa, la base se suspende (verificable en la consola de Neon);
  - ninguna tarea se pierde si un disparo falla (es idempotente y se pone al día en el siguiente);
  - las ejecuciones simultáneas no se pisan;
  - el endpoint interno responde 403 sin sus secretos;
  - los logs solo muestran conteos.

## 9 · Backups y recuperación (D7, §10)

**Estado:**
- **No hay backups ni restauración implementados.**
- `docs/RECUPERACION_ANTE_INCIDENTES.md` **no existe** (planificado para M10).
- La base local es de desarrollo.

**Diseño aprobado (§10):**
- **Flujo:** `pg_dump -Fc` semanal con el rol `backup_reader` → `pg_restore --list` → cifrado `age` con la clave pública → SHA-256 en un manifiesto → bucket privado de B2 (clave de solo escritura).
- **Prueba de restauración:** un job de restauración en un PostgreSQL efímero, después de cada backup, en el *environment* `restore-test`, con su propia clave de lectura de B2 y la clave privada.
- **Copias adicionales:** un backup antes de cada migración, una copia mensual local y el historial de 6 h de Neon.
- **Objetivos:** RPO de hasta 7 días (≈ 0 si se detecta dentro de las 6 h); RTO de 1 h.

**Lo verificado y lo que falta confirmar:**
- **B2:** 10 GB gratis y egreso gratis hasta 3 veces lo almacenado. La página no dice si exige tarjeta (V6).
- **Neon Free:** 6 h de historial (1 GB de cambios) y 1 snapshot manual. Las dos páginas oficiales **se contradicen** sobre si la restauración instantánea está disponible en Free. Hay que verificarlo en la consola antes de contar con ella en el RTO.
- **Riesgo:** si la base queda suspendida por CU-h (R-M10-1), `pg_dump` también falla (SQLSTATE 53000). El backup depende de que se resuelva la sección 8.

**Criterios para M10:**
1. Un backup semanal programado y otro manual, con manifiesto.
2. La primera restauración completa en verde: conteos y claves foráneas (FK) verificados, y `prisma migrate status` sin pendientes. **Es el criterio de cierre de M10.**
3. Un aviso si el backup o la restauración fallan.
4. El runbook escrito.
5. La retención fijada según el espacio (C2).

## 10 · Monitoreo (D9, §9.5)

**Lo que hay:** `/api/health` (200 `{"status":"ok"}`, sin base y sin información interna) y los logs de Pino en la salida estándar (los toma Render).

**Lo que falta:**
- la cuenta de UptimeRobot y el monitor;
- `/api/health/ready`;
- `DEPLOYMENT.md`;
- los avisos de los workflows programados.

**UptimeRobot Free (verificado):** 50 monitores cada 5 min, apto para uso comercial. La página no deja confirmar los canales incluidos (V8).

**Propuesta:**
- **Monitores:**
  - `/api/health` por el Worker (disponibilidad de la API y del proxy);
  - la portada `/` con una palabra clave (assets);
  - opcionalmente, `/api/public/catalog-version` (no toca la base).
- **Avisos:**
  - caída y recuperación por correo al propietario;
  - el fallo de un workflow programado (backup, restauración, rebuild o tareas), con el aviso de GitHub;
  - **alarma mensual manual** sobre el consumo de CU-h de Neon y de horas de Render (R3).

**Umbrales propuestos:** 2 fallos seguidos para avisar; tiempo de respuesta > 10 s como degradado (el despertar en frío de Render tarda ≈ 1 min).

**Lo que no se puede monitorear gratis:** latencias internas y métricas de la base en tiempo real (Neon guarda 1 día de monitoreo en Free).

## 11 · Demo pública

| Elemento | Estado | Decisión |
|---|---|---|
| Pagos demo (`DEMO_PAYMENTS_ENABLED`) | Por defecto `false`: solo se ofrece pagar al recibir o al retirar | **Pendiente.** Recomendación: `true` en la demo, porque el selector de escenarios es el centro del portafolio (M6). No mueve dinero ni pide datos de tarjeta |
| Pedidos fuera de horario (`ORDERS_ALLOW_OUTSIDE_HOURS`) | Por defecto `false` | **Pendiente.** Recomendación: `true`, para que un visitante pueda probar a cualquier hora; el banner de demo ya lo explica (M5) |
| Verificación del correo (R-M7-3) | Pedir exige correo verificado; sin dominio, el visitante no recibe el enlace | **Pendiente y bloqueante para la demo** (alternativas abajo) |
| Correos | En producción, `resend`; `EMAIL_DELIVERABLE_TO` limita el envío real al propietario y el resto queda `DEMO_ONLY` en la bandeja demo | Fijar `EMAIL_DELIVERABLE_TO` |
| Abuso | Límites por IP, cuenta y cuenta+IP; Turnstile sobre el umbral; los datos son ficticios | Depende de la IP real (sección 1, punto 2) |
| Datos | Semilla bilingüe; la demo no pide datos reales | Decidir si producción arranca con la semilla y con qué cuenta admin |

**Alternativas para R-M7-3 (la decisión es del propietario):**
1. **Mostrar el enlace de verificación en la bandeja demo** de ese mismo visitante, solo para los correos `DEMO_ONLY`. Es fácil y coherente con la demo, pero no prueba que el correo sea suyo (aceptable con datos ficticios). Revierte D-M7-4 solo en la demo.
2. **Verificar automáticamente en el modo demo**, con una bandera de servidor. Es lo más simple, pero se pierde la demostración del flujo de verificación.
3. **Cuentas demo ya verificadas**, con credenciales publicadas. Tienen un riesgo de abuso y de ver los datos que dejen otros visitantes.
4. **Mantener la restricción:** solo el propietario puede pedir en la demo pública. El escenario de compra no se puede mostrar a terceros.

**Recomendación técnica:** la 1, con un aviso visible de que es una demo.

## 12 · Pendientes externos y humanos

**Cuentas (D14), en este orden y por estos motivos:**
1. **Neon:** la base. Sin ella no hay API, y la necesitan el build del prerender y los backups.
2. **Render:** la API.
3. **Cloudflare:** los assets, el Worker y Turnstile. Necesita la URL de Render y la clave de Turnstile para el build.
4. **Resend:** sin dominio, solo entrega al correo de la cuenta; Free: 3.000 al mes y 100 al día.
5. **Backblaze B2:** los backups.
6. **UptimeRobot:** el monitoreo, cuando la URL pública ya responda.
7. **Cloudinary:** **no hace falta para la demo actual** (D-M8-2: el admin no sube fotos). Implementar `CloudinaryProvider` (R-IMG-01) sería trabajo nuevo, fuera del mínimo para desplegar. Se propone posponerlo con decisión del propietario.

**Antes de crear cada cuenta:** leer sus términos y si exige tarjeta (V6, R15). La revisión de los términos de Render y Neon sigue pendiente.

**Revisión de 引潮 (V2, D1):**
- **Qué se revisa:** el sello `apps/web/app/components/brand/hanko-glyphs.ts` (contornos de Shippori Mincho B1), con el procedimiento y las preguntas de `docs/m1/REVISION_HANKO.md`.
- **Estado:** la revisión documental con fuentes está hecha (10/11/2026); **la de un hablante nativo sigue pendiente** y es obligatoria antes de producción.
- **Evidencia que se espera:** una confirmación escrita registrada en `CREDITS.md` o en la ADR de identidad (§3).
- **Qué impide cerrarla:** que no existe esa confirmación.

**NVDA (18 pasos) y Safari de iOS real (9 escenarios):** no bloquean el despliegue. Quedan aceptados como pendientes de M9.
- Safari de iOS real es más fácil de hacer **contra la URL pública**, después del despliegue, y conviene hacerlo antes de cerrar M10.
- NVDA se puede hacer en local en cualquier momento.

## 13 · Registro de riesgos (estado comprobado)

| Riesgo | Qué es | Estado | Destino / prioridad |
|---|---|---|---|
| **R-M10-1 (nuevo)** | Los temporizadores mantienen despierta a Neon y agotan las CU-h (sección 8) | **Abierto, bloqueante para producción, requiere decisión** | M10, prioridad alta |
| R5 / R-SEC-09 | Proxy y secreto de origen; IP del cliente | Abierto, **bloqueante** | M10, alta |
| R-M7-3 | Verificación del correo en la demo pública | Abierto, **requiere decisión**, bloqueante para el escenario de compra | M10, alta |
| V2 | Revisión nativa de 引潮 | Pendiente humana, obligatoria antes de producción | Propietario |
| V6 / R15 | Tarjeta y términos de cada proveedor | Pendiente del propietario | Antes de cada cuenta |
| R3 / C8 | 750 h de Render contra un monitor 24/7 (≈ 744 h; margen ≈ 6 h; la API tiene que ser el único servicio gratuito del workspace) | Abierto, aceptado en la planificación | M10, seguimiento mensual |
| R-M7-1 | Tareas solo con la API despierta | Abierto; se resuelve con la sección 8 | M10, alta |
| R-M9-2 | CSP con hashes por página | Abierto, requiere implementación en M10 | M10, media |
| R-M8-3 / R13 / R20 | Prerender viejo para buscadores; rebuild cada 30 min | Abierto; requiere el workflow de M10 | M10, media |
| Criterios aplazados de M4 | LCP móvil en producción, validadores externos de JSON-LD y `hreflang`, workflow de rebuild, URL locales sin `VITE_SITE_URL` | Pendientes | M10 (después del despliegue) |
| V8 | Canales de notificación de UptimeRobot Free | No confirmado en la página oficial | M10, al crear la cuenta |
| V9 | Que la restauración semanal entre en los minutos y en el límite de un job de Actions | Pendiente; el repositorio público tiene minutos gratis | M10 (primera restauración) |
| V10 | Qué hace Cloudinary al pasar los créditos | Pendiente; **no aplica si Cloudinary se pospone** | Decisión del propietario |
| (nuevo) Workflows programados desactivados después de 60 días sin actividad (repositorio público) | Afecta al rebuild, al backup y a las tareas | Abierto | M10: monitorear o dejar actividad mínima |
| (nuevo) `main` sin protección | Ver la sección 2 | Abierto, requiere autorización | Antes de los workflows de despliegue |
| (nuevo) `MIGRATION_DATABASE_URL` en el entorno de Render | Anularía la ADR 0003 | Abierto, requiere decisión | M10 |
| R-M9-1 | Cota teórica de la aproximación deslizante | Mitigado en parte, aceptado | Alternativa 3, solo con autorización |
| R-M5-1 | `npm audit`: los 3 altos solo en la CLI de Prisma; producción sin opcionales = 0 | Abierto, aceptado, no bloqueante | Seguimiento |
| R-M5-2 | WebKit heredado de M1–M4 | Mitigado en parte, aceptado | Adaptar las pruebas o mantenerlo |
| R-M8-4 | Revisión externa del diseño | Mitigado; falta la revisión externa | Propietario |
| R-M6-3 | Reconciliación sin tope ni espera creciente | Abierto; conviene resolverlo con la sección 8 | M10 (junto con la sección 8) |
| R-M7-2 / R-M8-1 | Límite de staff y admin de §8.4 | Abiertos; cambiarlos requiere aprobación | Sin cambios |
| R-M7-4 | Transiciones en el mismo milisegundo | Abierto, no bloqueante | Sin hito |
| R-M8-2 | Pedido en el mismo instante que un cambio de moneda | Abierto, no bloqueante | Sin hito |
| NVDA / Safari de iOS real | Validaciones humanas de M9 | Pendientes, no bloqueantes | Propietario |

Ninguno se cerró ni se reinterpretó.

## 14 · Plan de M10 propuesto (orden y criterios; no cambia la definición de §12)

**Definición (§12):**
- cuentas del propietario (D14);
- Worker y proxy, Render, Neon;
- backups semanales en B2 con prueba de restauración (D7);
- UptimeRobot 24/7 (D9);
- revisión nativa de 引潮 (D1);
- pruebas post-deploy;
- sin dominio ni correo de producción (D6).

**Criterio de cierre:** URL pública + suite post-deploy en verde + primera restauración exitosa.

| Subfase | Contenido | Depende de | Criterio |
|---|---|---|---|
| **M10-0 · Decisiones** | R-M10-1 (alternativa A, B, C o D), R-M7-3, banderas de la demo, Cloudinary sí o no, migraciones fuera de Render, protección de `main` | Propietario | Decisiones registradas en una ADR 0010 |
| **M10-1 · Código previo al despliegue** (local, con PR y CI) | Secreto de origen y `X-Client-IP`, `/api/health/ready`, endpoint interno de tareas y temporizadores apagables, el resultado de R-M7-3, el paso de CSP por página (en modo *Report-Only*), `apps/edge` (Worker) | M10-0 | E2E y pruebas de integración nuevas en verde; CI 7/7 |
| **M10-2 · Cuentas** | Neon → Render → Cloudflare → Resend → B2 → UptimeRobot | Propietario (D14, V6) | Cuentas creadas por el propietario; sin secretos en el chat |
| **M10-3 · Infraestructura y secretos** | Proyecto de Neon y roles (`marea_app`, `backup_reader`), servicio de Render, Worker y assets, *environments* y secretos de GitHub | M10-1, M10-2 | `env:check` en producción en verde |
| **M10-4 · Primer despliegue** | Backup previo, migraciones desde Actions, semilla, deploy de la API, build y deploy de los assets | M10-3 | `/api/health` y `/api/health/ready` en verde por el Worker |
| **M10-5 · Workflows** | Rebuild (D10), tareas, backup semanal y prueba de restauración | M10-4 | Primera restauración en verde |
| **M10-6 · Monitoreo y documentación** | UptimeRobot, `DEPLOYMENT.md`, `docs/RECUPERACION_ANTE_INCIDENTES.md` | M10-4 | Aviso de caída probado |
| **M10-7 · Validación** | Suite post-deploy (§11), criterios de M4 (LCP, JSON-LD, `hreflang`), CSP impuesta, 引潮 (V2), Safari de iOS real recomendado | Todo | Criterio de cierre de M10 |

**Qué no hacer todavía:** crear cuentas o recursos, configurar DNS, GitHub o secretos, desplegar, cambiar dependencias, implementar la CSP, el cron o el Worker, ni tomar las decisiones de M10-0.

## 15 · Validaciones de este B0

Todas de solo lectura:
- **Git:** `git fetch --prune`, estado, ramas, worktrees, stashes y tags.
- **GitHub con la sesión del propietario:** secretos, variables, *environments*, rulesets, protección de ramas, ajustes de Actions, de merge y de seguridad.
- **API pública de GitHub:** PR, issues, runs y despliegues.
- **Dependencias:** `npm audit` (completo, `--omit=dev` y `--omit=dev --omit=optional`) y `npm ls`.
- **Código:** imports del cliente de Prisma generado y del runtime; inventario de variables en el código.
- **Build local de 57 HTML:** análisis de los scripts en línea.
- **Lectura del código de seguridad:** `app.ts`, `server.ts`, la sesión, las cookies y Turnstile.
- **Páginas oficiales de los proveedores** (26/11/2026): Neon, Render, Cloudflare Workers, Resend, Backblaze B2, UptimeRobot y GitHub Actions.

No se corrieron pruebas ni se tocó la base.
