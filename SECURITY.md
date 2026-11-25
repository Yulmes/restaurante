# Seguridad

Modelo de seguridad de identidad implementado en **M3** (propuesta §8). Lo que llega en otros hitos está marcado.

> Marea Baja es una **demostración**. Si encontrás un problema de seguridad, no lo publiques en un issue: escribí al propietario del repositorio.

## Sesiones (§8.2)

| Aspecto | Implementación |
|---|---|
| Token | 32 bytes aleatorios. En la base solo se guarda `SHA-256(token)` |
| Cookie | Producción: `__Host-mb_session`, `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, sin `Domain`. Desarrollo: `mb_session` sin `Secure` |
| Vencimiento | Clientes: 7 días de inactividad y 30 días absolutos. Staff y admin: 2 h y 12 h |
| Rotación | Al iniciar sesión (sesión nueva), al verificar el correo, al cambiar la contraseña o el rol, y cada 24 h de uso. El token anterior deja de valer |
| Revocación | Cerrar sesión, "cerrar todas las sesiones" y automática al restablecer o cambiar la contraseña (en el cambio, se conserva la sesión actual rotada) |
| Usuario bloqueado | Su sesión deja de valer en la siguiente petición. El bloqueo desde el admin llega en M8 |

`lastSeenAt` se actualiza como mucho una vez por minuto, para no escribir en cada petición.

## CSRF (§8.3)

1. Cookies con `SameSite=Lax`.
2. En todo método que modifica datos, `Origin` debe ser igual a `PUBLIC_WEB_URL`. Si falta `Origin`, se exige `Sec-Fetch-Site: same-origin`.
3. Token sincronizador en `X-CSRF-Token`:
   - con sesión, se deriva de `Session.csrfSecret`;
   - sin sesión (registro, login), se liga a una cookie previa `mb_csrf` y a `APP_SECRET`.

`GET /api/auth/csrf` devuelve el token que corresponde. Cualquier fallo → `403 CSRF_FAILED`.

## Límites y bloqueos (§8.4)

Se guardan en PostgreSQL (`RateLimitCounter`), con ventana fija y aproximación deslizante (ventana actual + la fracción que queda de la anterior). Las claves llevan hashes, nunca correos ni IP en claro. Además hay un freno de ráfagas en memoria: 300 peticiones cada 5 min por IP.

| Operación | Límite | Respuesta |
|---|---|---|
| Login, por IP | 30 / 15 min | 429 |
| Login, cuenta+IP | Demora 2ⁿ s desde el 4.º fallo (máx. 60 s, `Retry-After`). 10 fallos → bloqueo de 15 min, luego 1 h y 4 h | 401 con `Retry-After`; 429 durante la demora o el bloqueo |
| Login, cuenta (todas las IP) | Umbral global (por defecto 50 fallos / 60 min) | **No bloquea**: exige Turnstile |
| Registro | 5 / h por IP | 429 |
| Recuperar contraseña | 5 / h por IP; 3 / h por correo | 429 por IP; por correo es silencioso (la respuesta no cambia) |
| Reenviar verificación | 10 / h por IP; 1 / 60 s y 5 / día por cuenta | 429 con el tiempo de espera |
| Cambiar contraseña | 30 / 15 min por IP | 429 |
| Cotizar y editar el carrito (M5) | 240 / 10 min por IP | 429 |
| Fusionar el carrito (M5) | 30 / 10 min por cuenta | 429 |
| Crear pedidos (M5) | 20 / h por cuenta y 60 / h por IP | 429 |
| Direcciones (M5) | 60 / h por cuenta | 429 |

**Parámetros de implementación** (la propuesta no los fija):
- la ventana de fallos de cuenta+IP es de 15 min;
- el escalamiento del bloqueo vuelve al primer nivel tras 24 h sin bloqueos;
- un login exitoso borra los contadores, la demora y el bloqueo de esa cuenta+IP.

**Riesgo técnico registrado: aproximación deslizante.**

- Si los intentos caen repartidos entre dos ventanas, el conteo estimado puede quedar por debajo del real. Por ejemplo, 6 fallos al final de una ventana y 4 al principio de la siguiente pueden contar como 8.
- Es el algoritmo que eligió la propuesta (§8.4), a cambio de una sola escritura por petición, y **se conserva sin cambios**.
- Impacto: un atacante puede hacer algunos intentos más antes de la demora o del bloqueo. Las demás defensas no cambian (demora progresiva, límite por IP y Turnstile global).
- Queda para una revisión posterior (M9, revisión de seguridad completa). Por ejemplo, contar la ventana anterior sin redondear hacia abajo o usar ventanas más cortas.
- La prueba del bloqueo de 10 fallos se alinea al inicio de una ventana para medir el umbral exacto.

Los mensajes de error nunca revelan si un correo tiene cuenta. **El registro con un correo que ya existe** devuelve la misma respuesta genérica y no envía ningún correo que permita identificar cuentas (decisión del propietario, 13/11/2026). El login con un correo inexistente verifica contra un hash ficticio, para igualar el tiempo de respuesta.

## Turnstile condicional (D8)

| Aspecto | Implementación |
|---|---|
| Cuándo | Solo cuando la cuenta superó el umbral global de fallos. Pasa igual con correos inexistentes |
| Cómo | El login fallido devuelve `challengeRequired: true`. Recién entonces la web carga el widget |
| Validación | En el servidor, contra `siteverify`. Si el token falta → `403 CHALLENGE_REQUIRED`; si es inválido o vencido → `403 CHALLENGE_FAILED`. En ambos casos no se evalúa la contraseña |
| Umbral | `RestaurantSettings.turnstileGlobalThreshold` y `turnstileWindowMinutes` (semilla: 50 / 60). Si no existe la fila, se usan `TURNSTILE_GLOBAL_THRESHOLD` y `TURNSTILE_WINDOW_MINUTES`. El ajuste desde el admin, con registro en AuditLog, llega en M8 |
| Si Turnstile no responde (V7) | **Falla cerrada:** el login no avanza, la cuenta no se bloquea y la recuperación de contraseña sigue disponible. La web muestra que la verificación no está disponible |
| Desarrollo y CI | `BOT_CHECK_PROVIDER=fake` acepta solo el token ficticio de las claves de prueba de Cloudflare. En producción, la validación del entorno exige `turnstile` |

**Validación V7** (documentación de Cloudflare, 13/11/2026):
- **Endpoint:** `POST https://challenges.cloudflare.com/turnstile/v0/siteverify`.
- **Tokens:** valen 300 s, son de un solo uso y miden hasta 2048 caracteres.
- **CSP del widget:** `script-src` y `frame-src` `https://challenges.cloudflare.com`, solo en la página de inicio de sesión. Se configura con la CSP de la web en M10.
- **Claves de prueba:** sitekey `1x00000000000000000000AA` (siempre pasa) y secreto `1x0000000000000000000000000000000AA`. Devuelven el token ficticio `XXXX.DUMMY.TOKEN.XXXX`, que las claves de producción rechazan.
- **Pendiente y no verificado:** la llamada real a `siteverify` con las claves de Cloudflare queda **pospuesta a M10** (decisión del propietario, 13/11/2026). En las pruebas automatizadas se usan un proveedor falso y un widget simulado.

## Contraseñas y enlaces (§8.7)

- **Contraseñas:**
  - Argon2id con los parámetros de OWASP (`m=19456`, `t=2`, `p=1`);
  - entre 12 y 128 caracteres, sin reglas de composición;
  - se rechazan las 10.000 más comunes (lista local de `@zxcvbn-ts/language-common`, MIT), sin distinguir mayúsculas.
- **Enlaces de verificación y recuperación:**
  - 32 bytes, guardados como hash;
  - vencen en 24 h y 30 min;
  - son de un solo uso, y emitir uno nuevo invalida los anteriores.
- **El token va en el fragmento** (`#token=…`): no viaja a ningún servidor ni queda en logs o en `Referer`, y la web lo quita de la barra de direcciones al usarlo.
- **En el outbox, el enlace solo vive hasta el envío.** Al quedar `SENT` o `FAILED`, se borra de la fila.

## RBAC (§8.7)

- `requireAuth` → 401, `requireRole(...)` → 403 y `requireVerifiedEmail` → `403 EMAIL_NOT_VERIFIED` (para pagar, M5 y M6).
- La propiedad de cada recurso se comprueba en los servicios y responde 404 (M5): `GET /api/orders/:id` y las direcciones de otra cuenta, inexistentes o con un id mal formado responden igual, sin confirmar que existan.
- **Cambio de roles:** lo hace el script `users:set-role` del propietario; la pantalla de clientes llega en M8. En una sola transacción:
  - reemplaza los roles;
  - marca las sesiones para rotar con la política del nuevo rol;
  - escribe el AuditLog.

## AuditLog (§8.6)

`recordAudit(tx, …)` escribe con el mismo cliente de transacción que el cambio:
- si el cambio falla, la entrada no queda;
- si la entrada falla, el cambio no se confirma.

Cada tipo de entidad tiene una lista blanca de campos. Hashes, tokens y direcciones nunca entran, y los correos se enmascaran (`a***@dominio`). La tabla sigue siendo de solo inserción (trigger y permisos de M2).

## Logs (§8.7)

- Pino, con `requestId` (devuelto en `X-Request-Id`).
- Se redactan cookies, `authorization`, `x-csrf-token`, `x-origin-auth`, `set-cookie`, contraseñas, hashes, tokens y secretos.
- Los correos se enmascaran.
- El registro de cada petición no incluye cuerpo ni query string.
- Hay pruebas que lo verifican: `logger.test.ts` y una de integración.

## Encabezados y errores

- Helmet en la API, sin `X-Powered-By`.
- Los errores son `{ error: { code, message, requestId } }`, sin trazas.
- La CSP de la web (con Turnstile solo en el login) se configura en el Worker o el hosting, en M10.

## Pedido (M5)

- **Montos:** el navegador nunca envía precios, impuestos, envío ni totales; si los manda, se ignoran. La API recalcula todo en la transacción del pedido (ADR 0006).
- **Cambio de precio:** si lo recalculado difiere de la cotización aceptada (`quoteVersion`), `409 PRICE_CHANGED` y no se crea nada.
- **Idempotencia:** `Idempotency-Key` obligatoria; misma clave y otro cuerpo → 422; en curso → 409. Un carrito idéntico en menos de 60 s devuelve el pedido existente.
- **Identidad:** el usuario sale siempre de la sesión. Crear un pedido exige el correo verificado (D3).
- **Horario:** fuera del horario se bloquea, salvo `ORDERS_ALLOW_OUTSIDE_HOURS=true` en la API.
- **`?next=` al iniciar sesión:** solo acepta páginas del pedido del propio sitio (`/pedido…`, `/en/order…`); cualquier otro valor se ignora.
- **Sesión del invitado:** `GET /api/auth/session` responde `{ user: null }` sin error. No expone nada que `/auth/me` no exponga.

## Pagos (M6)

- **Sin datos de tarjeta:** no se piden, no viajan y no se guardan. La tarjeta "DEMO •••• 0000" es una ilustración. El procesador es simulado (`MockGateway`) y no llama a ningún servicio externo.
- **Montos y estados del servidor:** el monto de la autorización sale del pedido en la base, nunca del cuerpo. Los cuerpos son estrictos: un `amountMinor` o cualquier campo extra en `/authorize` → 400. Ningún endpoint recibe un estado de pago.
- **Escenario demo:** lista cerrada (Zod) y solo con `DEMO_PAYMENTS_ENABLED=true`.
- **Idempotencia:** `Idempotency-Key` obligatoria en `/authorize` y `/refunds` (misma clave y otro cuerpo → 422; en curso → 409). Hacia el procesador, cada operación usa una clave determinística: repetirla nunca cobra dos veces.
- **Concurrencia:** el pago se bloquea con `SELECT … FOR UPDATE` en cada cambio. Un solo pago por pedido; mientras está en `PROCESSING`, otro intento → 409. Σ reembolsos ≤ capturado cuenta los reembolsos en curso, y además lo garantiza el `CHECK` de la base.
- **Identidad y propiedad:** el cliente solo paga sus pedidos (ajeno → 404) y con el correo verificado (D3). Capturar y anular: STAFF o ADMIN. Reembolsar: solo ADMIN (`requireRole`).
- **Límites (§8.4):** autorizar, 30 / h por IP y 10 / h por pedido; staff y admin, 30 / 10 min por usuario, con entrada `payment.rate_limited` en el AuditLog al exceder.
- **AuditLog:** `payment.captured`, `payment.voided` y `payment.refunded`, en la misma transacción, con la lista blanca `payment` (código del pedido, estado, método y montos).

## Operación (M7)

- **Estados solo desde el servidor:** el Pase envía el estado de destino y la versión que vio; la API comprueba la transición en la máquina (§7.1) y el rol. Transición inexistente → 409 `ORDER_TRANSITION_NOT_ALLOWED`; existente sin permiso (staff que cancela un confirmado) → 403. Versión vieja → 409 `ORDER_VERSION_CONFLICT`. Cuerpo estricto: ningún monto ni estado de pago.
- **Confirmar, cancelar y reembolsar** pasan por el procesador; el pedido cambia recién con la operación hecha, en la misma transacción. Con una operación de pago en curso, nada avanza (409).
- **RBAC:** el Pase y los cambios de estado, STAFF o ADMIN; cancelar después de confirmar, solo ADMIN. El cliente solo cancela sus pedidos antes de la confirmación (ajeno → 404) y solo ve su historial y su bandeja. La web oculta lo que no corresponde; la protección está en la API.
- **AuditLog:** `order.status_changed`, `order.cancelled` (con motivo obligatorio), `payment.collected` y `order.rate_limited`, en la misma transacción, con la lista blanca `order` (código, estado y versión).
- **Límites:** cambios de estado de staff/admin, 30 / 10 min por usuario (compartido con M6); cancelación del cliente, 10 / h por cuenta.
- **Bandeja de demostración:** nunca devuelve enlaces. Los de un solo uso no salen de la base y se borran al cerrar el correo (también al quedar `DEMO_ONLY`). Los correos de estado no llevan dirección, teléfono ni datos de pago.
- **Datos para el staff:** el Pase muestra el nombre, el teléfono y la dirección de entrega del pedido (necesarios para operar), sin correo ni datos del procesador.

## Admin (M8)

- **RBAC:** todo `/api/admin/*` (salvo el Pase y las operaciones de pago de M6 y M7, que conservan sus reglas) exige ADMIN (D-M8-3). La web oculta las secciones; la protección está en la API.
- **Cuentas:** bloquear marca `blockedAt` y revoca todas las sesiones abiertas en la misma transacción; el login ya rechazaba cuentas bloqueadas. Nadie cambia su propia cuenta (403 `ADMIN_SELF_CHANGE`) y siempre queda un ADMIN activo (409 `LAST_ADMIN`), con un candado de transacción para los cambios simultáneos. Bloqueos y roles llevan motivo.
- **Montos y moneda:** precios, recargos y tarifas en enteros, múltiplos del incremento de la moneda; el cambio de moneda exige que no haya pedidos activos y convierte en una sola transacción. Los pedidos conservan su moneda.
- **Concurrencia:** versión optimista en la configuración (`version`) y en platos y categorías (`updatedAt`): 409 en lugar de pisar un cambio ajeno.
- **AuditLog:** listas blancas `product`, `category`, `optionGroup`, `option`, `catch`, `settings`, `taxRate` y `deliveryZone`; el umbral de Turnstile y el cambio de moneda tienen su propia acción. La UI de auditoría es de solo lectura y muestra los correos enmascarados.
- **Límites:** todos los cambios del admin comparten "reembolsos y cambios de configuración" de §8.4 (30 / 10 min por usuario, la misma clave que M6 y M7), con `<entidad>.rate_limited` en el AuditLog.
- **Textos editables:** se guardan y se muestran como texto plano (React escapa; sin `dangerouslySetInnerHTML`).

## Pendiente en otros hitos

- **Secreto de origen entre el Worker y la API**, y confiar en la IP del cliente solo con ese secreto (R5, R-SEC-09): M10. Hasta entonces la API usa la IP del socket.
- **Pruebas post-deploy** de cookies, CSRF y recuperación: M10.
- **Revisión completa de seguridad:** M9.
