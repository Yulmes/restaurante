# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).

## [Sin publicar]

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
