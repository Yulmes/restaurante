# ADR 0010 · Despliegue: tareas periódicas, proxy e IP del cliente, roles, CSP y operación

> **Estado:** **aceptado** (26/11/2026) e **implementado en local en M10-1** (rama `m10-despliegue`, sin desplegar).
> - Propuesto en M10-0. El propietario aprobó las decisiones D-M10-P1 a P11 el 26/11/2026, con las condiciones que se registran abajo.
> - La implementación de cada decisión está en la sección "Implementación (M10-1)".
> - Sin cuentas, recursos, secretos reales ni despliegue: eso es M10-2 en adelante, con su propia autorización.
>
> **Contexto de decisiones previas:**
> - §5: Worker, proxy, `X-Origin-Auth`, `X-Client-IP` y CORS;
> - §9: servicios, costos y salud;
> - §10: backups (D7);
> - §11: post-deploy;
> - §12: M10 · Despliegue;
> - D6 (sin dominio), D7, D8 (Turnstile), D9 (UptimeRobot 24/7), D10 (rebuild), D14 (cuentas del propietario);
> - ADR 0003 (roles de base de datos), ADR 0005 (prerender), ADR 0007 (reconciliación), ADR 0008 (barridos y outbox);
> - D-M8-2 (el admin no sube fotos);
> - `docs/m10/B0_PREPARACION_M10.md`.

## Contexto

El B0 de M10 encontró tres bloqueos de diseño antes de desplegar:

1. **R-M10-1 · la base nunca se suspende.**
   - En `apps/api/src/server.ts`, la API consulta la base con temporizadores:
     - reconciliación de pagos cada 5 s;
     - barrido de pedidos cada 1 min;
     - outbox cada 30 s;
     - purga de límites cada 1 h.
   - Con UptimeRobot llamando a `/api/health` cada 5 min (D9), Render no duerme la API, así que los temporizadores no paran y Neon nunca llega a sus 5 min de inactividad.
   - A 0,25 CU son ≈ 744 h × 0,25 ≈ 186 CU-h al mes, contra 100 CU-h del plan gratuito.
   - Contradice la suposición de §9.5 ("mantiene despierta la API pero no la base").
2. **R5 / R-SEC-09 · IP del cliente.**
   - La API usa la IP del socket (`trust proxy` en `false`).
   - Detrás del Worker y de Render, todos los visitantes compartirían la IP del proxy, y los límites por IP de §8.4 serían globales.
3. **R-M7-3 · verificación del correo en la demo pública.**
   - Pedir y pagar exige correo verificado (`requireVerifiedEmail`).
   - Sin dominio (D6), Resend solo entrega al correo de la cuenta del propietario.
   - La bandeja demo nunca muestra enlaces (D-M7-4).
   - Un visitante no puede completar una compra.

Además hay que fijar cómo se separan los roles al migrar, el puerto en Render, la CSP con hashes (R-M9-2), la protección de `main`, los backups y el monitoreo.

## Evidencia verificada (26/11/2026)

**En el repositorio:**
- **`server.ts`:** temporizadores de reconciliación (5 s), barrido (1 min), outbox (30 s) y purga (1 h). Se registran solo para el proceso y cada uno tiene una guarda contra ejecuciones simultáneas.
- **`OutboxWorker`:** además de su intervalo, corre después de cada commit que encola correos (`kick()`). El intervalo de 30 s solo atiende reintentos (espera 1, 2, 4, 8… min, máximo 5 intentos).
- **`PaymentService.reconcile`:**
  - resuelve las operaciones `UNKNOWN` y las `REQUESTED` de más de 30 s, de a 20;
  - es segura en paralelo (bloquea el pago y solo cambia operaciones abiertas);
  - **solo se dispara por temporizador**;
  - el escenario "pendiente" de la demo (M6) se resuelve con ella en unos 20 s.
- **Barrido:** cancela los pedidos `PENDING_PAYMENT` vencidos (30 min) y los no confirmados (`ORDER_CONFIRMATION_TIMEOUT_MINUTES`, 20) con transacciones que comprueban el estado.
- **IP y proxy:** `app.ts` fija `trust proxy` en `false` y `request-context.ts` toma `req.socket.remoteAddress`. El logger ya oculta `x-origin-auth`.
- **Bandeja demo** (`notifications/inbox.ts`): exige sesión y muestra solo los correos de la propia cuenta, sin enlaces. El login no exige correo verificado; pedir y pagar sí.
- **Variables:** la API lee `API_PORT` (por defecto 3000), no `PORT`.
- **Cliente de Prisma:** se genera con `prisma generate` (CLI en `devDependencies`); no se versiona. El runtime no importa la CLI.
- **Prerender:** cada HTML del build (57) trae 5 a 9 scripts ejecutables en línea. `streamController` cambia en cada página; además hay 1 `<style>` en línea.
- **Nombres de los checks del CI:** el del job de pedido, pagos, operación y admin **llega truncado** a GitHub ("… en Chromium y ..."), según los check runs de `c856bad`.

**En la documentación oficial de los proveedores (26/11/2026):**
- **Neon Free:**
  - 100 CU-h por proyecto al mes (≈ 400 h a 0,25 CU);
  - autoescalado hasta 2 CU;
  - suspensión a los 5 min sin actividad, **no desactivable**;
  - al agotar las CU-h suspende el cómputo hasta el mes siguiente, con error SQLSTATE 53000;
  - restauración instantánea de hasta 6 h (1 GB de historial);
  - 1 snapshot manual;
  - 5 GB de egreso;
  - 1 GB de almacenamiento.
- **Render Free:**
  - 750 h por workspace;
  - se duerme a los 15 min sin tráfico entrante y despierta en ≈ 1 min;
  - sin cron jobs en Free (desde $1 al mes por servicio);
  - SMTP bloqueado;
  - disco efímero;
  - "no para producción";
  - **`PORT` por defecto 10000 y escucha obligatoria en `0.0.0.0`**;
  - las URL de *deploy hook* son secretas.
- **Cloudflare Workers Free:**
  - 100.000 peticiones al día (error 1027 al pasarse);
  - 10 ms de CPU por petición;
  - assets estáticos gratis e ilimitados, salvo las rutas con `run_worker_first`, que cuentan como invocaciones;
  - **5 Cron Triggers por cuenta**, con 15 min de tiempo real;
  - `_headers` en los assets: **hasta 100 reglas y 2.000 caracteres por línea**, y no se aplica a las respuestas que genera el Worker.
  - **IP del cliente:** Cloudflare pone `CF-Connecting-IP`. `X-Forwarded-For` **conserva** lo que envía el cliente y le agrega IP. En una subpetición del Worker a un origen que no es de Cloudflare (`*.onrender.com`), **el Worker controla** `CF-Connecting-IP` y `x-real-ip`.
- **GitHub:**
  - los *environments* se pueden configurar en repositorios públicos con GitHub Free;
  - admiten revisores obligatorios (sin "Prevent self-review", quien dispara puede aprobar);
  - sus secretos solo llegan a los jobs del *environment* y después de las reglas;
  - los rulesets admiten checks obligatorios en modo estricto (rama al día) y PR sin aprobaciones.
  - **Workflows programados:** mínimo cada 5 min, con retrasos en horas de carga, y desactivados en repositorios públicos después de 60 días sin actividad. Estos tres datos salen del resumen de la página oficial; se confirman en M10-5.
- **Otros proveedores:**
  - Resend Free: 3.000 correos al mes, 100 al día, 3 dominios; sin dominio verificado, solo entrega al correo de la cuenta.
  - Backblaze B2: 10 GB gratis y egreso gratis hasta 3 veces lo almacenado.
  - UptimeRobot Free: 50 monitores cada 5 min, uso comercial permitido.

## Decisiones técnicas (tomadas en M10-0)

### D-M10-1 · Tareas periódicas: temporizadores según la actividad y un disparador externo (R-M10-1, R-M7-1)

**Decisión:**
1. **Temporizadores según la actividad.**
   - Los temporizadores siguen en el proceso, pero en producción **solo corren mientras hay actividad**: alguna petición a `/api/*` en los últimos 5 min.
   - **No cuentan como actividad:**
     - `/api/health` y `/api/health/ready`;
     - `/api/public/catalog-version` (no toca la base y la consulta el rebuild cada 30 min);
     - el endpoint interno.
   - Mientras hay visitantes, el comportamiento es **idéntico al de hoy**: el pago "pendiente" de la demo se resuelve en ≈ 20 s, el outbox reintenta y el barrido corre cada minuto.
2. **Endpoint interno de tareas** (`POST /api/internal/tasks`, nombre a fijar en M10-1).
   - Ejecuta **una vuelta** de las cuatro tareas con las mismas guardas:
     - barrido;
     - reconciliación (varias pasadas, con un límite de tiempo);
     - outbox;
     - purga.
   - Devuelve solo conteos.
   - Exige el secreto de origen (D-M10-2) **y** un secreto propio de tareas, comparados en tiempo constante.
   - Está fuera del límite de ráfagas por IP y tiene uno propio (por ejemplo, 12 por hora).
3. **Disparador:** un **Cron Trigger del Worker de Cloudflare cada 30 min**, que llama al endpoint.
   - Es gratis (5 por cuenta), no depende de que el repositorio tenga actividad y no se retrasa como `schedule` de Actions.
   - **Respaldo:** un workflow de GitHub Actions con `workflow_dispatch` (manual) para el mismo endpoint.
4. **Cómputo de Neon fijo en 0,25 CU** (mínimo = máximo), para acotar el consumo. Se configura en M10-3 y se confirma en la consola.
5. Las tareas ya son idempotentes. M10-1 agrega una prueba de que el endpoint y los temporizadores pueden coincidir sin efectos dobles.

**Consumo estimado:**
- **Disparos sin visitantes:** 48 al día × ≈ 5,5 min despierto ≈ 136 h al mes ≈ 34 CU-h.
- **Tráfico de la demo:** con 2 h de uso al día ≈ 60 h ≈ 15 CU-h.
- **Total ≈ 50 CU-h de 100.** Hay margen para el doble de tráfico.
- Es una **estimación**, no una medición: M10-6 agrega una revisión semanal del consumo en la consola de Neon durante el primer mes.

**Impacto:**
- Sin visitantes, un pedido vencido o sin confirmar se cancela hasta 30 min tarde, y un correo reintentado sale hasta 30 min tarde. Nadie lo nota mientras no hay nadie.
- Cuando alguien vuelve, la primera petición reactiva los temporizadores y se ponen al día en el primer minuto.
- El primer envío de cada correo sigue siendo inmediato (`kick()`).

**Alternativas descartadas:**

| Alternativa | Motivo |
|---|---|
| Subir los intervalos (≥ 5 min) | Neon no se suspende si el intervalo es menor que su tiempo de inactividad, así que el consumo sigue igual. Con intervalos más largos, el pago "pendiente" de la demo tarda minutos (empeora la experiencia de M6) |
| Solo el disparador externo, sin temporizadores | El escenario "pendiente" de la demo tardaría hasta 30 min |
| GitHub Actions `schedule` como disparador principal | Se retrasa en horas de carga, se desactiva después de 60 días sin actividad en un repositorio público y su mínimo es 5 min. Queda solo como respaldo manual |
| Cron job de Render | No existe en Free: cuesta desde $1 al mes, fuera del escenario $0 (§9.3) |
| Plan pago de Neon | Tiene costo y requiere aprobación. Queda como alternativa si la medición del primer mes contradice la estimación |
| Quitar el monitor 24/7 | Cambia D9 (decisión del propietario) y deja el despertar en frío de ≈ 1 min para cada visitante |

**Criterios de aceptación (M10-1, M10-6):**
- con la API sin visitantes, la base se suspende (consola de Neon);
- el endpoint responde 403 sin cualquiera de los dos secretos;
- un disparo perdido no pierde trabajo;
- el endpoint y los temporizadores juntos no duplican efectos (prueba contra PostgreSQL real);
- los logs solo muestran conteos;
- las E2E de pagos y operación siguen en verde.

### D-M10-2 · IP del cliente y secreto de origen (R5, R-SEC-09)

**Flujo:** navegador → Cloudflare (*edge*) → Worker `/api/*` → `https://<servicio>.onrender.com` → API.

**En el Worker:**
1. Borra de la petición entrante `X-Client-IP`, `X-Origin-Auth`, `X-Forwarded-For`, `X-Real-IP` y `CF-Connecting-IP` antes de reenviarla.
2. Pone `X-Client-IP` con el valor que Cloudflare entrega en `CF-Connecting-IP` de la petición entrante.
3. Pone `X-Origin-Auth` con el secreto de origen.
4. Reenvía solo `/api/*`; el resto lo sirven los assets.

**En la API, en producción:**
1. Todo `/api/*` exige un `X-Origin-Auth` válido, comparado en tiempo constante contra una lista de **uno o dos** secretos (para rotar sin cortar el servicio). Si falta, responde 403 sin detalle.
   - **Única excepción:** `/api/health`, que no expone nada (§9.5) y que puede usar el chequeo de salud de Render.
2. La IP del cliente es `X-Client-IP` **solo** con un secreto válido y si `net.isIP()` la acepta. Si no, responde 400.
3. `trust proxy` sigue en `false`: `X-Forwarded-For` nunca se usa, porque el cliente puede escribir en él.
4. `X-Client-IP` se agrega a la lista de redacción de Pino. Las IP ya se guardan con hash en los límites.
5. En desarrollo y en las pruebas, sin secretos configurados, se mantiene la IP del socket, como hoy.

**Límites de confianza:**
- **Lo que llega del cliente al Worker:** no es confiable.
- **Lo que llega del Worker a la API:** es confiable solo con un secreto válido.
- **Una llamada directa a Render:** recibe 403.
- **Si el secreto se filtra:** un atacante podría falsificar la IP y repartir sus intentos entre IP inventadas. Los límites por cuenta+IP y por cuenta (Turnstile) siguen funcionando. Se rota el secreto con la lista de dos.

**Alternativas descartadas:**
- **Confiar en `X-Forwarded-For`:** el cliente puede manipularlo y Cloudflare conserva lo que envía.
- **Confiar en `CF-Connecting-IP` en la API:** en una subpetición a un origen que no es de Cloudflare, el Worker controla ese valor y una petición directa a Render también podría traerlo.
- **`trust proxy` con una lista de IP:** Render y Cloudflare no publican IP de salida estables para este caso.
- **Authenticated Origin Pulls o Cloudflare Tunnel:** no aplican a un origen `*.onrender.com` sin dominio propio (D6).

**Pruebas y criterios (M10-1 y M10-7):**
- **Integración:**
  - sin secreto → 403;
  - secreto incorrecto → 403;
  - secreto válido con `X-Client-IP` inválido → 400;
  - dos IP distintas → límites independientes;
  - rotación con dos secretos;
  - `/api/health` sin secreto → 200;
  - el valor de `X-Client-IP` no aparece en los logs.
- **Post-deploy:**
  - una llamada directa a `*.onrender.com` → 403;
  - una petición al Worker con `X-Client-IP`, `X-Forwarded-For` y `CF-Connecting-IP` falsos → la API ve la IP real (se comprueba con el hash de la IP en un límite de prueba).

### D-M10-3 · Roles y migraciones (ADR 0003)

**Roles por entorno (Neon):**

| Rol | Uso | Dónde vive la credencial |
|---|---|---|
| Propietario (el de Neon) | `prisma migrate deploy`, la semilla, crear roles | Solo en el *environment* `production-migrations` de GitHub |
| `marea_app` (miembro de `marea_app_rw`) | Runtime de la API | Solo en Render (`DATABASE_URL`, `sslmode=require`) |
| `backup_reader` (nuevo, solo `SELECT` y `pg_dump`) | Backup semanal | Solo en el *environment* `backup` de GitHub |

**Decisiones:**
1. **Las migraciones corren desde un workflow de GitHub Actions** con `workflow_dispatch` (manual) y el *environment* `production-migrations`, con el propietario como revisor obligatorio.
   - Pasos: backup previo (D-M10-8) → `prisma migrate status` → `prisma migrate deploy` → `prisma migrate status` → *deploy hook* de Render.
   - Render **nunca** recibe `MIGRATION_DATABASE_URL`, no usa un comando previo al despliegue y no migra solo.
2. **Build de la API en Render:** `npm ci --include=dev` y `npm run typegen -w @marea-baja/api` (genera el cliente; la CLI es de desarrollo). Arranque: `npm run start -w @marea-baja/api`.
3. **Migraciones compatibles hacia atrás:** el código desplegado tiene que funcionar con el esquema anterior y con el nuevo mientras dura el despliegue.
4. **`marea_app` y `backup_reader`** los crea el propietario con la guía de `DEPLOYMENT.md` (M10-3), sin secretos en el repositorio. `db:app-role` sigue siendo solo para local y CI.

**Alternativas descartadas:**
- **Comando previo al despliegue de Render:** pone la URL del propietario en el entorno del servicio y anula la ADR 0003. La documentación verificada no dice que exista en Free.
- **Migrar desde la máquina del propietario:** no deja registro y depende de su entorno.

**Criterios:**
- el entorno de Render no contiene `MIGRATION_DATABASE_URL`;
- el workflow no corre sin la aprobación del revisor;
- después de migrar, `prisma migrate status` sale sin pendientes;
- `db:drift` sigue en CI.

### D-M10-4 · Puerto en Render

En Render, `API_PORT=10000` (el `PORT` por defecto que Render documenta). `app.listen(port)` ya escucha en todas las interfaces. **No se cambia código.** M10-4 lo verifica con `/api/health` y con el log "API lista".

### D-M10-5 · CSP con hashes por página (R-M9-2)

**Decisión:**
1. **Un paso posterior al build** (M10-1) recorre cada HTML del prerender y del fallback de la SPA:
   - calcula el SHA-256 de cada script ejecutable en línea y del `<style>` en línea;
   - inserta como primer hijo de `<head>` un `<meta http-equiv="Content-Security-Policy">` con:
     - `script-src 'self' 'sha256-…'`;
     - `style-src 'self' 'sha256-…'`;
     - `img-src 'self' data:`;
     - `connect-src 'self'`;
     - `font-src 'self'`;
     - `https://challenges.cloudflare.com` en `script-src` y `frame-src` (para el login de la SPA).
   - El JSON-LD (`application/ld+json`) no se ejecuta y no necesita hash.
2. **`_headers` de los assets, con una sola regla `/*`**, agrega lo que un `<meta>` no puede expresar:
   - `Content-Security-Policy: frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'`;
   - `X-Content-Type-Options`, `Referrer-Policy` y `Permissions-Policy`.
   - El navegador aplica todas las políticas a la vez: las dos tienen que permitir cada recurso.
3. **Por qué no hashes por ruta en `_headers`:** 57 páginas, que crecen con cada plato en dos idiomas, chocan con el límite de 100 reglas.
4. **Por qué no un nonce en el Worker:** con `run_worker_first`, cada visita a una página contaría como invocación (límite de 100.000 al día) y obligaría a reescribir cada HTML en el Worker.
5. **Validación en lugar de *Report-Only* en producción:** la variante *Report-Only* no existe en `<meta>`.
   - El CI sirve el build con las mismas cabeceras y corre una E2E de humo (portada, carta, plato, login con Turnstile de prueba, checkout y Pase) que **falla con cualquier `securitypolicyviolation`**.
   - Después del despliegue, la misma prueba corre contra la URL pública (M10-7).
6. **Vuelta atrás:** volver a desplegar el build anterior. Además, el paso de CSP tiene una bandera de build para generar sin el `<meta>` en una emergencia, documentada en `DEPLOYMENT.md`.

**Riesgos:**
- Los hashes cambian en cada build. Por eso el paso se automatiza y nunca se escribe a mano.
- Si una biblioteca agrega `eval` o estilos en línea en tiempo de ejecución, la E2E lo detecta antes de publicar.

### D-M10-6 · Salud

- `/api/health` sigue igual: público, sin base ni datos.
- Se agrega `/api/health/ready` (M10-1): exige el secreto de origen, hace una consulta mínima a la base y responde 200 o 503 sin detalle.
  - Lo usan el workflow de despliegue y la suite post-deploy.
  - **No** lo usa UptimeRobot, porque despertaría la base cada 5 min.

### D-M10-7 · Nombres de los checks del CI

Antes de aplicar la protección de `main` (D-M10-P5), M10-1 acorta el nombre del job `order` a **menos de 100 caracteres** sin cambiar su contenido. Ejemplo: "Pedido, pagos, operación y admin (Chromium y WebKit)". El nombre de un check obligatorio tiene que coincidir exactamente con el que informa GitHub, y hoy llega truncado.

### D-M10-8 · Backups y restauración (D7, §10)

- **Diseño:** el de §10, sin cambios: `pg_dump -Fc` con `backup_reader`, `pg_restore --list`, cifrado `age`, SHA-256 y bucket privado de B2 con una clave de solo escritura.
- **Prueba de restauración:** en un PostgreSQL efímero del runner, en el *environment* `restore-test`, con su propia clave de lectura de B2 y la clave privada.
  - Verifica conteos y claves foráneas (FK), y que `prisma migrate status` no tenga pendientes.
- **Frecuencia:**
  - semanal (domingo, 06:00 UTC), con un workflow `schedule` de GitHub Actions;
  - manual (`workflow_dispatch`);
  - **siempre antes de migrar** (D-M10-3).
- **Retención:** 8 copias semanales con una regla de ciclo de vida del bucket. La base es menor de 1 GB y el volcado comprimido, mucho menor: queda muy por debajo de 10 GB (C2).
- **Objetivos:**
  - **RPO:** 7 días con el backup semanal, o casi 0 si el incidente se detecta dentro de las 6 h de restauración instantánea de Neon Free (verificada).
  - **RTO:** 1 h.
- **Copia mensual local:** con el script documentado en `docs/RECUPERACION_ANTE_INCIDENTES.md` (M10-6).
- **Dependencia:** si Neon quedara suspendido por CU-h, `pg_dump` falla. D-M10-1 lo evita y el aviso de fallo del workflow lo detecta.
- **Criterio de cierre de M10 (§12):** la primera restauración completa en verde.

### D-M10-9 · Monitoreo

- **Monitores de UptimeRobot** (D9):
  1. `GET /api/health` por el Worker, cada 5 min, esperando la palabra `ok`;
  2. `GET /` de los assets, esperando una palabra del titular.
- **Aviso:** a los 2 fallos seguidos, por correo al propietario (el canal exacto depende de V8).
- **GitHub Actions:** aviso por correo de un workflow fallido (backup, restauración, rebuild, migración).
- **Revisión manual semanal durante el primer mes, después mensual:**
  - CU-h y egreso de Neon;
  - horas de Render (R3, C8);
  - invocaciones del Worker;
  - fecha del último backup válido;
  - que los workflows programados sigan activos.
- **Lo que no se monitorea en $0:** métricas internas de la base en tiempo real ni latencias de la API.

### D-M10-10 · Turnstile real

- **M10-1:** sin cambios de código; las pruebas siguen con las claves de prueba de Cloudflare.
- **M10-7 (suite post-deploy):** con las claves reales, se fuerza el umbral con un ajuste temporal del admin (`turnstileGlobalThreshold`) en una cuenta de prueba y se comprueba:
  - sin token → 403 `CHALLENGE_REQUIRED`;
  - token válido → se evalúa la contraseña;
  - token inválido → `CHALLENGE_FAILED`.
- Después se restaura el umbral; el cambio queda en el AuditLog.

## Decisiones del propietario (aprobadas el 26/11/2026)

| ID | Tema | Recomendación | Por qué es tuya | Si no se decide |
|---|---|---|---|---|
| **D-M10-P1** | **R-M7-3: verificación en la demo** | Un botón **"Verificar (demo)"** en la bandeja demo de la propia cuenta, visible solo si su correo de verificación quedó `DEMO_ONLY` y una bandera de servidor de demo está activa. El servidor marca la cuenta como verificada **sin exponer el token** (respeta D-M7-4), con límite por cuenta y registro en el AuditLog. Los correos `SENT` (el del propietario) siguen con el enlace real | Cambia la experiencia de la demo y relaja la verificación a cambio de que el recorrido público funcione | Ningún visitante puede pedir ni pagar: no se puede mostrar el escenario de compra |
| D-M10-P2 | `DEMO_PAYMENTS_ENABLED` en producción | `true`: el selector de escenarios es el centro de M6; no hay dinero ni datos de tarjeta | Comportamiento público de la demo | Solo se puede pagar al recibir o al retirar |
| D-M10-P3 | `ORDERS_ALLOW_OUTSIDE_HOURS` en producción | `true`: un visitante puede probar a cualquier hora; el banner de demo lo explica | Comportamiento público | Fuera del horario del local no se puede pedir |
| D-M10-P4 | Cloudinary | **Posponerlo:** sin cuenta ni `CloudinaryProvider` en M10 (D-M8-2). §12 lo lista entre las cuentas, así que posponerlo reduce el alcance de M10 | Alcance de M10 y una cuenta externa | Hay que crear una cuenta y escribir código que la demo no usa |
| D-M10-P5 | Protección de `main` | Un ruleset sobre `main` con: PR obligatorio (0 aprobaciones); los 7 checks como obligatorios y rama al día (después de D-M10-7); sin force push ni borrado; solo merge commit en el repositorio; el propietario en la lista de bypass. Además, el dependency graph y las alertas de Dependabot, sin PR automáticos | Cambia la configuración de GitHub | Un merge con el CI en rojo sigue siendo posible |
| D-M10-P6 | *Environments* de GitHub | `production-migrations` (revisor: propietario), `backup` y `restore-test`, con sus secretos, al llegar a M10-3 y M10-5 | Configuración de GitHub y secretos | No hay migraciones ni backups seguros |
| D-M10-P7 | Datos iniciales en producción | Aplicar la semilla (carta bilingüe ficticia y configuración) y crear **una** cuenta admin del propietario con `users:set-role`, desde el workflow de migraciones | Datos y cuenta del propietario | La demo arranca vacía o sin admin |
| D-M10-P8 | `EMAIL_DELIVERABLE_TO` | El correo del propietario (el de la cuenta de Resend) | Dato personal | Resend rechazaría los envíos a terceros o todo quedaría `DEMO_ONLY` |
| D-M10-P9 | Workflows programados después de 60 días sin actividad | Aceptarlo como riesgo, con la revisión mensual de D-M10-9: el disparador de tareas no depende de Actions; el rebuild y el backup sí | Aceptar un riesgo | Un backup o un rebuild pueden dejar de correr sin aviso |
| D-M10-P10 | Cuentas (D14) | Orden: Neon → Render → Cloudflare (assets, Worker, Turnstile) → Resend → B2 → UptimeRobot. Leer antes los términos y si piden tarjeta (V6, R15) | Cuentas, términos y datos personales | M10-2 no puede empezar |
| D-M10-P11 | Revisión de 引潮 (V2) | Pedir la revisión nativa con `docs/m1/REVISION_HANKO.md` y registrar la confirmación en `CREDITS.md` | Persona externa | No se puede pasar a producción (D1) |

### Condiciones de la aprobación (26/11/2026)

| Decisión | Condición del propietario |
|---|---|
| P1 | Solo la propia cuenta, solo correos `DEMO_ONLY`, bandera de servidor, límite por cuenta, AuditLog y ningún token expuesto |
| P2 | `true` en la demo pública, sin dinero real |
| P3 | `true` en la demo pública |
| P4 | Pospuesto: sin integrar, contratar ni crear recursos |
| P5 | Revisar las condiciones reales de GitHub antes de aplicarlo y no bloquear el flujo de trabajo |
| P6 | Conceptualmente aprobado; los environments y secretos reales dependen de las cuentas y credenciales |
| P7 | Semilla y mecanismo para la cuenta admin, sin credenciales ni contraseñas en Git |
| P8 | La dirección se pide cuando sea imprescindible; nunca se inventa ni se escribe en el código |
| P9 | Riesgo aceptado, con revisión mensual |
| P10 | Ese orden; sin crear cuentas por el propietario ni comprometer gastos |
| P11 | Pendiente de un hablante nativo; no se reemplaza con una revisión automática |

## Implementación (M10-1, 26/11/2026)

| Decisión | Código | Pruebas | Pendiente (fuera de M10-1) |
|---|---|---|---|
| D-M10-1 Tareas | `modules/tasks/{activity,background,routes}.ts`, `server.ts` (temporizadores según la actividad), `OutboxWorker.drain()`, Cron Trigger en `apps/edge` y `wrangler.jsonc`, respaldo manual `.github/workflows/tasks.yml` | `despliegue.db.test.ts`, `background.test.ts`, `worker.test.ts` | Cron real y suspensión de Neon (POST_DEPLOY 6) |
| D-M10-2 IP y secreto de origen | `middleware/origin.ts`, orden en `app.ts`, redacción en `logger.ts`, proxy en `apps/edge/src/worker.ts` | `despliegue.db.test.ts`, `origin.test.ts`, `worker.test.ts` | Falsificación de `CF-Connecting-IP` contra la URL pública (POST_DEPLOY 1.4) |
| D-M10-3 Roles y migraciones | `.github/workflows/migrate.yml` (environment con revisor, backup previo, status, deploy, status, semilla opcional, ADMIN opcional, deploy hook), `render.yaml` sin URL del propietario, SQL de `marea_app` y `backup_reader` en DEPLOYMENT.md | `backup:selftest` (rol `marea_app_rw` en la restauración) | Crear roles y environments reales (M10-3) |
| D-M10-4 Puerto | `render.yaml` (`API_PORT=10000`) | Arranque en modo producción en el puerto 10000 (VALIDACIONES_M10) | Primer deploy |
| D-M10-5 CSP | `apps/web/scripts/csp.ts` (paso del build), `SECURITY_HEADERS` en `packages/shared`, `_headers`, cabeceras del Worker, `serve-build.ts` con `_headers` | `csp.test.ts`, `e2e/produccion/csp.spec.ts` (57 páginas, SPA, flujos), `csp:check` en CI | CSP contra la URL pública (POST_DEPLOY 4) |
| D-M10-6 Salud | `readyRouter` en `modules/tasks/routes.ts` | `despliegue.db.test.ts`, `background.test.ts` | — |
| D-M10-7 Nombre del check | `ci.yml` ("Pedido, pagos, operación y admin (Chromium y WebKit)") | El CI del PR de M10-1 | Ruleset (D-M10-P5) después del merge |
| D-M10-8 Backups | `ops/backup/` (`backup.sh`, `restore-test.sh`, `selftest.sh`, `local-selftest.sh`), `apps/api/scripts/restore-smoke.ts`, `.github/workflows/backup.yml` | `npm run backup:selftest` (local y en CI) | B2 real y **primera restauración real** (criterio de cierre de M10) |
| D-M10-9 Monitoreo | `docs/m10/OPERACION.md` | — | Cuenta y monitores de UptimeRobot |
| D-M10-10 Turnstile | Sin cambios de código | `bot-check.test.ts` (vencido o reusado, respuestas raras, `remoteip`) | Claves reales (POST_DEPLOY 3) |
| P1 Verificación demo | `AuthService.demoVerifyEmail`, `POST /api/auth/demo-verify`, `demoVerifiable` en la bandeja, botón en `cuenta/bandeja.tsx` (es-CR y en) | `despliegue.db.test.ts` | — |
| P2, P3 Banderas de la demo | `render.yaml` | Suites de pagos y pedido (sin cambios) | — |
| P7 Datos iniciales | `migrate.yml` (`seed`, `grant_admin` con `ADMIN_EMAIL` como secreto) | — | Correrlo en M10-4 |

**Hallazgos de la implementación** (registrados aquí porque amplían decisiones tomadas):

1. **Zod 4 y la CSP:**
   - **El problema:** Zod decide si compila validadores con `new Function` al **definir** cada esquema de objeto. Bajo la CSP estricta, el navegador reporta esa prueba como violación de `script-src` (`eval`) aunque Zod la atrape. Lo detectó la E2E de CSP.
   - **Por qué no se configuró desde la app:** `z.config({ jitless: true })` llega tarde, porque el bundle evalúa Zod y los esquemas antes que cualquier módulo de la app.
   - **La solución:** el paso de CSP inserta un script clásico al principio de `<head>`, con su hash, que fija `globalThis.__zod_globalConfig = { jitless: true }` antes de cargar cualquier módulo. La validación es la misma, sin compilar. En desarrollo no hay CSP y no se inserta.
2. **Fuentes:** Vite incrusta como `data:` los subconjuntos tipográficos pequeños (M1). La política usa `font-src 'self' data:`. Los datos de fuente no ejecutan código.
3. **Build contra la API protegida:**
   - **El problema:** con el secreto de origen, el prerender ya no puede leer la API de Render sin él.
   - **La solución:** `CATALOG_ORIGIN_SECRET` (solo en el proceso de Node del build; nunca en el bundle) permite el primer build antes de que exista el Worker.
4. **Despliegue de la web:**
   - **Secretos del repositorio:** `.github/workflows/deploy-web.yml` usa secretos **del repositorio** (`ORIGIN_SECRET`, `CLOUDFLARE_API_TOKEN`) para que el rebuild de D10 corra solo cada 30 min. Un environment con revisor lo frenaría en cada ejecución. **Pendiente de confirmar por el propietario:** la alternativa es un environment `production-web` sin revisor, que esta ADR no incluía.
   - **Wrangler:** se usa con `npx wrangler@4.160.1`, versión exacta publicada hace más de dos semanas, sin sumarlo a las dependencias del repositorio. La contrapartida es que no queda en `package-lock.json`.
5. **Workflows inactivos hasta la configuración:** los cuatro workflows nuevos exigen la variable de repositorio `DEPLOY_ENABLED=true`, para no fallar en `main` antes de que existan las cuentas.

## Consecuencias

- **R-M10-1 queda resuelto en el diseño:** se mantiene el escenario $0 y la experiencia actual de la demo. Hay que medir el consumo durante el primer mes; si supera el 80 % de las CU-h, se revisa (plan pago de Neon u otro intervalo, con aprobación).
- **R5 / R-SEC-09 queda resuelto en el diseño:** los límites por IP vuelven a ser por visitante y Render deja de responder directo.
- **R-M7-3: resuelto en el código con D-M10-P1** (M10-1). Se confirma en la URL pública (POST_DEPLOY 5).
- **R-M7-1 queda resuelto en el diseño.**
- **R-M6-3 (reconciliación sin tope): sigue abierto.** M10-1 no lo cambió: una espera creciente necesitaba registrar los intentos y eso exigía una migración. Lo acotan las 5 pasadas por vuelta del endpoint y la ventana de actividad.
- **R-M9-2 queda resuelto en el diseño (D-M10-5).**
- **Código de M10-1:**
  - el middleware de origen e IP;
  - el control de actividad;
  - el endpoint interno;
  - `/api/health/ready`;
  - el paso de CSP y su E2E;
  - el nombre del job;
  - el Worker (`apps/edge`);
  - según D-M10-P1, la verificación de la demo.
- **Sin dependencias nuevas, salvo** el *tooling* del Worker (Wrangler), que se evalúa en M10-1 con versión fijada y la regla de al menos dos semanas de antigüedad.
- **Documentos nuevos de M10:** `DEPLOYMENT.md` y `docs/RECUPERACION_ANTE_INCIDENTES.md`.

## Costos

Escenario A, $0 (§9.3), sin cambios. El consumo previsto queda dentro de los planes gratuitos:

| Proveedor | Consumo previsto |
|---|---|
| Neon | ≈ 50 de 100 CU-h, < 1 GB de almacenamiento |
| Render | ≈ 744 de 750 h (R3: la API tiene que ser el único servicio gratuito del workspace) |
| Cloudflare | Assets gratis; ≈ 288 invocaciones al día de UptimeRobot + el tráfico de la API + 48 del Cron Trigger, contra 100.000 al día |
| Resend | Solo correos al propietario, muy por debajo de 100 al día |
| B2 | Muy por debajo de 10 GB |
| UptimeRobot | 2 de 50 monitores |

Ningún costo se compromete sin la aprobación del propietario.

## Riesgos que quedan

- **R3:** el margen de Render es de ≈ 6 h al mes. Queda en seguimiento.
- **Estimación de Neon (D-M10-1):** hay que validarla con la medición.
- **R-M9-1, R-M5-1, R-M5-2, R-M8-4 y R-M7-2 / R-M8-1 / R-M7-4 / R-M8-2:** sin cambios.
- **Pendientes humanos:** NVDA, Safari de iOS real (conviene contra la URL pública, en M10-7) y V2.
- **Workflows programados:** D-M10-P9.

## Validación de esta ADR

Esta ADR es solo documentación: no hay código que probar. Cada decisión técnica tiene sus criterios de aceptación y sus pruebas en la subfase donde se implementa. Los datos de los proveedores se leyeron en sus páginas oficiales el 26/11/2026 y se vuelven a verificar al crear cada cuenta (V6).
