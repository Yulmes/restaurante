# Validaciones de M8 · Admin

> **Estado (24/11/2026):** **implementación local terminada en la rama `m8-admin`, pendiente de la revisión del propietario.** M8 **no está integrado ni cerrado**: sin push, sin PR, sin CI remoto y sin despliegue. Iniciado con la autorización de Nivel 2 del propietario (24/11/2026), sobre `main` en `4b483c9` (M7 integrado y cerrado, B0 posterior a M7 completado).
>
> **Decisiones de M8.** El propietario resolvió cuatro puntos al iniciar (D-M8-1 a D-M8-4, abajo). El resto se deriva de la propuesta; las derivaciones quedan registradas aquí y en el ADR 0009 para su revisión.

## Definición oficial y alcance

La propuesta (§12) define M8 como "Dashboard (datos reales), carta **con edición de traducciones (D2)**, clientes, configuración, moneda, **impuestos configurables (D5)**, **umbral de Turnstile (D8)**, auditoría; admin completo en ambos idiomas", con los **E2E de los escenarios 3 y 4** (seguridad y errores, §11) como evidencia. Además:

- M7 dejó para M8 la pantalla de reembolsos, el dashboard y la auditoría con filtros (ADR 0008);
- §3.6 pide la pizarra de pesca del día "editable desde admin" y el editor de plato con vista previa en vivo;
- §8.6 pide auditar productos, categorías, opciones, roles, bloqueos, configuración, zonas, tarifas, impuestos, moneda y la publicación de la pesca del día, con una UI de solo lectura y filtros.

| Pieza | Fuente | Estado |
|---|---|---|
| Dashboard con datos reales (trabajo pendiente, ventas, ticket, reembolsos, top de platos, pedidos por estado; hoy, 7 y 30 días) | §12, §2.4 | ✅ Implementado |
| Carta: platos y categorías (crear, editar, desactivar, precio, "Agotado hoy"), grupos y opciones, con la traducción al inglés | §12, §3.6, D2 | ✅ Implementada |
| Editor de plato con vista previa en vivo de la línea de carta, en los dos idiomas | §3.6 | ✅ Implementado |
| Pesca del día: guardar y publicar la pizarra de hoy o de mañana | §3.6, §8.6 | ✅ Implementada |
| Clientes: búsqueda, detalle con pedidos, bloqueo y roles | §12, §8.6 | ✅ Implementados |
| Configuración: modalidades, IVA incluido, pedido mínimo, redondeo, horario | §6.1, §6.2 | ✅ Implementada |
| Impuestos configurables y zonas de delivery | D5, §6.2, §8.6 | ✅ Implementados |
| Umbral de Turnstile configurable | D8, §8.4 | ✅ Implementado |
| Asistente de cambio de moneda | §6.2 punto 3 | ✅ Implementado (tipo de cambio, D-M8-4) |
| Auditoría de solo lectura con filtros | §8.6 | ✅ Implementada |
| Pedidos del admin, reembolso total o parcial y cancelación | ADR 0008 | ✅ Implementados |
| Admin completo en es-CR y en | §12, D2 | ✅ Espacio `admin` con las mismas claves en los dos idiomas |
| E2E escenarios 3 y 4 | §11, §12 | ✅ Chromium y `Mobile Safari` |

**Fuera de M8 (no implementado):**

- promociones (D-M8-1);
- subida de fotos (D-M8-2, M10 con Cloudinary);
- crear o borrar grupos y opciones, crear o borrar zonas y tasas (la semilla las trae; M8 las edita);
- revisión completa de seguridad y accesibilidad (M9), despliegue (M10).

## Decisiones

| Tipo | Decisión | Fundamento |
|---|---|---|
| C · Del propietario (D-M8-1) | Las promociones quedan fuera de M8 | §12 no las lista; R-PUB-01 decía "M5/M8" |
| C · Del propietario (D-M8-2) | El editor solo cambia el texto alternativo de la foto | La subida necesita Cloudinary (cuenta en M10, D14) |
| C · Del propietario (D-M8-3) | Todo M8 es solo de ADMIN; STAFF sigue con el Pase | §3.6, §8.7 |
| C · Del propietario (D-M8-4) | El asistente de moneda usa un tipo de cambio; los precios puntuales se ajustan en el editor | §6.2 punto 3 |
| A · Documentada | El cambio de moneda exige que no haya pedidos activos, convierte en una transacción y lo audita | §6.2 punto 3 |
| A · Documentada | La UI de auditoría es de solo lectura, con filtros | §8.6 punto 4 |
| A · Documentada | Bloqueos, roles, configuración, impuestos, zonas, moneda, carta y pesca del día se auditan en la misma transacción | §8.6 |
| B · Derivada (D-M8-5) | Todos los cambios del admin, también los de la carta, comparten el límite de §8.4 "reembolsos y cambios de configuración" (30 / 10 min por usuario) | §8.4 |
| B · Derivada (D-M8-6) | Ventas del dashboard = pedidos aceptados (de `CONFIRMED` a `DELIVERED`) en la moneda activa, menos reembolsos parciales; los cancelados no cuentan | §7.1, §12 |
| B · Derivada (D-M8-7) | Precios, recargos y tarifas tienen que ser múltiplos del incremento de redondeo de la moneda (CRC: colón entero) | §6.2 punto 1 |
| B · Derivada (D-M8-8) | Nadie cambia su propia cuenta y siempre queda un ADMIN activo; bloquear revoca todas las sesiones al instante | §8.2, §8.7 |
| B · Derivada (D-M8-9) | Concurrencia optimista por `updatedAt` en platos y categorías (sin migración); por `version` en la configuración | §7.1 (mismo patrón) |
| B · Derivada (D-M8-10) | La pesca del día se edita para hoy o mañana; el pasado no se reescribe | §3.6 |
| B · Derivada | El plato nuevo queda asociado a todas las tasas, como la semilla | §6.2, semilla de M2 |

## Qué se implementó

### API (`apps/api/src/modules/admin/`)

- **Contratos** en `packages/shared/src/admin/schemas.ts`: cuerpos estrictos, códigos de validación por campo y respuestas validadas en las pruebas.
- **Rutas** (`routes.ts`), todas `requireRole('ADMIN')`:
  - `GET /api/admin/dashboard?range=today|7d|30d`;
  - `GET /api/admin/menu`, `POST /api/admin/products`, `PUT /api/admin/products/:id`, `POST /api/admin/categories`, `PUT /api/admin/categories/:id`, `PUT /api/admin/option-groups/:id`, `PUT /api/admin/options/:id`;
  - `GET /api/admin/catch`, `PUT /api/admin/catch`;
  - `GET /api/admin/customers`, `GET /api/admin/customers/:id`, `PATCH /api/admin/customers/:id`;
  - `GET /api/admin/settings`, `PUT /api/admin/settings`, `POST /api/admin/settings/currency`, `PUT /api/admin/tax-rates/:id`, `PUT /api/admin/delivery-zones/:id`;
  - `GET /api/admin/audit` (filtros por tipo, prefijo de acción, id y fechas locales);
  - `GET /api/admin/orders`, `GET /api/admin/orders/:id`. El reembolso y la cancelación usan los endpoints de M6 y M7.
- **Servicios:** `menu.ts` (carta y pesca), `settings.ts` (configuración, impuestos, zonas y moneda), `customers.ts` (bloqueo y roles con candado de transacción), `insights.ts` (dashboard, auditoría y pedidos).
- **Funciones puras con pruebas:** `currency.ts` (tipo de cambio en centésimas, half-up, incremento) y `time.ts` (días locales con el desfase real de la zona).
- **AuditLog:** listas blancas `product`, `category`, `optionGroup`, `option`, `catch`, `settings`, `taxRate` y `deliveryZone`.
- **Cambios transversales mínimos:**
  - `users/roles.ts`: `replaceUserRoles` reutiliza el cambio de roles de M3 dentro de otra transacción (el script del propietario no cambia);
  - `app.ts`: monta el router y conecta la invalidación de la versión del catálogo (D10, R20).

### Web

- **Kit del admin** (`app/admin/kit.tsx`): marco con navegación por secciones (STAFF solo ve el Pase), control de acceso, avisos anunciados, campos, montos en unidad mayor ↔ menor, y textos de error por código.
- **Páginas** (`/admin…` y `/en/admin…`, `noindex`, fuera del prerender):
  - Resumen;
  - Pedidos y su detalle (reembolso con `Idempotency-Key` por intento, cancelación con motivo);
  - Carta y editor de plato con vista previa;
  - Pesca del día;
  - Clientes y su detalle;
  - Configuración (con el asistente de moneda en dos pasos: revisar y confirmar);
  - Auditoría.
- **El Pase** suma la navegación del admin.
- **El perfil** suma el enlace al admin para ADMIN.
- **Después del ingreso**, `?next=` ahora acepta también rutas propias del admin, con el mismo patrón seguro.
- **Textos:** espacio `admin` en es-CR y en, con las mismas claves (lo verifica la prueba de mensajes).

### CI

- El job **Pedido, pagos y operación** pasa a **Pedido, pagos, operación y admin**:
  - ejecuta `test:e2e:admin`, con cada motor en su propia invocación por el freno global de ráfagas de §8.4;
  - su tiempo máximo sube de 35 a 45 min.
- La configuración por defecto de M1 ignora `e2e/admin/`.

## Pruebas

Todas ejecutadas en local el 24/11/2026 sobre el árbol final de la rama (Windows, Docker con PostgreSQL 17 y Mailpit). **Sin ejecución en GitHub Actions** (requiere push, no autorizado).

| Suite | Resultado |
|---|---|
| `npm run check` (Prettier, ESLint, TypeScript y Vitest) | ✅ 849/849 (antes 835: +11 de moneda y fechas, +3 de los textos del espacio `admin`) |
| `npm run test:db` (integración con PostgreSQL) | ✅ 266/266 (antes 248: +18 de `admin.db.test.ts`) |
| E2E del admin (`test:e2e:admin`, escenarios 3 y 4) | ✅ 4/4 en Chromium y 4/4 en `Mobile Safari` |
| E2E de operación (M7) | ✅ 5/5 · 5/5 |
| E2E de pedido / pagos | ✅ 12/12 · 6/6 |
| E2E de catálogo / identidad / producción | ✅ 19 · 14 · 9 |
| E2E de M1 | ✅ 41 + 1 omitida (sin cambios) |
| `db:drift` / `env:check` | ✅ Sin diferencias (sin migraciones) / OK |
| Build de producción con prerender | ✅ 57 HTML (sin páginas del admin) |

**`admin.db.test.ts` (18 pruebas):**

- RBAC de todas las lecturas (anónimo 401; cliente y staff 403; el Pase sigue abierto para staff) y CSRF en las escrituras.
- Carta:
  - precio, disponibilidad e inglés reflejados en la carta pública, con la versión del catálogo invalidada;
  - AuditLog por tipo de cambio;
  - versión optimista (409);
  - incremento de precio, cuerpo estricto y traducción obligatoria;
  - creación con su traducción y sus tasas; slug repetido (409); desactivación.
- Categorías, grupos y opciones, con su auditoría.
- Pesca del día: borrador, publicación, portada pública, el pasado y horas inválidas.
- Clientes:
  - bloqueo que revoca sesiones y rechaza el login, desbloqueo, motivo obligatorio y correo enmascarado en el AuditLog;
  - roles; auto-cambio (403); carrera de dos admins (uno 409 `LAST_ADMIN`).
- Configuración:
  - el umbral de Turnstile cambiado por el admin rige el login;
  - versión vieja (409), horario superpuesto o invertido, cuerpo estricto.
- Impuestos y zonas, con el incremento de la tarifa y la API pública de zonas.
- Moneda: bloqueada con pedidos activos; conversión a USD reflejada en la carta pública; misma moneda; versión vieja; vuelta exacta a CRC.
- Dashboard: ventas, reembolsos, otra moneda, cancelados, pendientes y top.
- Auditoría: filtros, orden, paginación, sin endpoints de edición, correos enmascarados.
- Pedidos: búsqueda, estado, detalle; 404 con un id inexistente o inválido.
- Límite de §8.4: el 31.º cambio responde 429 y queda `delivery_zone.rate_limited` en el AuditLog, que el filtro de acciones encuentra.

El archivo cambia la configuración global de la base de prueba: guarda el estado inicial y lo restaura al terminar (precios, tasas, zonas, horario, pizarra y platos creados).

**E2E del admin (`apps/web/e2e/admin/admin.spec.ts`):**

1. Carta: agotado hoy visible en la carta pública y vuelta atrás; precio con vista previa en vivo, reflejado en la página pública y restaurado; AuditLog. axe en el resumen, la carta y el editor.
2. En inglés: publicar la pesca del día (visible en la portada), cambiar el umbral de Turnstile y encontrarlo en la auditoría con filtros y el detalle del cambio. axe en pesca, configuración y auditoría.
3. **Escenario 3 · seguridad:**
   - sin sesión, la página del admin lleva al ingreso con la vuelta al admin;
   - staff y cliente ven el aviso de acceso y la API responde 403;
   - el admin bloquea una cuenta con motivo obligatorio y la sesión abierta del cliente deja de servir; después la desbloquea.
4. **Escenario 4 · errores:**
   - dos pestañas editan el mismo plato y la segunda recibe el conflicto sin pisar el cambio;
   - monto con céntimos en CRC y slug repetido, con los errores junto a los campos;
   - el asistente de moneda se bloquea con un pedido activo;
   - cancelar antes de confirmar anula la tarjeta demo;
   - reembolso parcial de un pedido confirmado en el Pase, con la línea del reembolso y el monto en la base.

## Auditorías

### Accesibilidad

- axe (WCAG 2.2 AA) dentro de las E2E en resumen, carta, editor, pesca del día, configuración, auditoría, cliente y detalle del pedido: **0 violaciones serias o críticas**, en Chromium y en `Mobile Safari`.
- **Estructura y lectura:**
  - un solo `h1` por página; navegación del admin con `aria-current`;
  - tablas con `caption`, `scope` y cabeceras;
  - campos con `label` y errores con `aria-invalid` y `aria-describedby`;
  - avisos con `role="status"` o `role="alert"` en una región `aria-live`.
- **Nombres accesibles:** los botones "Marcar agotado hoy" llevan el plato como texto solo para lectores de pantalla, y el nombre accesible contiene el texto visible (WCAG 2.5.3).
- **Acciones destructivas** (bloquear, cancelar, cambiar la moneda): confirmación en línea o motivo obligatorio, no solo un aviso (§3.6).

### Responsive

Sin desbordamiento horizontal de la página (`scrollWidth = clientWidth`):

- a 375 px, en las 11 vistas del admin, también en inglés;
- a 768, 1024 y 1280 px, en las 8 vistas principales.

Las tablas largas se desplazan dentro de su propio contenedor.

### Seguridad

- **RBAC:** todo en la API (`requireRole('ADMIN')`); la web solo oculta.
- **CSRF** en todas las escrituras.
- **Cuerpos estrictos:** el slug no se edita.
- **Montos:** los calcula siempre el servidor (enteros en unidad menor).
- **AuditLog:** en la misma transacción y con listas blancas; los correos se enmascaran y la auditoría no expone secretos.
- **Cuentas:** bloquear revoca sesiones; siempre queda un admin; nadie cambia su propia cuenta.
- **Límite de §8.4** en todos los cambios del admin.

## Defectos encontrados y corregidos durante M8

| # | Defecto | Corrección |
|---|---|---|
| 1 | Los avisos de "guardado" desaparecían: una `key` atada a la versión de los datos volvía a montar el formulario al recargar | `key` solo por identidad (id del plato); los formularios conservan su estado |
| 2 | En una corrida completa de `test:db`, los registros del archivo nuevo chocaban con el límite de 5 / h por IP de archivos anteriores (el contador de IP de prueba empezaba igual en cada archivo) | Cada archivo empieza en un punto aleatorio del rango de documentación (RFC 5737); el límite no se relaja |
| 3 | El archivo de M8 dejaba datos que otros esperan (pizarra de hoy, plato creado) | Restauración completa en `afterAll` |
| 4 | El asistente de moneda (correctamente) se bloqueaba en la corrida completa por pedidos activos de otros archivos | La prueba los aparta mientras cambia la moneda y los restaura |
| 5 | El ingreso ignoraba `?next=/admin` | `safeNextPath` acepta las rutas propias del admin con el mismo patrón |
| 6 | Botón de disponibilidad con el nombre completo del plato: ruido visual | Texto visible corto, plato solo para lectores de pantalla |
| 7 | "Abre el Lunes" (mayúscula a mitad de frase) | "Apertura · Lunes" |
| 8 | Revisión previa al push: las acciones de límite excedido iban en camelCase (`deliveryZone.rate_limited`) y el filtro de acciones de la auditoría no podía encontrarlas | Acciones en snake_case como el resto (`delivery_zone.rate_limited`), con prueba del filtro |
| 9 | Revisión previa al push: "Guardar borrador" sobre una pizarra ya publicada cambiaba la portada mientras el aviso decía que no se publicaba | Una pizarra publicada solo se corrige con "Publicar los cambios" |
| 10 | Revisión previa al push: el ejemplo del asistente de moneda mostraba siempre CRC → USD | El ejemplo sigue la dirección del cambio |

## Riesgos

| Riesgo | Estado |
|---|---|
| **R-M7-1** (barridos solo con la API despierta) | **Abierto**, sin cambios: M8 no lo toca (M10) |
| **R-M7-2** (límite de staff/admin 30 / 10 min) | **Abierto y con más alcance:** ahora también limita la edición de la carta (D-M8-5). Ver R-M8-1 |
| **R-M7-3** (verificación del correo en la demo pública) | **Abierto**, sin cambios (M10) |
| **R-M7-4** (orden de transiciones en el mismo milisegundo) | **Abierto**, sin cambios |
| **R-M6-3** (reconciliación sin tope de reintentos) | **Abierto**, sin cambios |
| **R-M5-1** (`npm audit`) | **Abierto**, sin cambios (M8 no agrega dependencias) |
| **R-M5-2** (WebKit en M1–M4) | **Abierto**, sin cambios |
| **R-M8-1** (nuevo) | Editar muchos platos seguidos puede alcanzar el límite de 30 cambios / 10 min. Es la política de §8.4 aplicada a la carta (D-M8-5); cambiarla requiere aprobación |
| **R-M8-2** (nuevo) | El cambio de moneda cuenta los pedidos activos después de tomar la configuración, pero la creación de pedidos no bloquea esa fila: un pedido creado en el mismo instante podría quedar en la moneda anterior. Ese pedido conserva su moneda (§6.2) y el dashboard lo cuenta aparte; la ventana es de milisegundos |
| **R-M8-3** (nuevo) | Precios ya publicados en el HTML prerenderizado cambian recién con el rebuild (M10); la web los corrige al hidratar con el precio en vivo (D10), como en M4 |
| **R-M8-4** (nuevo) | Sin *finish gate* externo de las pantallas del admin (como en M7) |

## Evaluación

**Puntaje propuesto: 90/100.** Implementación local completa y verificada, pendiente de la revisión del propietario y de la integración.

| Dimensión | Peso | Nota | Justificación |
|---|---|---|---|
| Alcance de M8 | 25 | 23 | Todas las piezas de §12 y lo que M7 dejó para M8. Quedan fuera, por decisión, las promociones y la subida de fotos; no se crean grupos, opciones, zonas ni tasas nuevas |
| Corrección y reglas de negocio | 20 | 19 | Versión optimista, moneda en una transacción con enteros, incremento de precios, último admin con candado, auditoría por tipo de cambio. Queda R-M8-2 |
| Seguridad | 15 | 14 | RBAC en la API, CSRF, cuerpos estrictos, AuditLog con listas blancas, bloqueo con revocación, límites. Pendiente la revisión completa de M9 |
| UX, accesibilidad e i18n | 15 | 12 | axe sin violaciones serias, 4 anchos sin desbordamiento, dos idiomas completos, vista previa en vivo, confirmaciones en línea. Sin *finish gate* externo |
| Pruebas | 15 | 13 | Unitarias, 18 de integración, E2E de los escenarios 3 y 4 en dos motores y regresión local completa. Sin CI remoto (exige push) |
| Documentación y proceso | 10 | 9 | ADR 0009, este documento y los documentos del proyecto al día; commits locales separados. Falta registrar el CI remoto |
| **Total** | **100** | **90** | |

## Preparación para la integración

- Rama `m8-admin` con commits locales sobre `4b483c9`, sin push.
- CI actualizado (job con el admin), todavía sin correr en GitHub Actions.
- Para integrar, en una autorización aparte de Nivel 3: push, PR a `main`, CI 7/7 y merge con merge commit.
