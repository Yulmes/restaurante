# Validaciones de M3 · Identidad

> Fecha: 13/11/2026. Son resultados de ejecutar los comandos, no estimaciones. Entorno: PostgreSQL 17.11 y Mailpit 1.32 en Docker, Node 24.15, Windows 10, Chromium de Playwright 1.64. Comandos en [TESTING.md](../../TESTING.md).

## Alcance vigente (propuesta §12)

> **M3 · Identidad:** registro, verificación, sesiones, CSRF, rate limiting, Turnstile condicional validado en el backend (D8), recuperación, perfil (con idioma), RBAC; plantillas de correo en es-CR y en (D2); prueba de la integración con Resend sin dominio (D6). Evidencia de cierre: integración + E2E escenario 1 (parte de auth).

## Evidencia ejecutada

| Comprobación | Comando | Resultado |
|---|---|---|
| Formato, lint, tipos y unitarias | `npm run check` | ✅ 105 / 105 (62 anteriores + 43 de M3) |
| Integración con PostgreSQL real (y las pruebas de M2) | `npm run test:db` | ✅ 123 / 123 (71 de M2 + 52 de M3) |
| Esquema y migraciones | `npm run db:drift -w @marea-baja/api` | ✅ Sin diferencias. **M3 no agrega migraciones** |
| E2E de identidad (escenario 1, parte de auth, e idioma de la cuenta) | `npm run test:e2e:auth -w @marea-baja/web` | ✅ 14 / 14 (escritorio y 375 px) |
| Regresión de la web de M1 | `npm run test:e2e -w @marea-baja/web` | ✅ 41 pasan y 1 se omite (capturas), igual que en M1 |
| Build de producción de la web | `npm run build -w @marea-baja/web` | ✅ |
| Variables de entorno con los valores de ejemplo | `npm run env:check` | ✅ |
| Dependencias de producción | `npm audit --omit=dev` | ✅ 0 vulnerabilidades |
| Dependencias de desarrollo | `npm audit` | ⚠️ 42 moderadas, de dos avisos: `minimatch` (cadena de ESLint, aceptado en M0) y `glob` (nuevo, vía `mjml`, solo en desarrollo; ADR 0004) |

## Verificación manual en el navegador (13/11/2026)

Con la API (`npm run start -w @marea-baja/api`) y la web (`npm run dev -w @marea-baja/web`) sobre la base de desarrollo:

1. Enviar el registro vacío. El resumen de errores **recibe el foco** y cada enlace nombra su campo ("Nombre: Completá este dato."). Los campos quedan con `aria-invalid` y `aria-describedby`.
   - **Problema encontrado y corregido:** al principio, el foco iba al primer campo y los enlaces no nombraban el campo.
2. Registro, y la pantalla "Revisá tu correo".
3. Correo en Mailpit:
   - asunto "Confirmá tu correo · Marea Baja";
   - wordmark, paleta Tinta/Espuma, botón, enlace alternativo y pie de demostración;
   - compatibilidad HTML según Mailpit: 84 % soportado, 11,6 % parcial y 4,4 % no soportado.
4. El enlace lleva a "Correo confirmado", y el token sale de la barra de direcciones.
5. Login con una contraseña incorrecta muestra un mensaje genérico. Con la correcta, lleva al perfil ("Correo confirmado").
6. En el perfil se guardan el teléfono y el idioma English.
7. `/en/account` a 375 px:
   - textos en inglés y `lang="en"`;
   - `noindex`;
   - sin scroll horizontal.
8. "Sign out" lleva a `/en/account/sign-in`, y volver a `/en/account` redirige a ingresar.
   - **Problema encontrado y corregido:** se quitó la ayuda "También se usa al iniciar sesión" del idioma, porque prometía un comportamiento que M3 no implementa.

## Requisitos y dónde se verifican

| Requisito | Implementación | Verificación |
|---|---|---|
| Registro (§8, D2) | `POST /api/auth/register`: idioma de la página, rol CUSTOMER, Argon2id, misma respuesta exista o no la cuenta | Integración y E2E |
| Verificación (D3) | Enlace de 24 h, un solo uso; reenvío 1/60 s y 5/día; `requireVerifiedEmail` para pagar | Integración y E2E |
| Sesiones (§8.2) | Token opaco con hash, expiración por rol, rotación y revocación | Integración con reloj simulado |
| CSRF (§8.3) | `Origin`/`Sec-Fetch-Site` y token sincronizador (sesión e invitado) | Integración: sin token, otra sesión, otro navegador y `Origin` ajeno → 403 |
| Rate limiting (§8.4) | Tabla de políticas en `SECURITY.md` | Integración: demora, bloqueo de 15 min que no afecta otra IP, escalamiento a 1 h, 30/15 min por IP, 5/h de registro, límites de recuperación |
| Turnstile (D8, V7) | Umbral global, validación en el servidor, falla cerrada | Unitarias (siteverify y falla cerrada), integración (umbral, 403 sin evaluar la contraseña) y E2E (no se carga bajo el umbral; se exige al superarlo) |
| Recuperación (§8.7) | Enlace de 30 min, un solo uso; revoca sesiones | Integración y E2E |
| Perfil con idioma (D2) | `PATCH /api/account/profile`; los correos salen en `User.locale` | Integración y E2E |
| RBAC (§8.7) | `requireRole`, `requireVerifiedEmail`; cambio de roles con rotación | Matriz de roles en integración |
| AuditLog transaccional (§8.6) | `recordAudit(tx, …)`, lista blanca y correo enmascarado | Integración: entrada correcta, rollback si falla la auditoría o el cambio, entrada no editable |
| Plantillas es-CR y en (D2, §8.5) | MJML compilado (ADR 0004) | Unitarias y E2E (Mailpit en los dos idiomas) |
| Outbox (§8.5) | Misma transacción, reintentos 1-2-4-8 min, FAILED al 5.º intento | Integración |
| Accesibilidad (D1) | Pantallas de la cuenta con el sistema de M1 | axe: 0 serias o críticas en 10 pantallas (es y en), en un estado de error y en el perfil |

## Lo que no se verificó ejecutando

| Tema | Motivo |
|---|---|
| **Prueba real con Resend** (D6) | **Pospuesta a M10** (decisión del propietario, 13/11/2026; D6, D14). `ResendProvider` está implementado y probado solo con un `fetch` simulado. **No está verificada** |
| `siteverify` real con las claves de Cloudflare | **Pospuesta a M10** (decisión del propietario, 13/11/2026). Se validaron la documentación (V7) y la falla cerrada con `fetch` simulado. **No está verificada** |
| CSP de la web, secreto de origen e IP detrás del Worker | Se configuran con el despliegue (M10) |
| Cookies `__Host-`/`Secure` en un entorno HTTPS real | Verificadas en integración con configuración de producción. La prueba post-deploy es de M10 |
| WebKit móvil en Playwright | La CI de M1 y M3 usa Chromium. §11 pide también WebKit móvil |
| CI de GitHub para M3 | Requiere push (no autorizado) |

## Correcciones finales (13/11/2026)

### Decisiones del propietario

| Tema | Decisión |
|---|---|
| Direcciones del cliente (R-AUTH-01) | Se implementan en **M5**, con el checkout y el delivery |
| Prueba real de Resend | **Pospuesta a M10**, respetando D6 y D14. No se presenta como verificada |
| Llamada real a Turnstile con las claves de Cloudflare | **Pospuesta a M10**. No se presenta como verificada |
| Registro con un correo ya existente | Conserva la respuesta genérica y **no envía** un correo que permita identificar cuentas |
| Idioma del perfil | Debe aplicarse al iniciar sesión. Implementado; la regla de prioridad está en [docs/I18N.md](../I18N.md) |

### Idioma de la cuenta

- **Al iniciar sesión,** la cuenta se abre en `User.locale` aunque el formulario estuviera en el otro idioma.
- **Al guardar otro idioma en el perfil,** la misma página se abre en ese idioma, con el aviso de guardado.
- **Antes de iniciar sesión,** la selección manual sigue igual que en M1.
- **Con sesión,** ES · EN navega sin cambiar la preferencia.
- **Una preferencia ausente o inválida** se lee como es-CR (`resolveLocale`).
- **Infraestructura:** la de M1 (la URL como fuente del idioma y los mismos archivos de mensajes). No se agregó ninguna traducción nueva.
- **Pruebas:**
  - **unitarias:** `resolveLocale`, usuario con idioma inválido y página de la cuenta según la preferencia;
  - **integración:** registro en es y en, persistencia tras cerrar sesión, cuenta sin preferencia y valor inválido rechazado sin cambiar la preferencia;
  - **E2E en escritorio y a 375 px:** preferencia al iniciar sesión, cambio en los dos sentidos con persistencia, selector manual con sesión, selección manual antes de iniciar sesión e idioma inválido devuelto por la API.
- **Navegador (manual, desarrollo):**
  1. Registro en inglés y correo en inglés.
  2. Login desde `/cuenta/ingresar`, que abre `/en/account`.
  3. A 375 px, cambio a español en el perfil: abre `/cuenta` con "Guardamos tus datos." y sin scroll horizontal.
  4. Cierre de sesión y login desde `/en/account/sign-in`, que abre `/cuenta`.
- **Las E2E de idioma crean sus cuentas con `apps/api/scripts/e2e-user.ts`** (solo contra `<base>_e2e`). El límite real de 5 registros por hora por IP, que no se cambió, ya se consume con los registros por interfaz de `identidad.spec.ts`.

### Cuentas de prueba de la base de desarrollo

| Cuenta | Por qué se identificó con certeza | Resultado |
|---|---|---|
| `ana.smoke@example.com` ("Ana Smoke") | Creada a las 23:05:53 UTC: la prueba de humo con curl de la API (log de la API a las 17:05, hora local). Sin verificar, sin sesiones | Borrada |
| `valeria.m3@example.com` ("Valeria Prueba") | Creada a las 23:22:31 UTC: la verificación manual en el navegador. Verificada, 1 sesión revocada, idioma cambiado a `en` en esa prueba | Borrada |
| `manual.idioma.m3@example.com` ("Idioma Manual") | Creada a las 00:01:44 UTC del 14/11 por la verificación manual del idioma de esta tarea | Borrada |

**Procedimiento:**
- Antes de borrar: eran las únicas cuentas de la base, ninguna tenía pedidos, direcciones, carrito, entradas de auditoría, reembolsos ni roles otorgados a otros, y las otras pruebas usan bases aparte (`_test`, `_e2e`).
- El borrado fue una transacción con el rol de la aplicación, por id y correo, con controles que abortan si algún conteo no coincide.
- En la misma transacción se borraron sus correos del outbox: la clave foránea (`SET NULL`) los habría dejado huérfanos con la dirección en claro.
- Las sesiones, los tokens y los roles se borraron en cascada.
- **Resultado:** 0 usuarios, sesiones, tokens, roles y correos; la carta sigue con 17 platos.
- **Restos:**
  - quedan 3 filas de `RateLimitCounter` con claves de hash (sin correos ni IP en claro, sin relación con usuarios), que la limpieza horaria borra a las 24 h;
  - las copias de los correos en la bandeja local de Mailpit no se tocaron.

### Dependencias

`npm audit --omit=dev`: **0**. `npm audit`: **42 moderadas, todas de desarrollo**, de dos avisos:

| Aviso | Origen | ¿Directa? | Actualización estable compatible | Recomendación |
|---|---|---|---|---|
| `glob` 9.0.0–14.0.1 (GHSA-3g3m-2fjr-6pw4) | `mjml` → `mjml-cli` y `mjml-core` → `js-beautify@2.0.3` → `glob@13.0.7` | No: transitiva de `mjml`, que es directa y de desarrollo | **No.** `mjml` 5.4.1 y `js-beautify` 2.0.3 ya son las últimas y piden `glob ^13`; la corrección es `glob` ≥ 14.0.2 (versión mayor). npm propone bajar a `mjml` 4.14.1 (versión mayor anterior): descartado | Mantener. Revisar cuando `mjml` o `js-beautify` publiquen una versión con `glob` ≥ 14. Exposición baja: solo corre al compilar la plantilla propia |
| `minimatch` 7.0.0–11.0.0 | Cadena de ESLint (aceptada en M0) y la misma cadena de `glob` | No | No sin cambiar versiones mayores | Mantener, como en M0. No se fuerza |

Desglose de los 42 paquetes: 31 de la cadena de MJML (sus componentes), 9 de la cadena de ESLint, más `glob` y `minimatch`. Detalle en el [ADR 0004](../adr/0004-plantillas-de-correo-mjml.md).

### Riesgo técnico registrado

**Límites por ventanas:** la aproximación deslizante de §8.4 puede contar de menos los intentos repartidos entre dos ventanas. Se conserva el algoritmo aprobado y queda para revisar en M9. Detalle en [SECURITY.md](../../SECURITY.md) y en la auditoría (sección 3).

