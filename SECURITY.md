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
- La propiedad de cada recurso se comprueba en los servicios y responde 404. Llega con los pedidos (M5).
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

## Pendiente en otros hitos

- **Secreto de origen entre el Worker y la API**, y confiar en la IP del cliente solo con ese secreto (R5, R-SEC-09): M10. Hasta entonces la API usa la IP del socket.
- **Pruebas post-deploy** de cookies, CSRF y recuperación: M10.
- **Revisión completa de seguridad:** M9.
