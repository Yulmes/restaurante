# Validaciones de M10 · Despliegue

> **Estado (26/11/2026):** **M10-1 en integración por el [PR #16](https://github.com/Yulmes/restaurante/pull/16)** (`m10-despliegue` → `main`), con CI 7/7 y sin merge (ver "Integración por PR").
> - Decisiones en la [ADR 0010](../adr/0010-despliegue-tareas-proxy-y-roles.md), aprobadas por el propietario el 26/11/2026 (D-M10-P1 a P11).
> - **No hay cuentas, recursos, secretos reales ni URL pública.** M10 no está cerrado: faltan M10-2 a M10-7.

## Alcance de M10-1

| Tarea | Estado | Evidencia |
|---|---|---|
| 01 · Tareas y Neon (D-M10-1) | ✅ Local | `modules/tasks/`, `despliegue.db.test.ts`, `background.test.ts` |
| 02 · Proxy, IP y secreto de origen (D-M10-2) | ✅ Local · ⏳ prueba real de `CF-Connecting-IP` | `middleware/origin.ts`, `apps/edge`, pruebas de los dos lados |
| 03 · Roles de base de datos (D-M10-3) | ✅ Diseño y workflow · ⏳ roles reales | `migrate.yml`, SQL en DEPLOYMENT.md, restauración con `marea_app_rw` |
| 04 · Render (D-M10-4) | ✅ Configuración · ⏳ servicio | `render.yaml`; arranque en modo producción en el puerto 10000 |
| 05 · CSP (D-M10-5) | ✅ Local · ⏳ URL pública | `scripts/csp.ts`, E2E de 57 páginas, `csp:check` |
| 06 · Salud (D-M10-6) | ✅ | `/api/health/ready` |
| 07 · CI (D-M10-7) | ✅ Local · ⏳ ejecución en GitHub | `ci.yml` |
| 08 · Backups (D-M10-8) | ✅ Local · ⏳ B2 | `ops/backup/backup.sh`, `backup.yml` |
| 09 · Prueba de restauración | ✅ Local · ⏳ **primera restauración real** (cierre de M10) | `restore-test.sh`, `selftest.sh`, `restore-smoke.ts` |
| 10 · Monitoreo (D-M10-9) | ✅ Documentado · ⏳ monitores | `OPERACION.md` |
| 11 · Turnstile (D-M10-10) | ✅ Pruebas con simulación · ⏳ claves reales | `bot-check.test.ts`; procedimiento en POST_DEPLOY 3 |
| 12 · Verificación demo (P1) | ✅ | API, bandeja (es-CR y en), pruebas |
| 13 · Banderas de la demo (P2, P3) | ✅ Configuración | `render.yaml` |
| 14 · Ruleset y GitHub (P5, P6) | ✅ Procedimiento · ⏳ aplicar | DEPLOYMENT.md, sección 6 (después del merge de M10-1) |
| 15 · Prerender y rebuild (D10) | ✅ Workflow · ⏳ cuentas | `deploy-web.yml`, `CATALOG_ORIGIN_SECRET` |
| 16 · Configuración externa | ✅ Guías · ⏳ cuentas | `DEPLOYMENT.md`, `render.yaml`, `wrangler.jsonc` |
| 17 · Documentación | ✅ | Ver "Documentación" |

## Validaciones (26/11/2026, árbol final de la rama)

| Validación | Resultado |
|---|---|
| `npm run check` (formato, lint, tipos, unitarias) | ✅ 887/887 (27 archivos) |
| `npm run test:db` | ✅ 302/302 (antes 278: +24 de `despliegue.db.test.ts`) |
| `db:drift` / `env:check` | ✅ Sin diferencias / OK |
| E2E de identidad / catálogo | ✅ 14 · 19 |
| E2E de producción (idioma del documento + **CSP**) | ✅ 12 (9 + 3 nuevas): 57 páginas del sitemap, 12 rutas de la SPA y flujos, **0 violaciones** |
| E2E de pedido / pagos | ✅ 12 · 6 |
| E2E de operación / admin (Chromium + Mobile Safari) | ✅ 5 + 5 · 4 + 4 |
| Auditoría de calidad (`test:calidad`) | ✅ 1 + 1 |
| E2E de M1 | ✅ 41 + 1 omitida |
| `npm run backup:selftest` | ✅ Backup cifrado (43 tablas, 267 filas en la base local), volcado ilegible sin la clave, volcado alterado rechazado, restauración con conteos iguales, `prisma migrate status` al día y humo de la API |
| `npm run csp:check` | ✅ 57 HTML con su `<meta>` al día |
| Arranque en modo producción, local, con valores falsos | ✅ Escucha en 10000; `/api/health` 200; `/api/auth/csrf` sin secreto 403 y con secreto 200; `/ready` con la base sin TLS → 503 `{"status":"unavailable"}`; tareas sin su secreto 403; ningún secreto en el log |
| Búsqueda de secretos en el diff | ✅ Ninguno |
| Dependencias | ✅ Sin dependencias nuevas; `package-lock.json` solo suma el workspace `apps/edge` |

## Comportamiento verificado y casos borde

- **Tareas:**
  - una vuelta a la vez (la segunda, 409 o `TasksBusyError`);
  - el temporizador y el endpoint juntos no duplican la cancelación de un pedido;
  - una tarea que falla no corta las demás;
  - la segunda vuelta puede tener trabajo legítimo (un pago autorizado después de vencer el pedido se cancela, R-M6-2) y la tercera no cambia nada.
- **IP:**
  - `X-Forwarded-For` y la cabecera de pruebas se ignoran con el secreto configurado;
  - los límites por IP usan `X-Client-IP`, tanto IPv4 como IPv6;
  - una lista, un puerto o un nombre en `X-Client-IP` → 400.
- **Verificación demo:**
  - solo con el **último** correo de verificación `DEMO_ONLY`;
  - un reenvío real la anula;
  - otra cuenta no puede verificarla;
  - 5 por hora por cuenta;
  - AuditLog `user.email_verified_demo`;
  - cookie de sesión nueva;
  - después se puede pedir.
- **CSP, dos hallazgos corregidos en esta fase** (detalle en la ADR 0010, "Hallazgos de la implementación"):
  - **Zod 4:** su prueba de `new Function` se reportaba como violación. Se corrigió con un script clásico con hash que fija `jitless` antes de cargar los módulos.
  - **Fuentes `data:`** de los subconjuntos tipográficos.

## Lo que no se puede validar en local

Está en [POST_DEPLOY.md](POST_DEPLOY.md):
- la falsificación de `CF-Connecting-IP` en la entrada del Worker;
- Turnstile con las claves reales;
- B2 y la primera restauración real;
- el Cron Trigger real y la suspensión de Neon;
- las cookies `__Host-` en HTTPS;
- la CSP en la URL pública;
- LCP en producción y los validadores externos de M4.

## Riesgos

| Riesgo | Estado después de M10-1 |
|---|---|
| R-M10-1 (Neon despierta 24/7) | **Mitigado en el diseño y el código** (D-M10-1). Se cierra con la medición del primer mes |
| R5 / R-SEC-09 (IP y acceso directo) | **Implementado.** Falta la prueba contra la URL pública |
| R-M7-3 (verificación en la demo) | **Resuelto en el código** (P1). Falta confirmarlo en la URL pública |
| R-M7-1 (tareas solo con la API despierta) | **Resuelto en el código** (endpoint + Cron Trigger) |
| R-M9-2 (CSP) | **Resuelto en local.** Falta confirmarlo en la URL pública |
| R-M8-3 / R13 (prerender viejo) | Workflow de rebuild listo, inactivo hasta tener cuentas |
| R-M6-3 (reconciliación sin tope) | **Abierto** (necesitaría una migración). Lo acotan las 5 pasadas por vuelta |
| R3 (750 h de Render) | Abierto, en seguimiento (OPERACION.md) |
| D-M10-P9 (workflows programados) | Aceptado, con revisión mensual |
| **Nuevo:** secretos del repositorio para `deploy-web.yml` | Pendiente de confirmar por el propietario (ADR 0010, hallazgo 4) |
| **Nuevo:** Wrangler con `npx` y versión exacta, fuera del lockfile | Aceptado en la ADR 0010; revisarlo al actualizar |
| R-M9-1, R-M5-1, R-M5-2, R-M8-4, R-M7-2/R-M8-1, R-M7-4, R-M8-2 | Sin cambios |
| NVDA, Safari de iOS real, 引潮 (V2) | Pendientes humanos |

## Documentación

**Nueva:**
- `DEPLOYMENT.md`
- `docs/RECUPERACION_ANTE_INCIDENTES.md`
- `docs/m10/POST_DEPLOY.md`
- `docs/m10/OPERACION.md`
- este documento

**Actualizada:**
- ADR 0010 (aceptada e implementada en local, con trazabilidad y hallazgos)
- `ENVIRONMENT_VARIABLES.md`, `.env.example`
- `SECURITY.md`, `TESTING.md`, `README.md`
- `PORTFOLIO_MASTER_PLAN.md`
- encabezado de `ci.yml`

## Integración por PR (26/11/2026, Nivel 2)

- **PR:** [#16](https://github.com/Yulmes/restaurante/pull/16), `m10-despliegue` → `main`, sobre `c856bad` (`main` sin cambios desde entonces; GitHub lo marca sin conflictos).
- **Commits:**
  - los cuatro de M10-1: `6af37c6` (API), `322e1ef` (Worker y CSP), `36ed1de` (backups, workflows y CI), `d0dc698` (documentación);
  - `c64ec17`: revisión previa al push;
  - `3bab344`: prueba de M6 con el reloj congelado;
  - `593cc58`: permisos de los scripts;
  - y este registro.
  - Sin reescribir historia ni force push.
- **Revisión previa al push** (`c64ec17`), con una prueba para cada corrección que falla con la versión anterior cuando se puede:
  1. **Alta.** El manifiesto del backup contaba las filas después del volcado: con la base en uso, la prueba de restauración fallaba. Ahora el volcado y los conteos usan el mismo snapshot exportado. El self-test escribe durante el backup: con el script anterior falla ("tablas con conteos distintos") y en CI se escribieron 289 filas durante el backup sin diferencias.
  2. **Media.** La restauración de prueba se niega a un servidor que no es local, salvo con `ALLOW_REMOTE_RESTORE=1`. Lo cubre el self-test.
  3. **Media.** Región y sumas de verificación de la CLI de AWS para la API S3 de B2 (`B2_REGION`).
  4. **Baja.** `deploy-web.yml` interpolaba una variable de GitHub en el shell; ahora va por entorno.
  5. **Baja.** "Verificar (demo)" simultánea: antes las dos llamadas daban `[200, 200]` y dejaban dos AuditLog; ahora, actualización condicional, `[200, 409]` y uno solo.
- **Regresión local de la rama corregida:**
  - `check` 887;
  - `test:db` 303;
  - E2E de identidad 14, catálogo 19, producción 12 (CSP), pedido 12, pagos 6, operación 5 + 5, admin 4 + 4, calidad 1 + 1 y M1 41;
  - `backup:selftest`, `csp:check` 57/57, `db:drift` y `env:check`.
  - **Falla intermitente:** apareció una vez en una prueba de M6 (dos intentos de pago con el mismo `createdAt` por el reloj de prueba congelado). Se corrigió en `3bab344` avanzando el reloj antes del reintento, con la misma verificación; corrió tres veces seguidas en verde.
- **Push** normal de `m10-despliegue` (rama nueva en el remoto).
- **CI del PR:**
  - **Sobre `3bab344`** ([run 45901806919](https://github.com/Yulmes/restaurante/actions/runs/45901806919)): 6/7. Falló el job de base de datos en el paso del self-test de backup: "Permission denied". Los scripts se habían versionado desde Windows sin el bit de ejecución; en local no se veía porque el volumen de Windows ignora los permisos. Se corrigió en `593cc58` (bit `100755` y llamadas internas con `bash`).
  - **Sobre `593cc58`** ([run 45903495015](https://github.com/Yulmes/restaurante/actions/runs/45903495015)): **7/7 en el primer intento, sin reintentos**, verificado en los logs de cada job:
    - formato, lint, tipos y tests: 887;
    - base de datos: 303 + self-test de backup (289 escrituras durante el backup, restauración con conteos iguales, migraciones al día, humo de la API);
    - diseño: M1 41 y calidad 1 + 1;
    - identidad: 14;
    - catálogo: 19, producción 12 con CSP y `csp:check` 57/57;
    - pedido, pagos, operación y admin: 12 · 6 · 5 + 5 · 4 + 4.
  - **El job de pedido ya llega con su nombre completo** ("Pedido, pagos, operación y admin (Chromium y WebKit)"): los 7 nombres sirven para el ruleset (D-M10-P5).
- **Comentarios, revisiones y bots del PR:** ninguno.
- **Lo que este CI no ejecuta**, porque no dependen de un PR:
  - **Los cuatro workflows nuevos** (`backup`, `migrate`, `deploy-web`, `tasks`) se disparan solo por horario o a mano desde `main` y exigen `DEPLOY_ENABLED=true`. Su sintaxis se validó con Prettier (YAML); **GitHub los valida recién cuando están en `main`**: hay que revisar la pestaña Actions después del merge.

