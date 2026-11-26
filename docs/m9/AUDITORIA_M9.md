# Auditoría de M9 · Calidad (implementación local)

> **Estado (25/11/2026):** **auditoría y correcciones locales en la rama `m9-calidad`, pendientes de la revisión del propietario.** M9 **no está integrado ni cerrado**: sin push, sin PR, sin CI remoto y sin despliegue. Iniciado con la autorización de Nivel 2 del propietario (25/11/2026), sobre `main` en `d3d1a27` (M8 cerrado, B0 posterior a M8 completado).
>
> Este documento es el **informe de auditoría** que §12 fija como evidencia de M9. Las pruebas que requieren al propietario (NVDA y Safari de iOS real) están en `PRUEBAS_HUMANAS_M9.md` y siguen **pendientes**.

## Alcance oficial

La propuesta (§12) define M9 como "Accesibilidad (axe en pantallas reales y en ambos idiomas, D1), rendimiento, revisión de seguridad completa, auditoría de apoyo con Web Design Guidelines (D12), correcciones". Además, M1–M8 dejaron para M9:

- capturas a 768 y 1024 px (M4);
- las fallas heredadas de WebKit en M1–M4 (R-M5-2);
- la revisión de la aproximación deslizante de los límites (M3);
- NVDA sobre las pantallas reales (M1);
- Safari de iOS real (M5, M6);
- el *finish gate* pendiente (R-M8-4).

## Método y herramientas

| Área | Herramienta | Dónde |
|---|---|---|
| Accesibilidad, desbordamiento, foco, movimiento reducido, formato de fechas por idioma, capturas | Suite Playwright nueva `npm run test:calidad -w @marea-baja/web` (axe WCAG 2.2 AA) sobre **31 pantallas reales × 2 idiomas × 4 anchos** | `apps/web/e2e/calidad/calidad.spec.ts`, `playwright.calidad.config.ts` |
| *Finish gate* | Revisión de las 248 capturas reales con el criterio del agente `design-ui-finish-gate-reviewer` y los contratos de §2.4 | Capturas en `apps/web/calidad-report/` (regenerables); evidencia elegida en `docs/evidencias/m9/` |
| Pautas de interfaz | Skill *Web Design Guidelines* (D12), con las reglas vigentes descargadas el 25/11/2026 | Componentes y rutas de la web |
| WebKit | Las suites de M1–M4 con solo el motor WebKit (perfil de iPhone 13), con configuraciones temporales no versionadas, como en M5 | — |
| Límites (M3) | Pruebas de diagnóstico contra PostgreSQL; desde la corrección de R-M9-1, pruebas de la garantía corregida | `apps/api/test/limites.db.test.ts` |
| Rendimiento | Lighthouse sobre el build de producción en HTTP/2 (procedimiento de M4); revisión de consultas e índices | `npm run lighthouse:h2 -w @marea-baja/web` |
| Seguridad | Revisión del código (rutas, sesiones, CSRF, SQL, errores, redirecciones, XSS, cabeceras) y `npm audit` | — |

## Resultados por área

### Accesibilidad (D1, R-A11Y-01)

- **axe WCAG 2.2 AA sobre 31 pantallas reales en es-CR y en**, a 375 y 1280 px. Visitante, cliente con un pedido real y admin:
  - públicas, de cuenta y del pedido: portada, carta, hoja de producto abierta, categoría, plato, Nosotros, Visítanos, ingreso (con y sin errores), registro, recuperar, pedido vacío, perfil, carrito, checkout, confirmación, historial, seguimiento y bandeja;
  - del admin: resumen, Pase, pedidos y su detalle, carta, editor y alta de plato, pesca del día, clientes y su detalle, configuración y auditoría.
  - **Resultado: 0 violaciones de cualquier nivel**, no solo serias o críticas.
- **`/_design` en WebKit a 390 px:** 1 violación seria (`scrollable-region-focusable`), heredada de R-M5-2. **Corregida** (M9-03).
- **Foco visible y no tapado** en los primeros 25 elementos de la tabulación de cada pantalla, con el criterio de M1 (contorno de al menos 2 px): sin problemas. Los campos de fecha y hora con el foco en su botón nativo se informan aparte: no es un foco perdido (M9-12).
- **Movimiento reducido (R-A11Y-02):** con `prefers-reduced-motion: reduce`, ninguna animación en curso en la portada, la carta ni el seguimiento.
- **Fechas por idioma:** ninguna página en inglés muestra horas con el formato de es-CR (chequeo nuevo, M9-01).
- **Contraste V1:** sin violaciones de contraste en las pantallas reales; axe mide el texto sobre fondos sólidos. Lo que axe no mide (texto sobre fotos y foco sobre fondos oscuros) se revisó en las capturas: el texto nunca va sobre fotos, y la banda Tinta usa el foco `aji` (M1).
- **NVDA:** recorrido preparado (18 pasos), **pendiente del propietario** (`PRUEBAS_HUMANAS_M9.md`).

### Responsive y *finish gate* (R-RESP-01, R-DESIGN-01, R-M8-4)

- **Desbordamiento horizontal:** ninguno en las 31 pantallas × 4 anchos × 2 idiomas. Incluye **768 y 1024 px, pendientes desde M4**.
- **Revisión visual de las capturas reales** con los contratos de §2.4, en los dos idiomas:

| Pantalla | Decisión | Evidencia |
|---|---|---|
| Portada | **PASS** | Lo primero es el titular y el plato de la casa; la pizarra de pesca va enseguida en escritorio. A 375 px queda debajo del plato. Sin hero genérico ni tarjetas de "beneficios" |
| Carta | **PASS** | Línea de carta editorial con nombre y precio por categoría; filtros plegados en el celular; sin grilla de tarjetas |
| Hoja de producto | **PASS** | Panel desde abajo en el celular y lateral en escritorio, con el total en el botón ("Agregar · ₡8 900") |
| Checkout | **PASS** | 3 pasos; resumen lateral desde 1024 px y desplegable en el celular |
| Seguimiento | **PASS** | Marcas sobre la línea de marea, vertical en el celular; sin barra de porcentaje |
| Pase | **PASS** | Columnas por estado con la antigüedad; avance con un clic |
| Admin · Resumen | **PASS** | Lo primero es el trabajo pendiente (§2.4 prohíbe métricas antes) |
| Admin · Carta y editor | **PASS** | Vista previa de la línea de carta en los dos idiomas |
| Admin · Configuración | **HOLD → PASS** | Horario desalineado a 768 px o más. Corregido (M9-02), con captura posterior |
| Admin · fechas en inglés | **HOLD → PASS** | Formato de es-CR en las páginas en inglés. Corregido (M9-01), con captura posterior |
| Admin · Auditoría, pedidos y clientes | **PASS** | Filtros alineados; tablas desplazables dentro de su contenedor |

- **Artefacto descartado:** en las capturas de página completa, la hoja de producto abierta parece superpuesta. Es el `<dialog>` fijo al viewport. La captura del viewport confirma que se ve bien.
- **Límite:** es la revisión de Claude con el criterio del agente `design-ui-finish-gate-reviewer`, no una revisión externa de una persona diseñadora.

### Pautas de interfaz (D12)

**Cumple:**
- sin `outline-none` ni `transition: all`;
- imágenes con `width` y `height` y `fetchpriority` en la principal;
- `text-wrap: balance` en los títulos y `touch-action: manipulation`;
- `autocomplete` en los campos de cuenta;
- formatos con `Intl` y `translate="no"` en los nombres de platos;
- sin bloqueo de zoom.

**Corregido:** `spellCheck={false}` en los correos (M9-04) y `overscroll-behavior: contain` en la hoja de producto (M9-05).

**No aplicado, con motivo:**
- *Title Case:* no corresponde al español ni a los textos aprobados;
- `autoFocus` en el motivo de cancelación: es manejo de foco al abrir el formulario.

**Recomendaciones sin hacer (no son defectos):** filtros del admin en la URL, aviso de cambios sin guardar y `autocomplete="off"` en los campos del admin.

### WebKit (R-M5-2)

Las suites de M1–M4 corridas solo en WebKit (perfil de iPhone 13; **no es Safari de iOS**):

| Suite | M5 (pasan / fallan / omitidas) | M9 | Causa de lo que queda |
|---|---|---|---|
| M1 | 35 / 6 / 1 | 38 / 3 / 1 después de M9-03 | Tab de WebKit no enfoca enlaces por defecto, comportamiento de la plataforma (1); la prueba busca el selector de idioma fuera del menú del celular (2). Una falla intermitente de `i18n.spec` no se repitió |
| Identidad | 12 / 2 | 13 / 1 | `sameSite` informado distinto sobre HTTP local |
| Catálogo | 15 / 4 | 15 / 4 | Supuestos de escritorio (filtros plegados, navegación en el menú) (3) y Tab de WebKit (1) |
| Producción | 8 / 1 | 8 / 1 | Selector de idioma en el menú del celular |

Lo que queda son supuestos de las pruebas o del entorno, no defectos de la aplicación: las pantallas reales pasan axe y no se desbordan. Las suites del pedido, los pagos, la operación y el admin ya corren en WebKit en el CI.

### Seguridad

**Sin hallazgos de severidad alta.** Lo revisado:

- **Autorización:** RBAC en la API (`requireRole`), con los roles leídos de la base en cada petición (degradar o bloquear surte efecto al instante); propiedad e IDOR con 404; el admin solo ADMIN y el Pase STAFF o ADMIN; último admin con candado.
- **Sesiones y CSRF:** cookies `HttpOnly`, `SameSite=Lax` y `__Host-` y `Secure` en producción; rotación y revocación; CSRF con Origin más token sincronizador en todas las escrituras.
- **Entradas:** cuerpos estrictos con Zod, JSON de hasta 16 KB, montos y estados decididos por el servidor, idempotencia en pedidos y pagos.
- **SQL:** solo Prisma y `$queryRaw` con plantilla parametrizada (sin `Unsafe`).
- **XSS y redirecciones:** sin `dangerouslySetInnerHTML` ni `innerHTML`; la única redirección por parámetro (`?next=`) acepta solo rutas propias con un patrón cerrado.
- **SSRF:** la API no hace peticiones a URL que vengan del usuario (Turnstile y Resend tienen URL fijas).
- **Errores y logs:** respuestas sin trazas, con `requestId`; redacción de cookies, tokens y correos en los logs.
- **Cabeceras:** Helmet en la API.
  - **M9-09 (requisito para M10):** el HTML prerenderizado trae 9 scripts en línea (JSON-LD, la restauración del scroll, el contexto de React Router y el arranque) y un `<style>` en línea. La CSP sin `'unsafe-inline'` de §8.7 va a necesitar hashes por página generados en el build.
- **Dependencias (R-M5-1):** `npm audit` da 44 avisos (41 moderados y 3 altos), **todos en herramientas de desarrollo o de build**:
  - `effect` (alto) entra por el CLI de Prisma y es un ReDoS sobre esquemas de configuración local, sin entradas de usuarios. npm propone bajar Prisma a la 6.12, un cambio mayor.
  - `minimatch`, `glob` y `js-beautify` entran por `mjml`, que compila los correos en el build. Su corrección también es un cambio mayor.
  - `eslint` y `typescript-eslint` tienen corrección menor (10.15.0 y 8.74.0), pero publicada hace 12 y 2 días. **No se actualiza** hasta que tengan al menos dos semanas (cadena de suministro). Ninguna llega al código en ejecución.

### Límites de §8.4 (revisión obligatoria de M3)

Diagnóstico reproducible en `apps/api/test/limites.db.test.ts`. La tabla muestra el estado **antes** de la corrección autorizada; el resultado está en [Corrección de R-M9-1](#corrección-de-r-m9-1-alternativas-1-y-2).

| Garantía | Resultado |
|---|---|
| El incremento es atómico (25 en paralelo, sin pérdidas ni dobles) | ✅ Se cumple |
| Al empezar la ventana nueva, la anterior pesa casi entera | ✅ Se cumple |
| "N por ventana" en cualquier intervalo de esa duración | ❌ **M9-07:** se aceptan hasta **2 × N** en un intervalo real más corto que la ventana. Una ráfaga al final de una ventana y otra al 90 % de la siguiente: 20 aceptadas con un límite de 10 en 0,9 ventanas. Lo agrava `Math.floor`: el peso 10 × 0,1 da 0,999… en coma flotante y se redondea a 0 |
| Demora progresiva desde el 4.º fallo de cuenta+IP | ✅ En serie (el 5.º intento recibe 429); ❌ **M9-08 en paralelo:** la demora y el bloqueo se consultan antes de evaluar la contraseña y el fallo se registra después. 12 intentos simultáneos evalúan más de 4 contraseñas. Lo acotan el límite por IP (30 / 15 min) y el bloqueo de cuenta+IP, que llega igual al 10.º fallo |

Otros puntos revisados:
- las ventanas están alineadas al reloj para todas las claves;
- el freno de ráfagas vive en memoria y se reinicia con la API (documentado);
- un login exitoso borra los contadores de cuenta+IP (documentado);
- la limpieza de las ventanas de más de 24 h depende de la API despierta (R-M7-1).

En la primera entrega no se cambió el algoritmo (requería autorización). Alternativas, con su impacto (el propietario autorizó la 1 y la 2; la 3 **no** está autorizada):
1. **Sin redondear hacia abajo** el peso de la ventana anterior. Arregla el caso de 0,999… pero no el límite teórico de 2 × N. Es un cambio mínimo, que no altera el modelo.
2. **Bloquear la demora y el bloqueo antes de evaluar la contraseña**, con un candado de transacción por cuenta+IP o un contador "en curso". Cierra M9-08 sin cambiar las cifras de §8.4. Agrega latencia solo a los intentos simultáneos.
3. **Ventana deslizante exacta**, con un registro por intento o en ventanas cortas (por ejemplo 1 min). Da la garantía exacta, pero cambia el modelo de §8.4: más escrituras y almacenamiento.

### Rendimiento

- **Lighthouse 13.6.0 sobre el build de producción en HTTP/2** (el procedimiento de M4, 3 corridas, mediana), en 8 páginas por 2 dispositivos:
  - rendimiento 98–100; accesibilidad, buenas prácticas y SEO en 100;
  - **LCP en móvil de 0,90 a 2,10 s**, todas por debajo de 2,5 s. La portada da 1,65 s, contra 2,94 s en M4 sobre el mismo transporte;
  - **CLS máximo 0,01.**

  Es una referencia local; la validación definitiva sigue en M10.
- **Backend:**
  - el Pase es una consulta con `include`, con el índice `(status, createdAt)`, sin N+1;
  - las listas del admin están paginadas por cursor;
  - el dashboard usa agregaciones en la base;
  - los índices cubren pedidos, sesiones, el outbox y los límites.
- **Notas (M9-11):**
  - la lista de auditoría sin filtros ordena por `createdAt`, sin un índice propio; con el volumen de la demo no es un problema, y conviene agregarlo si el AuditLog crece;
  - el Pase muestra hasta 200 pedidos activos.

  Ninguno se cambia sin evidencia de un problema real.

## Hallazgos

| ID | Severidad | Área | Hallazgo | Estado | Evidencia |
|---|---|---|---|---|---|
| M9-01 | Media | i18n / admin | Las fechas del admin salían en formato de es-CR en las páginas en inglés: `useDateTime` usaba el idioma global de i18next, no el de la ruta (M8) | ✅ Corregido | Chequeo nuevo en la auditoría: falla en 6 pantallas sin la corrección; `docs/evidencias/m9/antes/1280-admin-resumen-en.jpg` → `despues/` |
| M9-02 | Baja | Visual | Horario de la configuración desalineado a 768 px o más ("Apertura · Miércoles" en dos líneas) | ✅ Corregido | `antes/768-admin-configuracion-es.jpg` → `despues/` |
| M9-03 | Seria (axe) | Accesibilidad | `/_design` en el celular: tabla desplazable sin foco ni nombre (WCAG 2.1.1) | ✅ Corregido | `a11y.spec.ts` en WebKit: 3 fallas → 0 |
| M9-04 | Baja | Formularios | Correos sin `spellCheck={false}` | ✅ Corregido | Revisión D12 |
| M9-05 | Baja | Celular | Hoja de producto sin `overscroll-behavior: contain` | ✅ Corregido | Revisión D12 |
| M9-06 | Media | Pruebas | La suite por defecto de M1 tomaba `e2e/calidad/` (introducido en M9) | ✅ Corregido | `testIgnore` |
| M9-07 | Media | Seguridad | La aproximación deslizante acepta hasta 2 × el límite; `Math.floor` lo llevaba al doble exacto | ✅ Corregido el redondeo (alternativa 1). Queda la cota teórica de la aproximación (alternativa 3, sin autorizar) | `limites.db.test.ts`: 20 → 19 aceptadas |
| M9-08 | Media | Seguridad | La demora y el bloqueo del login se saltean con intentos en paralelo | ✅ Corregido (alternativa 2) | `limites.db.test.ts`: 9 contraseñas evaluadas en paralelo → como máximo 4 |
| M9-09 | Baja | Seguridad / M10 | La CSP estricta necesita hashes para 9 scripts en línea por página | Abierto: M10 | HTML del build |
| M9-10 | Baja | Dependencias | R-M5-1: 44 avisos, solo en herramientas; correcciones mayores o demasiado recientes | Abierto | `npm audit` |
| M9-11 | Info | Rendimiento | Auditoría sin índice por `createdAt`; tope de 200 en el Pase | Registrado | Revisión de consultas |
| M9-12 | — | Accesibilidad | Falso positivo: foco en el botón nativo del campo de hora | Descartado | Captura del estado |
| M9-13 | Baja | Pruebas / WebKit | R-M5-2 restante: supuestos de escritorio en las pruebas, Tab de WebKit y `sameSite` sobre HTTP | Abierto | Tabla de WebKit |
| M9-14 | Baja | Textos | Textos con número sin singular: "Hay 1 pedidos activos", "Ver los 1 campos que cambiaron", "1 pedidos del período…" | ✅ Corregido | Captura de la configuración; los textos se reformularon para cualquier número, en los dos idiomas |

## Correcciones

| Archivo | Corrección | Hallazgo |
|---|---|---|
| `apps/web/app/admin/kit.tsx` | `useDateTime` formatea con el idioma de la ruta (`useLocale`) | M9-01 |
| `apps/web/app/routes/admin/configuracion.tsx` | Columnas del horario de 10/11/11 rem | M9-02 |
| `apps/web/app/routes/design.tsx` | La región de la tabla de contraste es enfocable y tiene nombre | M9-03 |
| `apps/web/app/routes/cuenta/{ingresar,registro,recuperar}.tsx` | `spellCheck={false}` en el correo | M9-04 |
| `apps/web/app/cart/ProductSheet.tsx` | `overscroll-contain` en el `<dialog>` | M9-05 |
| `apps/web/playwright.config.ts` | `testIgnore` de `calidad/**` | M9-06 |
| `apps/web/app/i18n/locales/{es-CR,en}/admin.json` | Textos con número válidos para cualquier cantidad | M9-14 |

**Agregados:**
- la suite de auditoría `e2e/calidad/` con `playwright.calidad.config.ts` y el comando `npm run test:calidad -w @marea-baja/web`;
- las pruebas de los límites `apps/api/test/limites.db.test.ts` (diagnóstico y, después, garantía corregida);
- `calidad-report/` en `.gitignore`.

**Corrección de R-M9-1 (autorizada por el propietario, alternativas 1 y 2):**

| Archivo | Corrección | Hallazgo |
|---|---|---|
| `apps/api/src/modules/rate-limit/rate-limiter.ts` | Peso de la ventana anterior en enteros, redondeado hacia arriba: `ceil(anterior × restante / ventana)` | M9-07 |
| `apps/api/src/modules/auth/login-protection.ts` | Reserva atómica del intento por cuenta+IP antes de consultar la demora y el bloqueo; `release` | M9-08 |
| `apps/api/src/modules/auth/service.ts` | El desafío, la contraseña y el registro del fallo o del éxito corren con la reserva tomada; se libera siempre | M9-08 |

**Sin cambios:** reglas de negocio, el modelo de §8.4 (ventana fija con aproximación deslizante), los límites configurados, migraciones y dependencias.

## Corrección de R-M9-1 (alternativas 1 y 2)

Autorización del propietario (25/11/2026): corregir M9-07 con la alternativa 1 y M9-08 con la alternativa 2, sin cambiar el modelo ni los límites de §8.4. La alternativa 3 (ventana deslizante exacta) **sigue sin autorización** y no se implementó.

**M9-07 · peso de la ventana anterior.**
- Antes: `actual + Math.floor(anterior × (1 − transcurrido / ventana))`, en coma flotante. Al 90 % de la ventana, 10 × 0,1 daba 0,999… → 0.
- Ahora: `actual + ceil(anterior × restante_ms / ventana_ms)`, en enteros. El peso es exacto cuando la cuenta da entera y, si no, se redondea hacia arriba (como mucho 1 intento más conservador).
- No cambian el modelo, los límites ni la escritura (una sola consulta atómica por intento).

**M9-08 · demora en paralelo.**
- Antes: la demora y el bloqueo se consultaban antes de evaluar la contraseña, pero el fallo se registraba después. Varios intentos simultáneos leían "sin demora" a la vez.
- Ahora: `before()` reserva el intento de cuenta+IP con una sola consulta atómica (`INSERT … ON CONFLICT DO UPDATE … WHERE "lockedUntil" <= ahora`) sobre `LoginLock`, con la clave `inflight:<cuenta>:<IP>`. Recién con la reserva tomada consulta la demora y el bloqueo. La reserva se libera después de registrar el fallo (que escribe la demora) o el éxito.
- Un intento simultáneo de la misma cuenta+IP recibe **429 sin evaluar la contraseña**. Otras IP de la misma cuenta no se ven afectadas.
- Sin migración: reutiliza `LoginLock`. La reserva vence sola a los 30 s si el proceso cae antes de liberarla.
- Se descartó un candado de PostgreSQL retenido durante Argon2: las peticiones en espera ocuparían conexiones del pool y podrían agotarlo.

**Evidencia antes y después** (`limites.db.test.ts`, 12 pruebas; la misma suite corrida sobre el código anterior y sobre el corregido):

| Escenario | Antes | Después |
|---|---|---|
| Ráfaga de 10 al final de una ventana + 10 al 90 % de la siguiente (límite 10) | 20 aceptadas | **19** |
| Peso de 10 intentos en el último milisegundo de la ventana | 0 | **1** |
| Peso de 3 intentos a la mitad (1,5) | 1 | **2** |
| Inicio de la ventana nueva (10 anteriores + 1) | 10 | **11** |
| 12 logins fallidos simultáneos de la misma cuenta+IP | 9 contraseñas evaluadas | **≤ 4**, el resto 429 |
| Segundo intento con la reserva tomada | Se evaluaba | **429** |
| Reserva abandonada | — | Vence a los 30 s |
| En serie, contraseña correcta tras 4 fallos, logins correctos simultáneos, otra IP | ✅ | ✅ sin cambios |

Sobre el código anterior fallan 7 de las 12 pruebas; sobre el corregido pasan las 12.

**Lo que no se corrigió (fuera de la autorización):** la cota teórica de la aproximación deslizante. Una ráfaga al final de una ventana y otra al principio de la siguiente todavía pueden sumar hasta ~2 × N en un intervalo real más corto que la ventana. Solo la cierra una ventana deslizante exacta (alternativa 3), que cambia el modelo de §8.4.

## Validaciones (25/11/2026, árbol final de la rama, con la corrección de R-M9-1)

| Validación | Resultado |
|---|---|
| `npm run check` | ✅ 849/849 |
| `npm run test:db` | ✅ 278/278 (antes de M9: 266; +12 de `limites.db.test.ts` después de la corrección de R-M9-1) |
| `db:drift` / `env:check` | ✅ Sin diferencias / OK |
| Auditoría de calidad (`test:calidad`) | ✅ 31 pantallas × 2 idiomas × 4 anchos, 0 hallazgos |
| E2E de identidad / catálogo / producción | ✅ 14 · 19 · 9 |
| E2E de pedido / pagos | ✅ 12 · 6 |
| E2E de operación / admin (Chromium + `Mobile Safari`) | ✅ 5 + 5 · 4 + 4 |
| E2E de M1 | ✅ 41 + 1 omitida |
| Build de producción con prerender | ✅ 57 HTML |
| Lighthouse en HTTP/2 (16 combinaciones) | ✅ LCP en móvil ≤ 2,10 s; CLS ≤ 0,01 |
| WebKit en M1–M4 | Ver la tabla de WebKit; lo que queda son supuestos de las pruebas o de la plataforma |
| NVDA | ⏳ Pendiente del propietario |
| Safari de iOS real | ⏳ Pendiente del propietario |

## Riesgos

| Riesgo | Estado después de M9 (local) |
|---|---|
| R-M5-1 (`npm audit`) | **Abierto.** Análisis actualizado (M9-10): sin impacto en ejecución; las correcciones son mayores o demasiado recientes |
| R-M5-2 (WebKit en M1–M4) | **Mitigado en parte.** El defecto real de la app (axe en `/_design`) se corrigió; lo que queda son supuestos de las pruebas y comportamiento de la plataforma (M9-13). Sigue abierto hasta adaptar esas pruebas o aceptarlo |
| R-M6-3 (reconciliación sin tope) | **Abierto**, sin cambios: no es de M9 |
| R-M7-1 (barridos con la API despierta) | **Abierto** (M10) |
| R-M7-2 / R-M8-1 (límite de staff y admin) | **Abiertos.** Es la política de §8.4 |
| R-M7-3 (verificación del correo en la demo) | **Abierto** (M10) |
| R-M7-4 (transiciones en el mismo milisegundo) | **Abierto**, sin cambios |
| R-M8-2 (pedido simultáneo con un cambio de moneda) | **Abierto**, sin cambios |
| R-M8-3 (precios del prerender) | **Abierto** (rebuild en M10); la web los corrige al hidratar |
| R-M8-4 (sin *finish gate*) | **Mitigado:** *finish gate* con capturas reales en 4 anchos y 2 idiomas, 2 HOLD corregidos. Queda la revisión externa de una persona |
| **R-M9-1 (nuevo)** | **Mitigado en parte.** M9-08 corregido; M9-07 corregido en el redondeo. Sigue abierta la cota teórica de ~2 × N de la aproximación deslizante: requiere la alternativa 3, no autorizada |
| **R-M9-2 (nuevo)** | La CSP estricta de M10 necesita hashes para los scripts en línea del prerender (M9-09) |

## Pendientes del propietario

- **NVDA:** recorrido de 18 pasos (`PRUEBAS_HUMANAS_M9.md`).
- **Safari de iOS real:** 9 escenarios (`PRUEBAS_HUMANAS_M9.md`).
- **R-M9-1:** las alternativas 1 y 2 están aplicadas. Queda decidir si la cota teórica de la aproximación se acepta o si se autoriza la alternativa 3.
- **R-M5-2:** adaptar las pruebas heredadas de M1–M4 al celular (abrir el menú antes de buscar el selector y los filtros) o aceptar lo que queda.

## Evaluación (implementación local)

**Puntaje propuesto: 87/100** (86 en la primera entrega; +1 por la corrección autorizada de R-M9-1).

| Dimensión | Peso | Nota | Justificación |
|---|---|---|---|
| Profundidad de la auditoría | 20 | 18 | 31 pantallas reales × 2 idiomas × 4 anchos, axe, foco, movimiento reducido, capturas, Lighthouse, revisión de seguridad y diagnóstico de límites. La seguridad se revisó en el código, sin herramientas de ataque dinámicas |
| Evidencia | 15 | 14 | Suite reproducible, informe JSON, capturas antes y después, pruebas de diagnóstico |
| Correcciones | 15 | 14 | 9 defectos reales corregidos con verificación, incluidos M9-07 y M9-08 con evidencia antes y después; la cota teórica de los límites sigue abierta (alternativa 3, sin autorizar) |
| Accesibilidad | 15 | 13 | 0 violaciones en las pantallas reales y en los dos idiomas; falta NVDA real |
| Responsive y diseño | 15 | 13 | 4 anchos sin desbordamiento, *finish gate* con 2 HOLD resueltos; sin revisión externa ni Safari real |
| Rendimiento | 10 | 9 | Objetivos de §11 cumplidos en local; la medición definitiva es en M10 |
| Regresión | 10 | 6 | Todas las suites de M1–M8 en verde; WebKit de M1–M4 con fallas de pruebas sin adaptar |
| **Total** | **100** | **87** | |

## Dictamen de preparación

**Listo para el Nivel 3, con condiciones:**
1. **NVDA y Safari de iOS real** quedan pendientes y no se pueden marcar como hechos.
2. **R-M9-1:** M9-07 y M9-08 están corregidos. La cota teórica de la aproximación deslizante necesita tu decisión (aceptarla o autorizar la alternativa 3) antes del cierre de M9.
3. **R-M5-2:** adaptar o aceptar las pruebas heredadas de WebKit.

Ninguna de estas condiciones bloquea el push ni el PR: el código corregido está verificado y no cambia reglas aprobadas.
