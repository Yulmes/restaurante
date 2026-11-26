# Validaciones de M10 · Despliegue

> **Estado (26/11/2026):** **M10-1 implementado en local, sin desplegar.**
> - Va en la rama `m10-despliegue` (desde `main` en `c856bad`), con commits locales: sin push, sin PR y sin CI remoto.
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
