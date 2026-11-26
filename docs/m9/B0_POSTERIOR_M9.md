# B0 posterior a M9 · Auditoría de transición

> **Fecha:** 26/11/2026. **Autorización:** B0 posterior a M9, del propietario (26/11/2026). Auditoría de transición sin implementación: no cambia código funcional, pruebas, dependencias, configuración ni decisiones. **No inicia M10.**
>
> **Estado:** completado. Las correcciones documentales de este B0 se integraron en `main` por un PR documental desde la rama `b0-post-m9`, con la autorización de integración del propietario (26/11/2026). Esa autorización tampoco inicia M10 ni cambia la configuración de GitHub.

## 1 · Git y GitHub (verificado)

| Elemento | Estado |
|---|---|
| Rama y HEAD del worktree principal | `main` en `9ee7b0b` (merge del PR #14) |
| `main` frente a `origin/main` | Iguales (0 adelante, 0 atrás) después de `git fetch --prune` |
| Integración de M9 | PR #13 mergeado (`adb772f`) y PR #14 mergeado (`9ee7b0b`), los dos con merge commit |
| CI en `main` | 7/7 sobre `adb772f` (run 45843124734) y sobre `9ee7b0b` (run 45848375744), primer intento |
| PR e issues abiertos | Ninguno. PR #1 a #14, todos mergeados |
| Ramas | `m0-fundaciones` a `m9-calidad`, `integracion/m4-lang-documento` y `m3-lang-documento`, conservadas. Las remotas `m0`–`m9` existen |
| Worktrees | El principal y `Restaurante-m3-lang` (`m3-lang-documento`, `d367503`, limpio), conservado |
| Stashes y tags | Ninguno |
| Árbol de trabajo | Limpio al empezar, salvo `.claude/` (sin seguimiento, a propósito) |

**Observaciones (sin acción):**
- `m5-pedido` está 1 commit adelante de `origin/m5-pedido` (`b378d08`). Su contenido ya está en `main` como `dc66b53`: tienen el mismo `patch-id`. Es una copia local sin efecto; no se empuja ni se borra.
- `integracion/m4-lang-documento` y `m3-lang-documento` ya están contenidas en `main`.
- **`main` no tiene reglas de protección ni rulesets** (Settings → Branches, con la sesión del propietario). El CI corre en cada PR, pero GitHub no lo exige antes del merge: hasta ahora lo garantizó el procedimiento. Configurarlo es una decisión del propietario, no de este B0; se propone para el B0 de M10.

## 2 · Entorno local (verificado, sin cambios)

| Elemento | Estado |
|---|---|
| Docker | `marea-baja-postgres-1` (postgres:17.11-alpine) y `marea-baja-mailpit-1` (mailpit v1.32.0), *healthy*. Hay dos contenedores `hello-world` detenidos de hace dos semanas, ajenos al proyecto: no se tocan |
| PostgreSQL | 17.11; 3 bases `marea_baja*` (desarrollo, pruebas y E2E) |
| Mailpit | API en `:8025` responde 200 |
| Herramientas | Node 24.15.0 (`.nvmrc` 24), npm 11.12.1, Playwright 1.64.1, Prisma 7.10.1 |
| `env:check` / `db:drift` | Válidas / sin diferencias |
| `package-lock.json` | Sin cambios |
| Procesos de desarrollo | Ningún servidor de la API ni de la web escuchando; solo PostgreSQL y Mailpit |
| `.env`, `.claude/`, archivos ignorados, builds y reportes | Presentes y sin tocar |

**`npm audit` (R-M5-1):** 44 avisos (41 moderados, 3 altos), igual que en M9. Con `--omit=dev` aparecen los 3 altos (`effect` → `@prisma/config` → `prisma`): el CLI de Prisma está en `devDependencies`, pero entra al árbol de producción como *peer* de `@prisma/client`. No cambia la evaluación de M9 (ReDoS sobre la configuración local del CLI, sin entradas de usuarios), pero **importa para M10**: la instalación de producción y las migraciones del despliegue lo incluyen. Se propone revisarlo en el B0 de M10, sin actualizar dependencias ahora.

## 3 · Auditoría documental

**Fuente de verdad:** `PORTFOLIO_MASTER_PLAN.md` para el estado vivo de los hitos; la propuesta (`docs/planificacion/Propuesta Restaurante · Fase 1.md`) para el alcance y las decisiones aprobadas; `docs/planificacion/AUDITORIA_COMPLETA_RESTAURANTE.md` para el estado de los requisitos; `docs/mN/` para la evidencia de cada hito; `SECURITY.md`, `TESTING.md`, `DATABASE.md` y `ENVIRONMENT_VARIABLES.md` para lo técnico vigente; `CHANGELOG.md` para la historia.

**Verificado sin discrepancias:**
- M0–M9 figuran integrados y cerrados en el plan maestro, la propuesta, la auditoría completa y el changelog, con sus PR, merges y CI.
- R-A11Y-01 y R-RESP-01 están "Parcial" por NVDA y Safari de iOS real; `PRUEBAS_HUMANAS_M9.md` los mantiene pendientes. Nada los marca como hechos.
- Los riesgos de la sección 4 están en `docs/m9/AUDITORIA_M9.md` y en el plan maestro, con el estado con que se cerró M9.
- Las correcciones de M9 (M9-01 a M9-08 y M9-14) están en el informe, el changelog y `SECURITY.md`.
- Las decisiones D1–D14 y las de M8 (D-M8-1 a D-M8-10) no cambiaron.

**Discrepancias encontradas y corregidas** (solo documentación):

| Documento | Discrepancia | Corrección |
|---|---|---|
| `README.md` | Decía "Estado: hito M4" y que el carrito y los pedidos "llegan en los hitos siguientes"; la estructura describía la API como solo de identidad y el CI con 5 jobs | Estado M0–M9 con un renglón por hito (M5–M9) y enlace al plan maestro; estructura de la API y los 7 jobs del CI |
| `TESTING.md` | "Qué cubre M9 (implementación local)", aunque M9 está integrado | "Qué cubre M9" |
| `SECURITY.md` | "Revisión completa de seguridad: M9" seguía en "Pendiente en otros hitos" | Hecha en M9, con lo que dejó abierto (R-M9-1 y R-M9-2) |
| `PORTFOLIO_MASTER_PLAN.md` | "WebKit móvil: pendiente desde M1, sin hito asignado", aunque M9 lo revisó (R-M5-2). El próximo paso seguía siendo este B0 | WebKit con su estado real; registro de este B0 y próximo paso: M10 con autorización expresa |
| Propuesta, §15.4 | Las capturas a 768 y 1024 px figuraban pendientes "en M9" y WebKit "sin hito asignado" | Capturas hechas en M9; WebKit con su estado real. Los criterios de M10 siguen pendientes |
| `AUDITORIA_COMPLETA_RESTAURANTE.md` | R-CI-01 y R-DESIGN-01 seguían en "Planificado" con la evidencia ya integrada | R-CI-01 implementado (7 jobs en verde en M0–M9); R-DESIGN-01 implementado con el *finish gate* de M9 y la revisión externa pendiente (R-M8-4) |

No se modificaron los documentos históricos de cada hito (`docs/m1/` a `docs/m8/`): registran el estado de su momento.

## 4 · Riesgos y pendientes (estado comprobado)

| Riesgo | Estado | Destino |
|---|---|---|
| R-M9-1 | **Mitigado en parte.** M9-07 y M9-08 corregidos; la cota teórica de ~2 × N de la aproximación deslizante sigue abierta y aceptada | Ventana exacta (alternativa 3) solo con autorización aparte |
| R-M9-2 | **Abierto.** CSP con hashes para los 9 scripts en línea del prerender | M10 |
| R-M5-1 | **Abierto, aceptado.** 44 avisos; los 3 altos llegan al árbol de producción por el CLI de Prisma (ver la sección 2) | Revisión en el B0 de M10; sin actualizar dependencias |
| R-M5-2 | **Mitigado en parte; lo que queda, aceptado.** Supuestos de las pruebas de M1–M4 y comportamiento de la plataforma | Adaptar esas pruebas o mantenerlo aceptado |
| NVDA (18 pasos) | **Pendiente de validación humana** | Propietario (`PRUEBAS_HUMANAS_M9.md`) |
| Safari de iOS real (9 escenarios) | **Pendiente de validación humana** | Propietario (`PRUEBAS_HUMANAS_M9.md`) |
| R-M8-4 | **Mitigado.** Falta la revisión externa de una persona | Propietario |
| R-M6-3 | **Abierto.** Reconciliación sin tope de reintentos | Sin hito asignado |
| R-M7-1 | **Abierto.** Barridos y reconciliación solo con la API despierta | M10 (endpoint interno y cron) |
| R-M7-2 | **Abierto.** Límite de staff y admin de §8.4 (alcance ampliado por D-M8-5) | Cambiarlo requiere aprobación |
| R-M7-3 | **Abierto.** Verificación del correo de visitantes en la demo pública | Decisión de M10 |
| R-M7-4 | **Abierto.** Dos transiciones en el mismo milisegundo | Sin hito asignado |
| R-M8-1 | **Abierto.** El límite de §8.4 también rige la edición de la carta | Política de §8.4 |
| R-M8-2 | **Abierto.** Pedido creado en el mismo instante que un cambio de moneda | Sin hito asignado |
| R-M8-3 | **Abierto.** Precios del HTML prerenderizado hasta el rebuild | M10 (rebuild, D10) |

Ninguno se cerró, eliminó ni reinterpretó en este B0.

## 5 · Preparación de M10 · Despliegue (sin iniciarlo)

**Definición vigente (propuesta, §12):** el propietario crea las cuentas con una guía paso a paso (D14): Cloudflare, Render, Neon, Resend, Cloudinary, Backblaze B2 y UptimeRobot. El despliegue incluye:
- el Worker y el proxy, la API en Render y la base en Neon;
- backups semanales en B2 con prueba de restauración (D7);
- UptimeRobot 24/7 con alertas (D9);
- la revisión nativa de 引潮 (D1);
- las pruebas post-deploy.

No hay dominio ni correo de producción (D6). **Criterio de cierre:** URL pública, suite post-deploy en verde y una primera restauración exitosa. Es coherente con el estado real: M0–M9 integrados y nada desplegado.

**Dependencias que ya están:** la app completa de M0–M9 en `main` y el CI 7/7. Además, `ENVIRONMENT_VARIABLES.md` documenta las variables de producción (`VITE_SITE_URL`, `CATALOG_API_URL`, `DEMO_PAYMENTS_ENABLED` y otras).

**Lo que depende del propietario y bloquea el inicio de las tareas remotas:**
- crear las cuentas (D14) y revisar antes sus términos y requisitos de tarjeta (V6, R15);
- la revisión de 引潮 por un hablante nativo (V2, obligatoria antes de producción; `docs/m1/REVISION_HANKO.md`);
- la decisión pendiente sobre la verificación del correo en la demo pública (R-M7-3).

**Arrastra a M10:**
- R-M9-2: CSP con hashes;
- R-M7-1: cron y endpoint interno;
- R-M8-3: rebuild del prerender;
- los criterios de M4 aplazados: LCP móvil en producción, validadores externos de JSON-LD y `hreflang`, workflow de rebuild y el riesgo de publicar URLs locales si falta `VITE_SITE_URL`;
- la llamada real a `siteverify` de Turnstile (pospuesta a M10 el 13/11/2026);
- el secreto de origen entre el Worker y la API (R-SEC-09);
- las pruebas post-deploy (R-SEC-02, R-SEC-04);
- `docs/RECUPERACION_ANTE_INCIDENTES.md`;
- las verificaciones V6, V8, V9 y V10;
- la cuota de 750 h/mes de Render (R3, C8).

**Qué debería auditar el B0 específico de M10:**
1. El estado de las cuentas que haya creado el propietario y sus límites gratuitos reales (V6, V8, V9, V10, R3).
2. Las reglas de protección de `main` y el uso de *environments* y secretos de GitHub (no hay reglas configuradas hoy).
3. El árbol de producción de dependencias (`npm audit --omit=dev`, R-M5-1) y cómo se corren las migraciones en Render.
4. El inventario de scripts en línea del prerender para la CSP (R-M9-2) y la CSP del widget de Turnstile.
5. La lista de variables de producción contra `ENVIRONMENT_VARIABLES.md` y `env:check`.
6. Que `DEMO_PAYMENTS_ENABLED` y las demás banderas de demostración tengan el valor decidido para la demo pública.

**Qué no hacer todavía:** crear cuentas o recursos externos, configurar DNS o secretos, desplegar, cambiar dependencias o el stack, implementar la CSP o el cron, ni decidir R-M7-3. Todo eso es M10 y necesita autorización expresa.

## 6 · Validaciones de este B0

Solo lectura, sin regresión (no hubo cambios funcionales):
- `git fetch --prune`, comparación de `main` con `origin/main`, ramas, worktrees, stashes y tags;
- GitHub: PR, issues, runs de CI en `main` y la configuración de ramas, con la sesión del propietario;
- `docker ps`, la versión de PostgreSQL, la API de Mailpit, `env:check` y `db:drift`;
- `npm audit`;
- `prettier --check` de los documentos modificados.
