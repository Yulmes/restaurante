# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).

## [Sin publicar]

### Agregado — M8 · Admin (integrado en `main` mediante el PR #11)

- **Dashboard** (`/admin`) con datos reales: primero el trabajo pendiente y el enlace al Pase; después ventas netas, pedidos aceptados, ticket promedio, reembolsos, platos más pedidos y pedidos por estado (hoy, 7 y 30 días, hora del local).
- **Carta** (`/admin/carta`): categorías y platos con su traducción al inglés (D2), "Agotado hoy" con un clic, creación y desactivación. Editor de plato con vista previa en vivo de la línea de carta en los dos idiomas (§3.6); grupos y opciones con recargo y disponibilidad. Versión optimista (409) y precios en el incremento de la moneda.
- **Pesca del día** (`/admin/pesca`): borrador y publicación de la pizarra de hoy o de mañana.
- **Clientes** (`/admin/clientes`): búsqueda, detalle con pedidos, bloqueo (revoca sesiones) y roles, con motivo; nadie cambia su propia cuenta y siempre queda un admin.
- **Configuración** (`/admin/configuracion`): modalidades, IVA incluido, pedido mínimo, redondeo, horario, umbral de Turnstile (D8), impuestos (D5) y zonas de delivery.
- **Asistente de cambio de moneda** (§6.2): exige que no haya pedidos activos y convierte precios, recargos, tarifas y pedido mínimo en una sola transacción con un tipo de cambio (D-M8-4).
- **Auditoría** (`/admin/auditoria`): solo lectura, con filtros por tipo, acción y fechas (§8.6).
- **Pedidos** (`/admin/pedidos`): lista con búsqueda y estado; detalle con reembolso total o parcial y cancelación (pantalla que M7 dejó para M8).
- **API** `/api/admin/*` solo para ADMIN (D-M8-3), con AuditLog en la misma transacción y el límite de §8.4.
- **E2E de los escenarios 3 y 4** (`npm run test:e2e:admin`) en Chromium y `Mobile Safari`, y 18 pruebas de integración (`admin.db.test.ts`).

### Cambiado — M8

- El Pase muestra la navegación del admin; el perfil, el enlace al admin para ADMIN; el ingreso vuelve a la sección del admin pedida (`?next=`).
- `replaceUserRoles` reutiliza el cambio de roles de M3 dentro de otra transacción.
- Pruebas con PostgreSQL: cada archivo empieza en un punto aleatorio del rango de IP de prueba, para no compartir contadores de límites entre archivos.
- CI: el job del pedido suma la suite del admin y su tiempo máximo sube a 45 min.

### Agregado — M7 · Operación (integrado en `main` mediante el PR #9)

- **Máquina de estados del pedido** (§7.1) con la matriz completa por rol y modalidad, y un único punto de transición: versión optimista, historial, AuditLog de staff/admin y correos en la misma transacción.
- **Pase** (`/admin/pase`, API `GET /api/admin/pass` y `PATCH /api/admin/orders/:id/status`): columnas por estado, antigüedad, avance con un clic, cancelación con motivo y atajos de teclado.
  - Confirmar captura la tarjeta demo.
  - Cancelar antes de confirmar anula el pago.
  - Cancelar después (solo admin) reembolsa lo cobrado.
- **Seguimiento** (`/cuenta/pedidos/:id`) sobre la línea de marea, **historial** (`/cuenta/pedidos`, D3) y **cancelación del cliente** antes de la confirmación (`POST /api/orders/:id/cancel`).
- **Contra entrega:** al entregar, el cobro queda `COLLECTED`.
- **Barridos** cada minuto:
  - pedidos sin pagar a los 30 min;
  - sin confirmar a los 20 min (`ORDER_CONFIRMATION_TIMEOUT_MINUTES`);
  - autorizados después de vencer.
- **Correos de estado** en es-CR y en (recibido, confirmado, en preparación, listo / en camino, entregado, cancelado, reembolso) y "nuevo pedido por confirmar" al staff.
- **`DEMO_ONLY` y bandeja de demostración** (`/cuenta/bandeja`, `GET /api/me/notifications`), con `EMAIL_PROVIDER=demo` y `EMAIL_DELIVERABLE_TO`.
- **Pruebas:**
  - matriz de 512 transiciones;
  - 29 de integración;
  - E2E del escenario 2 en Chromium y `Mobile Safari` (`test:e2e:operacion`, también en CI).
- **Documentos:** ADR 0008 y `docs/m7/VALIDACIONES_M7.md`.

### Cambiado — M7

- **Pagos (cierra R-M6-1):** capturar, anular y reembolsar la cancelación mueven el pedido al terminar la operación, también por reconciliación. Los endpoints de M6 se conservan.
- **R-M6-2:** un pago autorizado después del vencimiento se anula en el barrido siguiente.
- **Pedido (`GET /api/orders/:id`):** trae `timeline` y `cancellable`. La confirmación muestra el seguimiento y oculta la sección de pago cuando ya no hay nada que hacer.
- **CI:** el job **Pedido y pagos** pasa a **Pedido, pagos y operación**. Levanta Mailpit y ejecuta `test:e2e:operacion`.
- **Pruebas de integración:** un solo proveedor de correo en memoria por archivo, porque las API de prueba comparten la base y su outbox.

### Agregado — M6 · Pagos (integrado en `main` mediante el PR #7)

- **Interfaz `PaymentGateway`** y procesador simulado (`MockGateway`) con los escenarios de la tarjeta demo: aprobado, rechazado, fondos insuficientes, error del procesador, tiempo agotado y pendiente (§7.4). Sin dinero real ni datos de tarjeta.
- **Autorizar** (`POST /api/orders/:id/payments/authorize`) con `Idempotency-Key`, intención registrada antes de llamar al procesador y bloqueo del pago. Aprobado → pedido en `PENDING_CONFIRMATION`.
- **Pagar al recibir o al retirar** (`POST /api/orders/:id/payments/cash-on-delivery`, D-M6-1), en retiro y en delivery (D-M6-4).
- **Reconciliación** cada 5 s: tiempo agotado, pendiente y operaciones interrumpidas, sin cobrar dos veces.
- **Staff y admin, sin interfaz (D-M6-2):** capturar y anular (STAFF/ADMIN) y reembolsar total o parcial (ADMIN) bajo `/api/admin/orders/:id/payment`, con AuditLog y límites.
- **Web:** forma de pago y selector de escenarios en el paso 3 del checkout; en la confirmación, estado del pago, actualización sola mientras está en proceso y reintento tras un rechazo.
- **Variable `DEMO_PAYMENTS_ENABLED`** (por defecto `false`).
- **Pruebas:** matriz de la máquina de estados, 25 de integración y E2E de pagos en Chromium y `Mobile Safari` (`test:e2e:pagos`, también en CI).
- **Documentos:** ADR 0007 y `docs/m6/VALIDACIONES_M6.md`.

### Cambiado — M6

- La idempotencia HTTP de `POST /orders` se extrajo a un módulo compartido, sin cambios de comportamiento.
- El pedido trae `payment.method`, `payment.availableMethods` y `payment.lastAttempt`; la cotización del checkout, `paymentMethods`.
- Textos del checkout y de la confirmación: el pago ya no dice "no habilitado"; dice que es un entorno de demostración sin dinero real.
- El job de CI **Pedido** pasa a **Pedido y pagos** y ejecuta también `test:e2e:pagos`.

### Corregido — M6, revisión de aceptación técnica

- **Procesador simulado:** dos llamadas simultáneas con la misma clave (capturar, anular o reembolsar) reciben el mismo resultado; antes una podía recibir un rechazo aunque la operación se hubiera hecho.
- **`/authorize` y `/refunds`:** repetir un intento con la misma `Idempotency-Key` después de una respuesta perdida devuelve su resultado; antes podía responder 500.
- **Capturar y anular** se excluyen entre sí mientras una está en curso (409 `PAYMENT_IN_PROGRESS`, antes 502). La respuesta de staff y admin refleja el estado final de la operación.
- **Pruebas:** 22 de integración nuevas (concurrencia, idempotencia, reconciliación, acceso y datos expuestos). La matriz está en `docs/m6/VALIDACIONES_M6.md`.

### Agregado — M5 · Pedido (integrado en `main` mediante el PR #6)

- **Carrito:** de invitado en el navegador (solo referencias) y de la cuenta en PostgreSQL, con la regla C5 (total sin tope de 20 y líneas internas de hasta 20). La fusión al iniciar sesión es idempotente por `mergeKey` (cada clave registrada).
- **Motor de precios e impuestos** puro, con IVA 13 % incluido y servicio inactivo (D5), redondeo half-up una vez por tasa y ajuste al incremento.
- **Checkout de 3 pasos**, solo retiro y delivery (D4), con direcciones y zonas del servidor, pedido mínimo (D-M5-4) y bloqueo fuera de horario (D-M5-3; `ORDERS_ALLOW_OUTSIDE_HOURS`).
- **Pedido** transaccional con copia histórica, `Idempotency-Key`, detección de duplicados en 60 s y `409 PRICE_CHANGED` (D-M5-2). Queda en `PENDING_PAYMENT` con el pago en `REQUIRES_PAYMENT` (D-M5-1): sin cobro.
- **Web:** botón del pedido en la barra, "Agregar" en la carta con hoja de producto, la página del plato como hoja de producto, carrito, checkout, confirmación demo y direcciones en el perfil, en es-CR y en.
- **API:** `GET /api/auth/session` para saber si hay sesión sin un 401 en las páginas públicas.
- **Pruebas:** unitarias, 38 de integración y E2E en Chromium y `Mobile Safari`; job **Pedido** en CI.
- **Documentos:** ADR 0006 y `docs/m5/VALIDACIONES_M5.md`.

### Cambiado — M5

- La carta pública incluye el `id` de cada plato.
- La página del plato deja de ser informativa: opciones, cantidad y "Agregar".
- `OptionGroup` admite modo controlado y opciones deshabilitadas; `MenuLine`, una acción. Los dos cambios son compatibles con M1.

### Agregado — M4 · Catálogo y SEO

- **API pública** (`/api/public/*`): carta por idioma con respaldo es-CR marcado (§4.5), `catalog-version` en memoria (R20), pizarra de pesca del día y horario. Contratos en `@marea-baja/shared`. Sin cambios de esquema.
- **Sitio público prerenderizado en es-CR y en** (§4.2): portada con el plato de la casa y la pesca del día, carta, cada categoría, cada plato (informativo: opciones como información), Nosotros y Visítanos. Son 56 páginas.
- **SEO:** título, descripción, canónica, `hreflang` (es-CR, en, x-default), Open Graph 1200×630, Twitter card, JSON-LD (`Restaurant`, `Menu`, `MenuItem`), `sitemap.xml` con alternativas, `robots.txt`, `noindex` en el fallback SPA y `catalog-version.json`.
- **Precios, disponibilidad y pesca del día en vivo al hidratar** (D10, TanStack Query).
- **Carta con índice, búsqueda y filtros por etiqueta en línea.** En el celular se pliegan para que la carta empiece arriba (§2.4).
- **Navegación del sitio** (§3.5) con menú del celular en `<dialog>`, también en las páginas de la cuenta.
- **Imágenes:** variantes AVIF/WebP 4:5, 3:2, 1:1 y Open Graph JPEG generadas en el build con un único ajuste de color (§2.3, §9.4).
- **Herramientas:**
  - `npm run preview` sirve el build como el hosting estático, con compresión Brotli/gzip;
  - `npm run lighthouse` mide el build con Lighthouse 13.6.0 (dependencia de desarrollo).
- **`CATALOG_API_URL` usa `API_PROXY_TARGET` si falta:** el servidor de desarrollo evalúa la lista de rutas del prerender.
- **Pruebas:** E2E del catálogo sobre el build de producción y job **Catálogo y SEO** en CI.
- **Documentos:**
  - ADR 0005;
  - `docs/m4/CONTENIDO_EDITORIAL.md` (textos y plato de la casa aprobados el 13/11/2026);
  - `docs/m4/VALIDACIONES_M4.md`.

### Cambiado — M4

- **Textos por idioma y espacio en el navegador:** cada página pide solo `common` y `site` de su idioma (más `account` o `design` en esas secciones), en lugar de los 8 archivos en el paquete inicial. El prerender sigue con todos (ADR 0005, §5).
- **Imágenes 4:5:** variante `card` de 720 px y `sizes` con las medidas reales de la grilla. En el celular, la foto del plato de la casa pasa de 30 KB a 21 KB.
- **Textos aprobados:**
  - "Una cocina nikkei en San José" y "Conocé nuestra propuesta";
  - la portada y "Ubicación y horario" (antes "Visítanos") ya no prometen pedidos en línea antes de M5;
  - el local se presenta como punto de retiro, sin servicio de mesa;
  - "El oficio detrás de cada plato";
  - en inglés, "Nikkei ceviche restaurant".
- **Plato de la casa aprobado:** Ceviche clásico de corvina (`FEATURED_PRODUCT_SLUG`).
- **Lighthouse:** `summary.json` guarda también el resultado de cada corrida.
- **Idioma del documento (corrección de M3 integrada):** `entry.client.tsx` fija `<html lang>` con el idioma de la URL antes de hidratar. Antes, las rutas en inglés servidas por el fallback SPA quedaban en `es-CR`. Suite `npm run test:e2e:produccion` (9 pruebas) sobre el build prerenderizado servido por `serve-build`.
- **CI:** la suite del idioma del documento corre en el job **Catálogo y SEO**, después de la E2E del catálogo.
- **Criterios aplazados con aceptación del propietario** (17/11/2026): LCP móvil en producción, validadores externos de JSON-LD y `hreflang` y workflow de rebuild en M10; capturas a 768 y 1024 px en M9. Siguen pendientes (`docs/m4/VALIDACIONES_M4.md`).
- **Medición con HTTP/2:** `npm run preview:h2` sirve el mismo build con HTTP/2 y TLS local, sin respaldo a HTTP/1.1, como el CDN. `npm run lighthouse:h2` lo mide y comprueba el protocolo de cada respuesta. El certificado (`npm run cert:dev`, `selfsigned` como dependencia de desarrollo) vive fuera del repositorio y solo lo acepta el Chromium de las pruebas. HTTP/1.1 (`preview`, `lighthouse`) se conserva como referencia histórica, con los resultados en `lighthouse-report/h1/`.
- **Fuente del ₡ recortada a ese glifo** (ADR 0002): `Marea Colon` pasa de 55–59 KB a unos 850 B por peso, con el mismo dibujo (0 píxeles distintos) e incrustada en el documento. Se genera con `npm run fonts:colon -w @marea-baja/web` (`subset-font`, dependencia de desarrollo).

- `MenuLine` (M1) acepta enlace en el nombre, nombre traducido e idioma de la descripción. `Button` exporta `buttonClassName` para enlaces con aspecto de botón. No hay cambios visuales en lo existente.
- **Páginas de la cuenta (M3):** usan la barra y el pie del sitio.
- **Pruebas de M1 y M3 ajustadas a la navegación nueva:**
  - la portada tiene dos regiones de navegación con nombre;
  - en el celular, ES · EN está dentro del menú.
- **CI:**
  - el job de sistema de diseño levanta PostgreSQL y la API;
  - el build de producción se prueba en el job de catálogo.

### Agregado — M3 · Identidad

- **API Express 5** (§4.3):
  - `requestId` y logs Pino con redacción;
  - Helmet y freno de ráfagas;
  - errores `{ code, message, requestId }` sin trazas;
  - `GET /api/health` liviano.
- **Identidad (§8):**
  - registro con respuesta idéntica exista o no el correo;
  - verificación por correo y reenvío;
  - login, logout y "cerrar todas las sesiones";
  - recuperación y restablecimiento;
  - perfil (nombre, teléfono, idioma) y cambio de contraseña.
- **Sesiones opacas** con hash, cookie `__Host-` en producción, vencimiento por rol, rotación y revocación (§8.2).
- **CSRF** con `Origin`/`Sec-Fetch-Site` y token sincronizador, también para invitados (§8.3).
- **Límites persistentes en PostgreSQL** (§8.4): por IP, demora y bloqueo temporal de cuenta+IP, y umbral global.
- **Turnstile condicional validado en el servidor** (D8): falla cerrada y proveedor falso para desarrollo y CI. Validación V7 documentada en `SECURITY.md`.
- **Contraseñas** Argon2id (parámetros de OWASP) y rechazo de las 10.000 más comunes (§8.7).
- **Correo (§8.5, D6):**
  - outbox en la misma transacción, con reintentos exponenciales y estados SENT/FAILED;
  - Mailpit en desarrollo y Resend preparado;
  - plantillas MJML compiladas en es-CR y en (ADR 0004).
- **RBAC** (`requireRole`, `requireVerifiedEmail`) y cambio de roles con **AuditLog en la misma transacción**, con lista blanca y correo enmascarado (§8.6). Script del propietario `users:set-role`.
- **Web:**
  - pantallas de la cuenta en es-CR y en: ingresar, registro, verificar, recuperar, restablecer y perfil;
  - React Hook Form + Zod con los contratos de `shared` y TanStack Query;
  - resumen de errores enfocable;
  - proxy `/api` en desarrollo.
- **Pruebas:**
  - unitarias;
  - integración con Supertest y PostgreSQL real, con reloj simulado;
  - E2E de identidad con Mailpit y axe;
  - job **Identidad** en CI.
- **Documentos:** `SECURITY.md`, ADR 0004, `docs/m3/VALIDACIONES_M3.md`, y actualizaciones de las variables de entorno, README y TESTING.

### Agregado — M3 · Correcciones finales

- El idioma guardado en el perfil se aplica al iniciar sesión, y guardar otro idioma cambia la página en el acto. Regla de prioridad en `docs/I18N.md`.
- `resolveLocale` en `@marea-baja/shared`: una preferencia ausente o inválida se lee como es-CR.
- Pruebas de idioma:
  - unitarias;
  - integración (registro es y en, persistencia, sin preferencia, valor inválido);
  - E2E en escritorio y a 375 px.
- Script solo para E2E `e2e-user.ts`: crea cuentas verificadas en `<base>_e2e`, porque el límite real de 5 registros por hora por IP no deja crear más desde el navegador de pruebas.
- Documentadas las decisiones del propietario:
  - direcciones en M5;
  - prueba real de Resend y de Turnstile en M10;
  - respuesta genérica para correos ya registrados.
- También quedaron documentados el riesgo de los límites por ventanas y la revisión de dependencias (ADR 0004).

### Cambiado — M3

- `TextField` (M1) acepta `ref` (React 19) y `hint`/`error` explícitamente indefinidos, sin cambios visuales.
- La prueba de la semilla "no crea usuarios" ignora las cuentas `@example.com` que crean las pruebas de identidad en la base de prueba compartida.

### Agregado — M2 · Datos

- Prisma 7.10.1 (versión estable) con `@prisma/adapter-pg`, configuración en `apps/api/prisma.config.ts` y cliente generado sin versionar (ADR 0003).
- Esquema completo de la propuesta §6: 42 modelos y 18 enumeraciones. Incluye identidad, catálogo con tablas de traducción (D2), `User.locale` y `emailVerifiedAt` (D2, D3), configuración, impuestos, zonas, carrito, pedidos con copias históricas, pagos, procesador simulado, idempotencia, correo y AuditLog.
- Migraciones:
  - la inicial, generada por Prisma;
  - una con 33 restricciones CHECK (entre ellas la regla C5 de 20 unidades por línea interna);
  - el índice único `lower(email)`;
  - el trigger que hace el AuditLog de solo inserción;
  - los permisos del rol `marea_app_rw`.
- Roles separados: la API usa `DATABASE_URL` con un rol sin permisos de esquema ni de edición del AuditLog; la CLI usa `MIGRATION_DATABASE_URL` (propietario). Script `db:app-role`.
- Semilla idempotente:
  - carta nikkei bilingüe ajustada a las fotos aprobadas, con 7 categorías, 17 platos y 36 opciones;
  - valores fiscales de D5 (IVA 13 % incluido, servicio 10 % inactivo);
  - configuración, horarios, zonas, roles y pesca del día.
- Pruebas:
  - 71 contra PostgreSQL real (`npm run test:db`);
  - 14 unitarias de los datos semilla;
  - comprobación de diferencias entre esquema y migraciones (`db:drift`);
  - job **Base de datos** en CI.
- Documentos: `DATABASE.md`, ADR 0003, `docs/m2/CARTA_SEMILLA.md` y variables de entorno actualizadas.
- Carta semilla aprobada por el propietario (13/11/2026), después de su revisión:
  - categorías en inglés `Raw dishes` y `Grilled dishes`;
  - 7 ajustes de descripciones;
  - "Sin gluten" retirado de 6 platos sin receta que lo respalde, y "Picante" del pulpo anticuchero.

### Agregado — M1 · Sistema de diseño

- `apps/web`: React 19.3, React Router 7.18 (modo framework, `ssr: false`), Vite 8, Tailwind CSS 4.
- Tokens de marca y tokens semánticos de tema único (D1, D11). Escala tipográfica, movimiento y foco.
- Fuentes autoalojadas: Shippori Mincho B1 y Zen Kaku Gothic New (subconjuntos latinos) y Noto Sans solo para ₡ (ADR 0002, decisión del propietario).
- Sello 引潮 como SVG puro, extraído de los contornos de la fuente (sin cargar la fuente japonesa).
- Componentes base: botón, campo, resumen de errores, grupo de opciones, selector de cantidad (sin tope de 20, regla C5), precio, línea de carta, etiqueta, esqueleto, selector de idioma, aviso de demo y enlace para saltar al contenido.
- Página interna `/_design` (es-CR y en, `noindex`) con todos los estados.
- i18n con i18next (ADR 0001): mensajes es-CR y en, claves tipadas, prueba de paridad y regla de lint contra textos literales.
- `formatMoney` en `@marea-baja/shared` (CLDR por idioma).
- Pruebas: Vitest (contraste, glifos por `cmap`, formato, mensajes y rutas) y Playwright con axe-core (WCAG 2.2 AA, teclado, idiomas, 4 anchos, movimiento reducido).
- Skill Web Design Guidelines instalada (D12) y documentada en `TESTING.md`.
- 19 fotografías con licencia verificada, aprobadas una por una por el propietario (D13); la 13 se descartó y no tiene reemplazo.
- Prueba con NVDA 2026.3 en Edge: 20 de 20 pasos aprobados. Se corrigió la lectura del plato agotado, cuyo precio y estado se leían pegados.
- Documentos: `TESTING.md`, `CREDITS.md`, `docs/I18N.md`, ADR 0001 y 0002, validaciones de M1, prueba con NVDA y revisión documental del sello (la revisión nativa sigue pendiente).

### Agregado — M0 · Fundaciones

- Monorepo con npm workspaces: `apps/api` y `packages/shared`.
- TypeScript 6 en modo estricto (`tsconfig.base.json`).
- ESLint 10 con `typescript-eslint` (reglas estrictas con información de tipos), Prettier y Vitest.
- Validación de variables de entorno de la API con Zod (`NODE_ENV`, `DATABASE_URL`) y comando `env:check`.
- Lista de idiomas soportados en `@marea-baja/shared`: `es-CR` (predeterminado) y `en` (decisión D2).
- Docker Compose con PostgreSQL 17.11 y Mailpit 1.32.0, solo en 127.0.0.1.
- Workflow de CI base en GitHub Actions.
- Documentación de planificación (Fase 1, v3), README y variables de entorno.
