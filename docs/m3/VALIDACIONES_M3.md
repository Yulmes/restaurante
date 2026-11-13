# Validaciones de M3 · Identidad

> Fecha: 13/11/2026. Son resultados de ejecutar los comandos, no estimaciones. Entorno: PostgreSQL 17.11 y Mailpit 1.32 en Docker, Node 24.15, Windows 10, Chromium de Playwright 1.64. Comandos en [TESTING.md](../../TESTING.md).

## Alcance vigente (propuesta §12)

> **M3 · Identidad:** registro, verificación, sesiones, CSRF, rate limiting, Turnstile condicional validado en el backend (D8), recuperación, perfil (con idioma), RBAC; plantillas de correo en es-CR y en (D2); prueba de la integración con Resend sin dominio (D6). Evidencia de cierre: integración + E2E escenario 1 (parte de auth).

## Evidencia ejecutada

| Comprobación | Comando | Resultado |
|---|---|---|
| Formato, lint, tipos y unitarias | `npm run check` | ✅ 100 / 100 (62 anteriores + 38 nuevas) |
| Integración con PostgreSQL real (y las pruebas de M2) | `npm run test:db` | ✅ 119 / 119 (71 de M2 + 48 de M3) |
| Esquema y migraciones | `npm run db:drift -w @marea-baja/api` | ✅ Sin diferencias. **M3 no agrega migraciones** |
| E2E de identidad (escenario 1, parte de auth) | `npm run test:e2e:auth -w @marea-baja/web` | ✅ 6 / 6 |
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
| **Prueba real con Resend** (D6) | Requiere la cuenta y la clave de Resend del propietario (D14, C9). `ResendProvider` está implementado y probado con un `fetch` simulado |
| `siteverify` real con las claves de prueba de Cloudflare | Es una llamada a un servicio externo. Se validaron la documentación (V7) y la falla cerrada con `fetch` simulado |
| CSP de la web, secreto de origen e IP detrás del Worker | Se configuran con el despliegue (M10) |
| Cookies `__Host-`/`Secure` en un entorno HTTPS real | Verificadas en integración con configuración de producción. La prueba post-deploy es de M10 |
| WebKit móvil en Playwright | La CI de M1 y M3 usa Chromium. §11 pide también WebKit móvil |
| CI de GitHub para M3 | Requiere push (no autorizado) |
