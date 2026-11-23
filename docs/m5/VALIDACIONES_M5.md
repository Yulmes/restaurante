# Validaciones de M5 · Pedido

> **Fecha:** 22/11/2026. Son resultados de ejecuciones locales en la rama `m5-pedido` (base `a710dba`, M4 integrado). **M5 no está integrado ni cerrado:** espera la revisión del propietario. **Sin ejecución en GitHub Actions** (requiere push, no autorizado).
> Decisiones aplicadas: D3, D4, D5, C5 y §6.2, §7.3, §7.5 de la propuesta; D-M5-1 a D-M5-5 y WebKit incremental (opción A), aprobadas por el propietario para este hito. Detalle técnico en el [ADR 0006](../adr/0006-pedido-carrito-precios-e-idempotencia.md).

## Qué se implementó

| Área | Resumen |
|---|---|
| Contratos (`shared`) | Carrito, cotización, direcciones, zonas, checkout y pedido; `lineKey`; códigos de error de M5 y `details`; `id` del plato en la carta pública; `sessionStateResponseSchema` |
| Motor de precios | Puro y con enteros. IVA incluido o sumado, half-up una vez por tasa, ajuste al incremento, descuentos por mayor resto y envío en la base de las tasas `BOTH`/`DELIVERY`. Lee `roundingIncrementMinor` de `RestaurantSettings` |
| Carrito | Invitado en `localStorage` (solo referencias), valorizado por `POST /api/cart/quote`. Cuenta en PostgreSQL (`GET /api/cart`, `POST /api/cart/items`). Regla C5: total sin tope de 20 y líneas internas de hasta 20 |
| Fusión | `POST /api/cart/merge` idempotente por `mergeKey` (cada clave registrada, no solo la última). Suma por identidad y devuelve `unavailable[]` con el motivo. La web fusiona al detectar la sesión y borra el carrito local solo con un 2xx |
| Direcciones y zonas | `GET/POST/DELETE /api/account/addresses` y `GET /api/public/delivery-zones`. Solo distritos cubiertos; tarifa y ETA del servidor |
| Checkout | `POST /api/checkout/quote` con totales, problemas, `openNow`/`orderingAllowed` y `quoteVersion`. Web de 3 pasos (Entrega → Datos → Pago), con resumen plegable y botón fijo abajo en el celular, y dos columnas en escritorio |
| Pedido | `POST /api/orders` (cuenta verificada, `Idempotency-Key`). Transacción con revalidación de catálogo, opciones, disponibilidad, horario, modalidad, zona, mínimo y precio, y copia histórica (líneas de hasta 20, opciones en el idioma del pedido y en es-CR, impuestos). Queda en `PENDING_PAYMENT` con el pago en `REQUIRES_PAYMENT`. `GET /api/orders/:id` con 404 si es ajeno |
| Web | Botón "Pedido · N · ₡X" en la barra, "Agregar" en la carta con hoja de producto (`<dialog>`), hoja de producto en la página del plato, `/pedido`, `/pedido/finalizar`, `/pedido/confirmacion/:id` (y `/en/order/...`), direcciones en el perfil y `?next=` seguro al iniciar sesión |
| Sesión del invitado | `GET /api/auth/session` (200 con `user: null`): las páginas públicas no registran un 401. `/auth/me` no cambia |

## Resultados

| Validación | Comando | Resultado |
|---|---|---|
| Formato, lint, tipos y unitarias | `npm run check` | ✅ 200 / 200 pruebas en 18 archivos (antes de M5: 118). Incluye el motor de precios, las líneas y C5, el horario, las variables de entorno, las claves i18n del espacio `order` y el `?next=` seguro |
| Integración con PostgreSQL | `npm run test:db` | ✅ 172 / 172 en 8 archivos (antes: 134). `pedido.db.test.ts`: 38 pruebas |
| Esquema y migraciones | `npm run db:drift -w @marea-baja/api` | ✅ Sin diferencias. **Sin migraciones nuevas** |
| Variables de entorno | `npm run env:check` | ✅ Con `ORDERS_ALLOW_OUTSIDE_HOURS` (por defecto `false`) |
| E2E del pedido, Chromium | `npm run test:e2e:pedido -w @marea-baja/web` | ✅ 6 / 6 (3 + 3 de regresión de D1–D4, desde el 23/11/2026) |
| E2E del pedido, `Mobile Safari` | ídem (mismo comando) | ✅ 6 / 6 |
| E2E del catálogo (M4) | `npm run test:e2e:catalog -w @marea-baja/web` | ✅ 19 / 19, con el build de producción (56 páginas) |
| E2E del idioma del documento (M3) | `npm run test:e2e:produccion -w @marea-baja/web` | ✅ 9 / 9 |
| E2E de identidad (M3) | `npm run test:e2e:auth -w @marea-baja/web` | ✅ 14 / 14 |
| E2E del sistema de diseño (M1) | `npm run test:e2e -w @marea-baja/web` | ✅ 41 pasan y 1 se omite (igual que antes) |
| Dependencias de producción | `npm audit --omit=dev` | ⚠️ 3 avisos altos **heredados, no de M5**: `effect` ≤ 3.22.0 (ReDoS, GHSA-7589-6fvf-x4pw), transitiva de `@prisma/config`/`prisma`. `package-lock.json` no cambió desde M4; la única corrección que ofrece npm es bajar Prisma a 6.12 (cambio incompatible). Requiere decisión |
| CI | `.github/workflows/ci.yml`, job **Pedido** | ⏳ Agregado, sin ejecución remota |

### Integración (38 pruebas, `apps/api/test/pedido.db.test.ts`)

- **Cotización del invitado:**
  - precios de la base (ignora los que manda el cliente);
  - motivos por línea: agotado, inexistente y opciones inválidas (falta la obligatoria, ajena o sobre el máximo);
  - validación de entrada;
  - CSRF también para el invitado.
- **Carrito de la cuenta (C5):**
  - 15 → [15]; +10 → [20, 5]; 30 → [20, 10]; 47 → [20, 20, 7]; 41 → [20, 20, 1]; 40 → [20, 20]; 19 → [19]; 120 sin tope de 20; 0 lo quita;
  - opciones en otro orden van a la misma línea;
  - rechazos sin tocar el carrito;
  - tope técnico de 999.
- **Fusión:**
  - suma con lo existente y devuelve `unavailable[]`;
  - la misma clave dos veces no vuelve a sumar;
  - 47 → 20 + 20 + 7;
  - **A → B → A no vuelve a sumar A**;
  - tres fusiones simultáneas con la misma clave suman una sola vez;
  - la clave es por cuenta;
  - el exceso sobre el tope vuelve como `QUANTITY_LIMIT`.
- **Direcciones:** zonas de la semilla, distrito normalizado, fuera de zona → 422, IDOR → 404.
- **Cotización del checkout:**
  - IVA 13 % incluido con la base y el impuesto exactos;
  - problemas: vacío, mínimo, dirección faltante y horario;
  - el mínimo no cuenta el envío (₡4 400 + ₡1 200 no alcanza).
- **Pedido:**
  - sin sesión → 401;
  - sin verificar → 403 `EMAIL_NOT_VERIFIED`;
  - `Idempotency-Key` obligatoria y UUID;
  - creación completa: estados, `DEMO_CARD`, montos de pago en 0, líneas 20 + 5, opciones en en y es-CR, IVA, historial, `expiresAt` +30 min y carrito vacío;
  - misma clave → la misma respuesta; otro cuerpo → 422;
  - 4 peticiones simultáneas con la misma clave → un pedido;
  - doble confirmación con otra clave en menos de 60 s → el mismo pedido (`duplicate: true`); pasado el minuto → `CART_EMPTY`;
  - `PRICE_CHANGED` con la cotización nueva y, al confirmarla, el pedido al precio nuevo;
  - agotado durante el checkout → 409 sin pedido y con el carrito conservado;
  - mínimo → 422;
  - fuera de horario → 409, y con el modo de demostración se acepta;
  - delivery con tarifa del servidor (los montos del cliente se ignoran);
  - teléfono obligatorio;
  - dirección ajena → 404;
  - modalidad deshabilitada → 409;
  - `DINE_IN` → 400;
  - CSRF (sin token y desde otro origen) → 403;
  - límite de 20 por hora → 429 con `Retry-After`.
- **Consulta de pedidos:** el dueño lo ve; ajeno, inexistente o mal formado → 404 sin diferencias; sin sesión → 401.
- **`/api/auth/session`:** 200 con `user: null` para el invitado; `/auth/me` conserva su 401.

### E2E del pedido (`apps/web/e2e/pedido/pedido.spec.ts`, 6 pruebas × 2 proyectos)

1. **Invitado → cuenta → retiro, en es-CR:**
   - carta → "Agregar" → hoja de producto → Rocoto → agregar;
   - otro plato desde su página;
   - cambio de cantidad, quitar una línea y recarga (persistencia local);
   - axe del carrito;
   - checkout → pide iniciar sesión → login → vuelve al checkout con la fusión hecha (el carrito local se borra);
   - entrega, datos y pago (aviso de demo y axe) → **doble clic** en confirmar;
   - confirmación demo (axe);
   - en la base: **un** pedido `PENDING_PAYMENT`, pago `REQUIRES_PAYMENT`, 2 unidades, total correcto y carrito vacío.
2. **En inglés, delivery con cambio de precio:**
   - login → agregar → checkout → delivery → alta de una dirección (San Pedro) con zona, tarifa y ETA → datos → axe;
   - **se sube el precio en la base:** `PRICE_CHANGED`, aviso, sin pedido;
   - nueva confirmación al total nuevo → confirmación con la dirección;
   - en la base: un pedido `DELIVERY` con envío de ₡1 200 y total de ₡11 100.
3. **Cuenta sin verificar:** arma el pedido, el checkout pide verificar y `POST /api/orders` → 403, sin pedido.
4. **D1 y D2 (barra):** inicio, carta, plato, carrito y checkout a 390, 768, 1024 y 1440 px, con el pedido vacío y con productos: sin desborde, sin controles fuera de la pantalla, cada parte del botón en un renglón y la navegación alcanzable.
5. **D3 (dirección):** después de un error, corregir el último dato y hacer un solo clic guarda la dirección con un único `POST`.
6. **D4 (recargo de una opción):** "(+₡600)" en un solo renglón a 390 y 768 px.

## WebKit (opción A, incremental)

- **Pedido:** las 6 pruebas pasan en `Mobile Safari`.
- **Límite:** es el **motor WebKit de Playwright con perfil de iPhone 13, ejecutado en Windows**. **No es Safari de iOS en un dispositivo real** y no se presenta como tal. La cobertura de dispositivos sigue en M9.
- **Línea base de las suites anteriores en `Mobile Safari`:** misma configuración y solo el proyecto WebKit, con configuraciones temporales fuera del repositorio; no se modificaron las suites.

| Suite | Pasan | Fallan | Causa de las fallas (heredadas de M1–M4, no corregidas) |
|---|---|---|---|
| M1 (`playwright.config.ts`) | 35 | 6 (y 1 se omite) | **Supuesto de escritorio:** a 390 px el selector de idioma vive en el menú desde M4 (2 pruebas de regiones). **axe:** `scrollable-region-focusable` en `/_design` a 390 px (3). **WebKit:** Tab no enfoca enlaces por defecto ("Saltar al contenido", 1) |
| Identidad (M3) | 12 | 2 | **WebKit:** informa `sameSite` distinto en la cookie de sesión por HTTP local (1). **Helper móvil:** el selector de idioma dentro del menú: la prueba busca el enlace antes de que el menú se reabra tras la navegación (1) |
| Catálogo (M4) | 15 | 4 | **Supuesto de escritorio:** búsqueda y filtros plegados a 390 px (2) y navegación principal oculta en el celular (1). **WebKit:** Tab y "Saltar al contenido" (1) |
| Idioma del documento (M3) | 8 | 1 | **Supuesto de escritorio:** selector de idioma dentro del menú en el celular |

Las mismas suites pasan completas en Chromium con los cambios de M5 (ver "Resultados"). No se repitió la línea base de WebKit sobre `a710dba`: la clasificación sale de los mensajes de error, que no involucran elementos de M5.

## Lo que no se verificó o queda pendiente

| Tema | Estado |
|---|---|
| CI en GitHub Actions (job **Pedido**) | Sin ejecución remota (requiere push) |
| Safari de iOS real | No probado (M9) |
| Fallas heredadas de WebKit en M1–M4 | Documentadas arriba, no corregidas (requieren autorización) |
| Capturas del checkout a 768 y 1024 px | No hechas (M9) |
| Lighthouse de las páginas nuevas | No medido: no se prerenderizan ni se indexan |
| Limpieza de `IdempotencyKey` vencidas | No hay job (ver ADR 0006) |
| Textos editoriales `home.visitBody` y `visit.lead` | ✅ Actualizados el 22/11/2026 con la autorización del propietario (ver `REVISION_ACEPTACION_M5.md`) |
| `npm audit`: `effect` (transitiva de Prisma) | Analizado en `REVISION_ACEPTACION_M5.md`: no está en el runtime; se recomienda aceptar el riesgo temporalmente y esperar una versión de Prisma 7 que lo corrija. Sin cambios de dependencias |
| Defectos visuales D1–D4 (barra a 768 y 390 px, clic perdido al guardar una dirección, precio de la opción partido) | ✅ Corregidos el 23/11/2026 (ver `REVISION_ACEPTACION_M5.md` §6). La línea base de WebKit de M1–M4 se repitió después: mismos resultados (35/6/1, 12/2, 15/4, 8/1) |
| Expiración de pedidos `PENDING_PAYMENT` a los 30 min | `expiresAt` guardado; el job que cancela es de M7 |
