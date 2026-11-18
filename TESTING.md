# Pruebas

Este documento crece con cada hito. Solo describe pruebas que ya existen.

## Comandos

| Comando | Qué corre |
|---|---|
| `npm run check` | Formato, lint (con la regla de textos i18n), tipos y pruebas unitarias |
| `npm run test` | Vitest: pruebas unitarias de todos los paquetes |
| `npm run test:db` | Vitest contra PostgreSQL real (requiere `npm run services:up`). Recrea la base `<base>_test`, aplica migraciones, crea el usuario de la API y carga la semilla antes de correr |
| `npm run test:e2e:auth -w @marea-baja/web` | Playwright de identidad: levanta API, web y una base `<base>_e2e`; usa Mailpit |
| `npm run lighthouse -w @marea-baja/web` | Lighthouse 13.6.0 sobre el build servido con `npm run preview` (HTTP/1.1, referencia histórica): escritorio y móvil, 3 corridas y mediana. `lighthouse-report/h1/summary.json` guarda también cada corrida, con su protocolo y sus conexiones. Procedimiento en `docs/m4/VALIDACIONES_M4.md` |
| `npm run lighthouse:h2 -w @marea-baja/web` | Lo mismo sobre `npm run preview:h2` (HTTP/2 con TLS local, como el CDN; es la referencia local de entrega). Una corrida con alguna respuesta que no sea `h2` queda inválida y el comando falla. Salida en `lighthouse-report/h2/` |
| `npm run cert:dev -w @marea-baja/web` | Crea o muestra el certificado local de `preview:h2` (`-- --renew` lo renueva). Vive fuera del repositorio |
| `npm run test:e2e:catalog -w @marea-baja/web` | Playwright del catálogo y SEO: recrea `<base>_e2e`, levanta la API, hace el build de producción con prerender y lo sirve como el hosting estático |
| `npm run db:drift -w @marea-baja/api` | Falla si el esquema de Prisma y la base migrada difieren |
| `npm run test:e2e -w @marea-baja/web` | Playwright: navegador real contra el servidor de desarrollo y la API (desde M4 la portada lee el catálogo; requiere `npm run db:setup`) |
| `npm run capturas -w @marea-baja/web` (con `CAPTURAS=1`) | Regenera las capturas de evidencia en `docs/evidencias/m1/` |
| `npm run glyphs -w @marea-baja/web` | Informe de glifos por fuente, peso y subconjunto (V3) |

Primera vez con Playwright: `npx playwright install chromium` dentro de `apps/web`.

## Qué cubre M1

| Prueba | Archivo | Validación |
|---|---|---|
| Contraste WCAG de los pares de la paleta | `apps/web/app/design/contrast.test.ts` | D1 / V1 |
| Glifos de las tipografías aprobadas y ₡ por respaldo (lectura de `cmap`); el recorte servido de `Marea Colon` tiene solo U+20A1 y pesa menos de 2 KB | `apps/web/scripts/check-glyphs.test.ts` | V3, M4 |
| Formato de precios CRC/USD por idioma | `packages/shared/src/money/format.test.ts` | V4 |
| Paridad de mensajes es-CR / en | `apps/web/app/i18n/messages.test.ts` | D2 |
| Rutas por idioma | `apps/web/app/i18n/locale.test.ts` | D2 |
| axe-core WCAG 2.2 AA en todas las páginas, también después de interactuar | `apps/web/e2e/a11y.spec.ts` | V1 |
| Teclado: saltar al contenido, foco visible y no tapado, error y deshabilitado accesibles, cantidad sin tope (C5), botón de ancho estable | `apps/web/e2e/keyboard.spec.ts` | §3.10, C5 |
| Idiomas: `lang`, título, selector con `hreflang` y `aria-current`, formato de precios, `noindex` | `apps/web/e2e/i18n.spec.ts` | D2 |
| Responsive en 375, 768, 1024 y 1440 px por idioma; legibilidad de precios; ₡ con fuente de respaldo; movimiento reducido | `apps/web/e2e/responsive.spec.ts` | V5, D1 |

**Límites conocidos:** axe no mide el contraste de texto sobre fotografías ni la calidad del anillo de foco. Eso se revisa a mano con capturas. La prueba con lector de pantalla (NVDA) es manual (ver `docs/m1/VALIDACIONES_M1.md`).

## Skill de auditoría *Web Design Guidelines* (D12)

- **Qué es:** skill de Claude Code publicada por Vercel (`vercel-labs/agent-skills`, skill `web-design-guidelines`, metadato `version: 1.0.0`). Revisa archivos de interfaz contra las [Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines) y descarga las reglas vigentes en cada revisión.
- **Instalación (hecha al inicio de M1, 10/11/2026), a nivel de usuario y solo para Claude Code:**

  ```bash
  npx skills@1.7.6 add vercel-labs/agent-skills --skill web-design-guidelines --agent claude-code --global --yes
  ```

  Queda en `~/.claude/skills/web-design-guidelines/` (fuera del repositorio). Se instaló solo esta skill de las 8 del paquete, con la telemetría del CLI desactivada (`DO_NOT_TRACK=1`, `DISABLE_TELEMETRY=1`).
- **Cuándo se usa:** al cerrar M1 (sistema de diseño) y en M9 (auditoría final de pantallas), siempre sobre los archivos de componentes y rutas.
- **Cómo se evalúan sus hallazgos:** es un **apoyo**. Cada hallazgo se contrasta con el sistema de diseño aprobado (D1) y la propuesta. Si contradice una decisión aprobada (por ejemplo, Title Case frente a la ortografía española), no se aplica y se deja registrado. **Nunca modifica por sí sola la identidad visual.** Los hallazgos de M1 y su resolución están en `docs/m1/VALIDACIONES_M1.md`.

## Qué cubre M2

Cada caso corre en una transacción que se revierte, así las pruebas no dejan datos. Las de restricciones usan el rol propietario; las de permisos, el rol de la aplicación.

| Prueba | Archivo | Validación |
|---|---|---|
| Únicos: correo sin distinguir mayúsculas, slugs, código de pedido, un pago por pedido, idempotencia `(scope, key)`, reembolsos, traducción por idioma, token de sesión | `apps/api/test/restricciones.db.test.ts` | §6.3 |
| Regla C5: 1 y 20 aceptados, 0 y 21 rechazados en `CartItem` y `OrderItem`; un total de 25 guardado como 20 + 5 | `restricciones.db.test.ts` | C5, §7.5 |
| Montos y tasas: negativos rechazados (salvo el ajuste de redondeo), `rateBps` 0–10000, reembolsado ≤ capturado ≤ autorizado, total de línea | `restricciones.db.test.ts` | §6.2, §6.3 |
| Reglas de negocio: sin `DINE_IN` en pedidos, delivery con zona, una sola configuración, horarios, grupos de opciones, promociones, traducciones sin es-CR | `restricciones.db.test.ts` | D4, C10, D2 |
| Índices de §6.3, incluido `lower(email)` | `restricciones.db.test.ts` | §6.3 |
| AuditLog: el rol de la aplicación solo inserta y lee; el trigger rechaza UPDATE, DELETE y TRUNCATE también al propietario | `apps/api/test/auditoria.db.test.ts` | §8.6, R-AUD-01 |
| Alcance del rol de la aplicación: sin cambios de esquema, sin historial de migraciones, sin superusuario | `auditoria.db.test.ts` | ADR 0003 |
| Semilla en la base: conteos, traducciones completas, lectura con Prisma como rol de la aplicación, D5, pesca del día, sin usuarios, idempotencia | `apps/api/test/semilla.db.test.ts` | D2, D5 |
| Datos semilla: textos en los dos idiomas, precios enteros al colón, opciones coherentes, fotos aprobadas con su tamaño real, enums iguales a `@marea-baja/shared` | `apps/api/prisma/seed-data.test.ts` | D2, D5, D13 |

En CI, el job **Base de datos** levanta PostgreSQL, ejecuta `db:setup`, comprueba que no haya diferencias con `db:drift` y corre `test:db`.

## Qué cubre M3

### Unitarias (`npm run test`)

| Prueba | Archivo | Validación |
|---|---|---|
| Variables nuevas, reglas de producción (https, Resend, Turnstile) y valores nunca impresos | `apps/api/src/config/env.test.ts` | §8.7 |
| Redacción de cookies, tokens, contraseñas y secretos; correo enmascarado | `apps/api/src/config/logger.test.ts` | R-SEC-10 |
| Argon2id con parámetros de OWASP, lista de 10.000 contraseñas comunes, demora y escalamiento del bloqueo, política de sesión por rol | `apps/api/src/modules/auth/auth-unit.test.ts` | R-SEC-01, §8.4 |
| Turnstile: parámetros de `siteverify`, falla cerrada sin red o con error, proveedor falso | `apps/api/src/modules/bot-check/bot-check.test.ts` | D8, V7 |
| Plantillas MJML al día, los dos idiomas, escape del HTML; Mailpit y Resend (SENT solo con id) | `apps/api/src/modules/notifications/notifications.test.ts` | §8.5, ADR 0004 |
| Sanitizador del AuditLog: lista blanca, correo enmascarado, sin objetos anidados | `apps/api/src/modules/audit/audit.test.ts` | §8.6 |
| Contratos: correo normalizado, códigos por campo, 12 a 128 caracteres, tokens base64url | `packages/shared/src/auth/schemas.test.ts` | §8.7 |
| Mensajes de la cuenta con las mismas claves en es-CR y en | `apps/web/app/i18n/messages.test.ts` | D2 |
| `resolveLocale` y lectura de un idioma inválido del usuario como es-CR; página de la cuenta según la preferencia | `packages/shared/src/i18n/locales.test.ts`, `apps/web/app/account/links.test.ts` | D2 |

### Integración con PostgreSQL real (`npm run test:db`)

Supertest contra la API completa, con reloj simulado e IP distintas por caso.

| Prueba | Archivo | Validación |
|---|---|---|
| Registro (idioma, rol, Argon2id, outbox en la misma transacción, enlace borrado tras enviar), correo existente sin revelar, validación, 5/h por IP | `apps/api/test/identidad.db.test.ts` | §8, §8.4, §8.5 |
| Verificación de un solo uso, vencida a las 24 h, reenvío con límite y rotación de la sesión | `identidad.db.test.ts` | §8.2, §8.7 |
| Login: cookie y banderas (también `__Host-` y `Secure` en producción), hash del token, mismo error para correo inexistente; logout, cerrar todas, inactividad de 7 días, absoluto de 30 días, rotación cada 24 h, usuario bloqueado | `identidad.db.test.ts` | R-SEC-02, R-SEC-03 |
| Recuperación: respuesta idéntica, correo en el idioma de la cuenta, un solo uso, 30 min, revoca sesiones, límites | `identidad.db.test.ts` | §8.4, §8.7 |
| Perfil y cambio de contraseña (revoca las demás, rota la actual) | `identidad.db.test.ts` | §8.2 |
| Idioma: registro en es y en, cambio desde el perfil que persiste tras cerrar sesión, cuenta sin preferencia (es-CR) y valor inválido rechazado sin cambiar la preferencia | `identidad.db.test.ts` | D2 |
| Errores sin trazas con `requestId`, JSON mal formado, Helmet, health; logs sin datos sensibles | `identidad.db.test.ts` | §8.7 |
| CSRF: sin token, token de otro navegador, token de otra sesión, `Origin` ajeno y `Sec-Fetch-Site` | `apps/api/test/proteccion.db.test.ts` | R-SEC-04 |
| Login: demora desde el 4.º fallo, bloqueo de cuenta+IP de 15 min que no afecta otra IP, escalamiento a 1 h, reinicio tras éxito, 30/15 min por IP | `proteccion.db.test.ts` | R-SEC-05 |
| Turnstile: no aparece bajo el umbral, global entre IP, 403 sin evaluar la contraseña, token válido, correo inexistente, umbral de `RestaurantSettings` y vencimiento de la ventana | `proteccion.db.test.ts` | D8 |
| Matriz RBAC (invitado, cliente sin verificar y verificado, staff, admin) con `EMAIL_NOT_VERIFIED` | `apps/api/test/rbac-auditoria.db.test.ts` | R-SEC-06, D3 |
| Cambio de roles con AuditLog en la misma transacción: entrada enmascarada, rotación con la política de staff, rollback si falla la auditoría o el cambio, entrada no editable | `rbac-auditoria.db.test.ts` | R-AUD-01 |
| Outbox: correo de una transacción revertida no existe; reintentos 1, 2, 4, 8 min y FAILED al 5.º sin el enlace | `rbac-auditoria.db.test.ts` | §8.5 |

### E2E de identidad (`npm run test:e2e:auth -w @marea-baja/web`)

Levanta su propia base (`<base>_e2e`, recreada en cada corrida, umbral de Turnstile 3), la API en el puerto 3100 y la web en el 5174. Requiere `npm run services:up` (usa Mailpit).

| Prueba | Validación |
|---|---|
| Escenario 1, parte de identidad, en es-CR: registro → correo en Mailpit → confirmación (y enlace reutilizado) → login → cookie `HttpOnly` → perfil (teléfono e idioma) → logout → `/cuenta` redirige a ingresar | §11, §12 |
| En inglés: correo y enlaces en inglés, `lang="en"`, el selector de idioma conserva la página | D2 |
| Recuperación de punta a punta: la contraseña vieja deja de valer | §8.7 |
| Turnstile: sin script ni widget bajo el umbral; al superarlo aparece; sin resolverlo no entra; resuelto, entra. El script de Cloudflare se reemplaza (sin llamadas externas) | D8 |
| El resumen de errores recibe el foco y cada enlace nombra y enfoca su campo | §3.4 |
| axe: 0 violaciones serias o críticas en las 10 pantallas de la cuenta (es y en), en un estado de error y en el perfil con sesión | D1 |
| Idioma (`idioma.spec.ts`, en escritorio y a 375 px): la cuenta se abre en el idioma guardado aunque el login sea en el otro; el cambio desde el perfil se aplica y persiste tras cerrar sesión, en los dos sentidos; con sesión, ES · EN navega sin cambiar la preferencia; la selección manual antes del login sigue igual; un idioma inválido de la API abre es-CR sin errores | D2 |

Las pruebas de idioma crean sus cuentas con `apps/api/scripts/e2e-user.ts` (solo contra `<base>_e2e`): las cinco cuentas de `identidad.spec.ts` ya usan el límite real de 5 registros por hora por IP. El registro por la interfaz se prueba en `identidad.spec.ts`.

## Qué cubre M4

| Prueba | Archivo | Validación |
|---|---|---|
| API pública: orden y precios de la semilla, traducciones y respaldo es-CR marcado, sin inactivos ni datos internos, idioma inválido; precio y disponibilidad en vivo; `catalog-version` en memoria e independiente del idioma; pizarra de hoy y de días anteriores; horario | `apps/api/test/catalogo.db.test.ts` | §4.2, D10, R20 |
| Metadatos por idioma (canónica, `hreflang`, Open Graph), JSON-LD, rutas prerenderizadas, sitemap, robots, `noindex` del fallback, datos en vivo y URL de imágenes | `apps/web/app/site/seo.test.ts` | §4.2, §9.4 |
| Mensajes del sitio con las mismas claves en es-CR y en | `apps/web/app/i18n/messages.test.ts` | D2 |
| E2E sobre el build de producción: HTML crudo de 12 páginas, JSON-LD parseable, sitemap, robots, `catalog-version.json`, datos en vivo al hidratar, pizarra, búsqueda y filtros, carta a 375 px, idioma, menú del celular, teclado, 404 y axe a 1280 y 375 px | `apps/web/e2e/catalogo/catalogo.spec.ts` | §2.4, §3.5, §4.2, D1, D10 |

Las E2E del catálogo cambian el precio de un plato con `apps/api/scripts/e2e-catalog.ts`, que solo corre contra `<base>_e2e`.

