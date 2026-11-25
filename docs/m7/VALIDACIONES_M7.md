# Validaciones de M7 · Operación

> **Estado (24/11/2026):** **M7 está integrado en `main` y cerrado:** PR #9, merge commit `991ddba`, CI 7/7 antes y después del merge (ver "Integración y cierre"), con autorización de Nivel 4 del propietario. Sin despliegue. Implementado con la autorización de Nivel 2 (24/11/2026) sobre `main` en `c30de42` e integrado por PR con la de Nivel 3.
>
> **Decisiones de M7.** No hubo decisiones de negocio bloqueantes: todo lo implementado está en la propuesta (§7.1–7.4, §3.6, §2.4, §8.5, §8.6) o se deriva técnicamente de ella. Las derivaciones quedan registradas abajo y en el ADR 0008 para que el propietario las revise.

## Definición oficial y alcance

La propuesta (§12) define M7 como "Estados, Pase, seguimiento, historial de pedidos del cliente (D3), outbox, bandeja demo, correos de estado en ambos idiomas", con el **E2E del escenario 2** (admin) como evidencia de cierre. Además, M6 dejó para M7:

- conectar capturar y anular con el pedido (D-M6-2, R-M6-1);
- el correo "Pedido recibido" (D-M6-3);
- marcar `COLLECTED` al entregar;
- el job que cancela los pedidos vencidos y sin confirmar (R-M6-2).

| Pieza | Fuente | Estado |
|---|---|---|
| Máquina de estados del pedido, permisos por rol, versión optimista, historial, AuditLog y outbox por transición | §7.1 | ✅ Implementada |
| Confirmar → capturar; cancelar antes → anular; cancelar después (solo admin) → reembolso total | §7.1–7.3, D-M6-2 | ✅ Implementado |
| Pase: columnas por estado, antigüedad, avance con un clic, atajos de teclado | §3.6, §2.4 | ✅ Implementado |
| Seguimiento sobre la línea de marea con `aria-live`, sin barra de porcentaje | §3.6, §2.4 | ✅ Implementado |
| Historial de pedidos del cliente | D3 | ✅ Implementado |
| Cancelación del cliente antes de la confirmación | §7.1 | ✅ Implementada |
| Contra entrega `COLLECTED` al entregar | §7.2, §7.4 | ✅ Implementado |
| Vencimiento a los 30 min sin pagar; cancelación y anulación a los 20 min sin confirmar (configurable) | §7.1 | ✅ Implementados (barrido cada minuto) |
| Correos de estado en es-CR y en + "nuevo pedido por confirmar" | §8.5, D2, D-M6-3 | ✅ Implementados |
| `DEMO_ONLY` honesto y bandeja de demostración en el perfil | §8.5, C9 | ✅ Implementados |
| E2E escenario 2 | §11, §12 | ✅ Chromium y `Mobile Safari` |

**Fuera de M7 (no implementado):**

- dashboard, pantalla de reembolsos, auditoría con filtros, clientes y configuración (M8);
- `POST /internal/jobs/run` y el cron de GitHub Actions de §4.3, `EMAIL_DELIVERABLE_TO` en la demo pública (M10);
- limpieza de `IdempotencyKey`, que necesita aprobación según el ADR 0006.

## Decisiones

| Tipo | Decisión | Fundamento |
|---|---|---|
| A · Documentada | Matriz de roles: cliente solo `PENDING_CONFIRMATION → CANCELLED` propio; staff, avance operativo; admin, todo más la cancelación posterior a la confirmación | §7.1 |
| A · Documentada | El pedido pasa a `CONFIRMED` recién con la captura hecha; si falla, el Pase muestra el error para reintentar | §7.2 |
| A · Documentada | `PENDING_PAYMENT` es interno: no aparece en el Pase ni dispara correos | §7.1 |
| A · Documentada | 30 min para pagar, 20 min para confirmar (configurable) | §7.1 |
| B · Derivada (D-M7-1) | Las transiciones que dependen del procesador se aplican al terminar la operación, en su misma transacción, también desde la reconciliación. Con una operación en curso, nada más avanza (409) | §7.3 ("Payment CAPTURED · Order CONFIRMED" en un solo commit), R-M6-1 |
| B · Derivada (D-M7-2) | Contra entrega: el paso a `DELIVERED` marca `COLLECTED` en la misma transacción | §7.4 "el staff lo marca como COLLECTED al entregar" |
| B · Derivada (D-M7-3) | El correo "nuevo pedido por confirmar" va a cada cuenta STAFF o ADMIN no bloqueada, en su idioma | §8.5 (no nombra destinatarios) |
| B · Derivada (D-M7-4) | La bandeja nunca muestra enlaces; los de un solo uso no salen de la base | §8.7 (tokens de un solo uso), SECURITY.md |
| B · Derivada (D-M7-5) | `EMAIL_DELIVERABLE_TO` decide qué destinatarios reciben correo real; el resto, `DEMO_ONLY` sin intentar | §8.5 + C9 (Resend sin dominio solo entrega al propietario) |
| B · Derivada (D-M7-6) | Un pedido autorizado después de vencer su reserva se anula y cancela en el barrido siguiente | §7.1 + R-M6-2 |
| B · Derivada | El staff escribe un motivo obligatorio al cancelar | §8.6 (las cancelaciones se auditan con motivo) |
| B · Derivada | Los cambios de estado comparten el límite de staff/admin de §8.4 (30 / 10 min) | §8.4 |
| D · Fuera de M7 | Endpoint interno de jobs y cron; dashboard; pantalla de reembolsos | §4.3 (M10), §12 (M8) |

**Observación para el propietario (no bloquea):** en la demo pública, sin dominio, los visitantes no reciben correos reales (R4). La bandeja muestra que existió el correo de verificación, pero no su enlace (D-M7-4). Cómo verifica su correo un visitante de la demo pública es una decisión de M10.

## Qué se implementó

### API

- **Contratos y máquina:**
  - `packages/shared/src/operations/schemas.ts`: contratos del Pase, cambio de estado, historial y bandeja.
  - `orderSchema` trae `timeline` y `cancellable`.
  - Nuevos códigos de error: `ORDER_VERSION_CONFLICT` y `ORDER_TRANSITION_NOT_ALLOWED`.
- **`modules/orders/`:**
  - `machine.ts`: transiciones y roles.
  - `transitions.ts`: punto único de transición, correos de estado y del reembolso, `COLLECTED` al entregar.
  - `operations.ts`: Pase, cambio de estado, historial, cancelación del cliente y barridos.
  - `operation-routes.ts`: `GET /api/orders`, `POST /api/orders/:id/cancel`, `GET /api/admin/pass`, `PATCH /api/admin/orders/:id/status`.
- **`modules/payments/service.ts`:**
  - la captura, la anulación y el reembolso de cancelación mueven el pedido;
  - `cancelConfirmed` (reembolso con clave `cancel:<pedido>`);
  - versión esperada;
  - el outbox se despierta tras cada commit.
- **`modules/notifications/`:**
  - plantillas de pedidos (`order-messages.ts`, `order-layout.mjml` → `.html`);
  - `DEMO_ONLY` en el outbox;
  - `DemoInboxProvider`, `DeliverableRecipients`;
  - `inbox.ts` (`GET /api/me/notifications`).
- **Configuración y arranque:**
  - Entorno: `ORDER_CONFIRMATION_TIMEOUT_MINUTES`, `EMAIL_DELIVERABLE_TO` y `EMAIL_PROVIDER=demo`.
  - Barrido cada minuto en `server.ts`.
- **Sin migraciones:** alcanza el esquema de M2 (`OrderStatusHistory`, `EmailOutbox.status DEMO_ONLY`, `Order.version`). Sin dependencias nuevas.

### Web

- **`/admin/pase` y `/en/admin/pass`:** el Pase (solo STAFF/ADMIN; un cliente ve el aviso y la API responde 403).
- **`/cuenta/pedidos` y `/en/account/orders`:** historial.
- **`/cuenta/pedidos/:id` y `/en/account/orders/:id`:** seguimiento (reusa la página del pedido).
- **`/cuenta/bandeja` y `/en/account/inbox`:** bandeja de demostración.
- **Página de confirmación:**
  - muestra el seguimiento y la cancelación;
  - oculta la sección de pago cuando ya no hay nada que hacer.
- **Perfil:** sección "Pedidos y avisos", con el enlace al Pase para el personal.
- **Textos:** todos en es-CR y en (`order.tracking`, `order.history`, `order.pass`, `account.inbox`).

## Pruebas

Todas ejecutadas en local el 24/11/2026 sobre el árbol final de la rama (Windows, Docker con PostgreSQL 17 y Mailpit), y repetidas completas sobre `846b02d` antes del push. El CI de GitHub Actions está en "Integración por PR", más abajo.

| Suite | Resultado |
|---|---|
| `npm run check` (Prettier, ESLint, TypeScript y Vitest) | ✅ 835/835 (antes 292: +517 de la matriz del pedido y +26 de correos, proveedores y entorno) |
| `npm run test:db` (integración con PostgreSQL) | ✅ 248/248 (antes 219: +29 de `operacion.db.test.ts`). Corrido dos veces seguidas, sin intermitencias |
| `db:drift` / `env:check` | ✅ Sin diferencias (no hay migraciones) / variables válidas |
| E2E de operación (`test:e2e:operacion`, escenario 2) | ✅ 5/5 en Chromium y 5/5 en `Mobile Safari` |
| E2E del pedido / de pagos | ✅ 12/12 · 6/6 (Chromium y `Mobile Safari`) |
| E2E del catálogo / identidad / producción | ✅ 19 · 14 · 9 |
| E2E de M1 (axe, teclado, idiomas, responsive) | ✅ 41 + 1 omitida, igual que la línea base |
| Build de producción (prerender) | ✅ 57 HTML, igual que M6 (las rutas de M7 son SPA y no se prerenderizan) |
| WebKit en las suites de M1–M4 (R-M5-2) | ⚠️ No se volvió a correr. M7 no toca esas pantallas, salvo el perfil (una sección nueva) |

Dos hallazgos de infraestructura de pruebas, corregidos sin relajar políticas:

- **La configuración por defecto de M1** (`playwright.config.ts`) excluye las suites con API propia carpeta por carpeta. Faltaba `operacion/**`: se agregó.
- **Las dos ejecuciones juntas superan el freno global de ráfagas por IP** (300 / 5 min, en la memoria de la API, §8.4). Por eso `test:e2e:operacion` corre cada motor en una invocación aparte, con una API nueva cada vez. Es el mismo motivo por el que pagos tiene su propia API.

## Auditorías

- **Permisos:**
  - cliente → 403 en el Pase y en los cambios de estado;
  - staff → 403 al cancelar un confirmado;
  - ajeno → 404 en la cancelación y en el seguimiento;
  - invitado → 401;
  - CSRF obligatorio.

  Probado en integración y E2E.
- **Reglas de negocio y estados:**
  - matriz completa;
  - saltos, retrocesos y el paso de la otra modalidad → 409;
  - el pedido nunca cambia si el procesador rechaza;
  - una sola captura con dos confirmaciones simultáneas;
  - versión vieja → 409.
- **Datos:**
  - ninguna respuesta del Pase trae referencias del procesador, claves ni correos;
  - los correos no llevan dirección, teléfono ni pago;
  - la bandeja no trae enlaces;
  - el historial y la bandeja solo devuelven datos de la propia cuenta.
- **Accesibilidad (axe, WCAG 2.2 AA, 0 serias o críticas):**
  - Pantallas analizadas: Pase, seguimiento, historial, bandeja y cancelación del cliente.
  - El seguimiento anuncia el estado con `role="status"`. Cada marca tiene su texto completo para lectores de pantalla y `aria-current="step"`.
  - Los atajos del Pase solo actúan con un pedido enfocado (WCAG 2.1.4). La cancelación es en línea, con foco en el motivo y su error asociado.
- **UX (capturas a 390, 768, 1024 y 1280 px):**
  - Sin desbordamiento horizontal en el Pase, el seguimiento, el historial ni la bandeja.
  - En el celular, el Pase apila las columnas con "Por confirmar" primero.
  - Hallazgos corregidos durante la revisión:
    - la línea de marea del seguimiento desbordaba 38–90 px desde 768 px;
    - "p. m.." con doble punto en las horas;
    - la sección de pago quedaba vacía con el pago ya cobrado;
    - el contador de la columna "Listo / En camino" se partía en dos líneas.

## Defectos encontrados y corregidos durante M7

| # | Hallazgo | Corrección |
|---|---|---|
| 1 | El Pase mostraba claves sin traducir (`pass.forbidden`): la ruta `/admin` no cargaba el espacio de textos `order` | `namespacesForPath` carga `order` en `/admin` |
| 2 | Línea de marea del seguimiento con desbordamiento horizontal desde 768 px | Envoltorio posicionado en lugar de `w-full` con desplazamientos |
| 3 | Doble punto tras la hora ("4:13 p. m..") | Textos sin punto final después de `{{time}}` |
| 4 | Sección "Pago del pedido" vacía con el pago cobrado, anulado o reembolsado | La sección no se muestra si no hay mensaje ni acción |
| 5 | Prueba de pagos intermitente: el worker del outbox de otra API de prueba tomaba el correo de verificación (M7 despierta el outbox desde los pagos) | Proveedor de correo en memoria compartido por archivo y espera breve del token |

## Riesgos

| Riesgo | Estado |
|---|---|
| **R-M6-1** (capturar y anular no cambiaban el pedido) | **Resuelto** e integrado en `main` con M7 (PR #9, merge `991ddba`) |
| **R-M6-2** (pedido vencido confirmado por la reconciliación) | **Resuelto** (D-M7-6) e integrado en `main` con M7 (PR #9, merge `991ddba`) |
| **R-M6-3** (reconciliación sin tope de reintentos ni espera creciente) | **Abierto.** M7 no lo cambia: no está en su alcance |
| **R-M5-1** (`npm audit`, `effect` transitiva de Prisma) | **Abierto**, sin cambios (M7 no toca dependencias) |
| **R-M5-2** (fallas heredadas de WebKit en M1–M4) | **Abierto**, sin cambios. Las suites nuevas de M7 pasan en WebKit |
| **R-M7-1** | **Abierto.** Los barridos y la reconciliación solo corren con la API despierta. El endpoint interno y el cron de §4.3 son de M10 |
| **R-M7-2** | **Abierto.** El límite de staff/admin (30 / 10 min por usuario) puede quedar corto en un local con mucho movimiento. Es la política de §8.4; un cambio requiere aprobación |
| **R-M7-3** | **Abierto.** En la demo pública, la verificación del correo de los visitantes depende de una decisión de M10 (ver la observación de arriba) |
| **R-M7-4** | **Abierto.** Las marcas del seguimiento se ordenan por `createdAt`. Dos transiciones en el mismo milisegundo no tienen un orden garantizado (solo ocurre con el reloj fijo de las pruebas) |

## Evaluación

**Resultado final: 92/100, integración aprobada** (91 en la implementación local; +1 en pruebas por el CI 7/7 en el PR y en `main`).

| Dimensión | Peso | Nota | Justificación |
|---|---|---|---|
| Alcance de M7 | 25 | 24 | Todas las piezas de §12 y lo que M6 dejó para M7. El endpoint interno de jobs y el cron quedan para M10 (infraestructura) |
| Corrección y reglas de negocio | 20 | 19 | Matriz de 512 casos, transiciones atadas al resultado del procesador, versión optimista y concurrencia probadas. Cierra R-M6-1 y R-M6-2. Queda R-M7-4 (marcas con el mismo milisegundo) |
| Seguridad | 15 | 14 | RBAC e IDOR en la API, cuerpos estrictos, AuditLog con motivo, bandeja sin enlaces. Pendiente la revisión completa de M9 |
| UX, accesibilidad e i18n | 15 | 12 | axe sin violaciones serias en las pantallas nuevas, 4 anchos sin desbordamiento, dos idiomas, 4 defectos visuales corregidos. Sin *finish gate* externo |
| Pruebas | 15 | 14 | Unitarias, integración, E2E en dos motores, regresión local completa y CI 7/7 en el PR y en `main` después del merge. Sin repetir WebKit en M1–M4 (R-M5-2) |
| Documentación y proceso | 10 | 9 | ADR 0008, este documento, CHANGELOG, TESTING, SECURITY, variables y planificación al día; commits separados; integración por PR con CI y cierre registrado. Sin *finish gate* externo ni revisión de un tercero |
| **Total** | **100** | **92** | |

## Integración por PR (24/11/2026)

- **PR #9:** `m7-operacion` → `main`, sobre `c30de42` (sin cambios en `main` desde entonces). Commits:
  - `a39096a`: API;
  - `3d51ced`: web, E2E y CI;
  - `846b02d`: documentación;
  - y este registro del estado de integración.
- **Push** sin force; el remoto quedó igual a la historia revisada.
- **Validación local previa al push**, sobre `846b02d`, todo en verde:
  - `check` 835;
  - `test:db` 248;
  - `drift` y `env:check`, también con `.env.example`;
  - E2E de operación 5 + 5, pedido 12, pagos 6, catálogo 19, identidad 14, producción 9 y M1 41 + 1 omitida;
  - build con 57 HTML.
- **CI del PR sobre `846b02d`** ([run](https://github.com/Yulmes/restaurante/actions/runs/45506147978)): **7/7 jobs aprobados en el primer intento, sin reintentos.**
  - El job **Pedido, pagos y operación** levantó PostgreSQL y Mailpit. Resultados: pedido 12/12, pagos 6/6 y operación 5/5 en Chromium + 5/5 en `Mobile Safari`, con los asuntos verificados en Mailpit.
  - Los otros seis jobs: formato, lint, tipos y tests; sistema de diseño y accesibilidad; servicios locales; base de datos; identidad; catálogo y SEO.
- **CI del PR sobre `fd39fd4`** ([run](https://github.com/Yulmes/restaurante/actions/runs/45513719164)): 7/7, sin reintentos.

## Integración y cierre (24/11/2026)

- **Estado:** M7 está **integrado en `main` y cerrado**, con autorización de Nivel 4 del propietario.
- **PR:** [#9](https://github.com/Yulmes/restaurante/pull/9), `m7-operacion` (último commit `fd39fd4`) → `main`, integrado con un merge commit, el método de los PR anteriores. Sin auto-merge. La rama `m7-operacion` se conserva.
- **Merge en `main`:** `991ddba` (padres `c30de42` y `fd39fd4`). Integra `a39096a`, `3d51ced`, `846b02d` y `fd39fd4`. El árbol de `main` quedó idéntico al de `fd39fd4`. `main` y `origin/main` quedaron sincronizados.
- **CI:** 7/7 jobs aprobados en el PR (runs [sobre `846b02d`](https://github.com/Yulmes/restaurante/actions/runs/45506147978) y [sobre `fd39fd4`](https://github.com/Yulmes/restaurante/actions/runs/45513719164)) y 7/7 después del merge en `main` sobre `991ddba` ([run](https://github.com/Yulmes/restaurante/actions/runs/45524032776)). Todos en el primer intento, sin reintentos ni correcciones.
- **Despliegue:** ninguno. `DEMO_PAYMENTS_ENABLED` no se activó en ningún entorno remoto.
- **Evaluación final:** **92/100, integración aprobada.**
- **Riesgos:**
  - **R-M6-1 y R-M6-2:** resueltos e integrados en `main`.
  - **R-M7-1 a R-M7-4:** abiertos (ver "Riesgos").
  - **R-M5-1, R-M5-2 y R-M6-3:** heredados, abiertos y sin cambios.
- **M8:** no iniciado; empieza solo con autorización expresa del propietario.
