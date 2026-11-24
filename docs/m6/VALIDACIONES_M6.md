# Validaciones de M6 · Pagos

> **Fecha:** 23/11/2026, con la revisión de aceptación técnica del mismo día (sección al final). Son resultados de ejecuciones locales en la rama `m6-pagos` (base `bcebdcb`, M5 integrado). **M6 no está integrado ni cerrado:** espera la revisión del propietario y la decisión D-M6-4. **Sin ejecución en GitHub Actions** (requiere push, no autorizado).
> **Decisiones aplicadas:** §7.1–7.4, §8.4, §8.6 y §11 de la propuesta, más las decisiones del propietario al iniciar M6. Detalle técnico en el [ADR 0007](../adr/0007-pagos-gateway-simulado-y-reconciliacion.md).
>
> - **D-M6-1:** contra entrega incluida.
> - **D-M6-2:** capturar, anular y reembolsar se exponen solo por API para staff y admin, sin interfaz.
> - **D-M6-3:** el correo "Pedido recibido" queda para M7.

## Qué se implementó

| Área | Detalle |
|---|---|
| Contratos (`shared`) | `payments/schemas.ts`: métodos, escenarios demo, códigos de rechazo, cuerpos de `/authorize` y `/refunds` (estrictos), vista del pago para el cliente y para staff/admin. El pedido trae `payment.method`, `availableMethods` y `lastAttempt`; la cotización, `paymentMethods`. Seis códigos de error nuevos |
| Procesador | `PaymentGateway` (`authorize`, `capture`, `void`, `refund`, `retrieve`) y `MockGateway` con los 6 escenarios de §7.4, sobre `MockGatewayTransaction` |
| Servicio | `PaymentService`: intención registrada antes de llamar al procesador, bloqueo del pago, máquina de estados (`machine.ts`), contra entrega, capturar, anular, reembolsar (Σ ≤ capturado, contando los reembolsos en curso), reconciliación y AuditLog |
| Idempotencia | Lógica de `POST /orders` extraída a `modules/idempotency/http-idempotency.ts` sin cambios de comportamiento. La usan `/orders`, `/authorize` y `/refunds` |
| API | `POST /orders/:id/payments/authorize`, `POST /orders/:id/payments/cash-on-delivery`, `GET /admin/orders/:id/payment`, `POST /admin/orders/:id/payment/capture`, `/void` y `/refunds` |
| Job | Reconciliación cada 5 s en `server.ts` |
| Configuración | `DEMO_PAYMENTS_ENABLED` (por defecto `false`; `true` en `.env.example` y en las E2E) |
| Web | Paso 3 del checkout con la forma de pago y el selector de escenarios, sin campos de tarjeta. En la confirmación, estado del pago, consulta cada 2 s mientras está en proceso (`aria-live`) y reintento tras un rechazo. Textos en es-CR y en |
| CI | Job **Pedido y pagos**: agrega `test:e2e:pagos` (Chromium y `Mobile Safari`) |
| Persistencia | **Sin migraciones ni cambios de esquema**: alcanzan las tablas y los `CHECK` de M2 |

## Estados

- **Pago (§7.2):**

  ```
  REQUIRES_PAYMENT → PROCESSING → AUTHORIZED | REQUIRES_PAYMENT (rechazo)
  AUTHORIZED → CAPTURED | VOIDED
  CAPTURED → PARTIALLY_REFUNDED → REFUNDED
  REQUIRES_PAYMENT → PENDING_COLLECTION (contra entrega) → COLLECTED (M7) | VOIDED
  ```

- **Pedido:** con la autorización aprobada o la contra entrega elegida, pasa de `PENDING_PAYMENT` a `PENDING_CONFIRMATION`, con su `OrderStatusHistory`.
- **Lo que queda para M7:** capturar y anular no cambian el estado del pedido; se conectan con el Pase.

## Resultados

| Validación | Comando | Resultado |
|---|---|---|
| Formato, lint, tipos y unitarias | `npm run check` | ✅ 292 / 292 en 20 archivos (antes de M6: 200). Incluye la matriz completa de 81 transiciones del pago, la vista del pago y `DEMO_PAYMENTS_ENABLED` |
| Integración con PostgreSQL | `npm run test:db` | ✅ 219 / 219 en 9 archivos (antes de M6: 172). `pagos.db.test.ts`: 47 pruebas (25 iniciales y 22 de la revisión de aceptación); repetido 3 veces seguidas sin fallas. Las 38 de `pedido.db.test.ts` siguen pasando con la idempotencia extraída |
| Esquema y migraciones | `npm run db:drift -w @marea-baja/api` | ✅ Sin diferencias. **Sin migraciones nuevas** |
| Variables de entorno | `npm run env:check` | ✅ Con `DEMO_PAYMENTS_ENABLED` |
| E2E del pedido (M5), Chromium y `Mobile Safari` | `npm run test:e2e:pedido -w @marea-baja/web` | ✅ 12 / 12. El escenario 1 ahora paga con la tarjeta demo ("Aprobado") y verifica el pedido en `PENDING_CONFIRMATION` con el pago `AUTHORIZED` |
| E2E de pagos (M6), Chromium y `Mobile Safari` | `npm run test:e2e:pagos -w @marea-baja/web` | ✅ 6 / 6 |
| E2E del catálogo (M4) | `npm run test:e2e:catalog -w @marea-baja/web` | ✅ 19 / 19 |
| E2E de identidad (M3) | `npm run test:e2e:auth -w @marea-baja/web` | ✅ 14 / 14 |
| E2E del idioma del documento (M3) | `npm run test:e2e:produccion -w @marea-baja/web` | ✅ 9 / 9 |
| E2E del sistema de diseño (M1) | `npm run test:e2e -w @marea-baja/web` | ✅ 41 pasan y 1 se omite (igual que antes) |
| Build de producción | `npm run build -w @marea-baja/web` | ✅ 57 HTML (56 páginas y el fallback) |
| Dependencias | — | Sin cambios: `package-lock.json` igual. El único cambio de `package.json` es el script `test:e2e:pagos`. El aviso heredado R-M5-1 sigue igual |
| CI | `.github/workflows/ci.yml`, job **Pedido y pagos** | ⏳ Actualizado, sin ejecución remota |

### Integración (`apps/api/test/pagos.db.test.ts`: 25 iniciales; las 22 de la revisión están en las tablas de la sección final)

- **Matriz de escenarios:**
  - `APPROVED`: autoriza el total leído de la base, pasa el pedido a `PENDING_CONFIRMATION` y registra el historial.
  - `DECLINED`, `INSUFFICIENT_FUNDS` y `PROCESSOR_ERROR`: rechazan con su código, y el reintento con "Aprobado" autoriza.
  - `TIMEOUT`: queda en proceso, otro intento recibe 409, y la reconciliación encuentra la autorización con **una sola** transacción del procesador.
  - `PENDING`: sigue en proceso a los 10 s y queda autorizado a los 20 s, con la transición hecha por el sistema.
- **Intención antes de la llamada externa:**
  - si la llamada al procesador se cae, la operación queda registrada y la reconciliación la repite con **la misma clave**;
  - una operación `REQUESTED` reciente no se toca, y pasados los 30 s se retoma.
- **Idempotencia y concurrencia:**
  - misma clave y mismo cuerpo → la respuesta original; misma clave con otro escenario → 422;
  - dos autorizaciones simultáneas: una responde 200 y la otra 409, con una sola autorización;
  - un pedido ya autorizado no se vuelve a autorizar.
- **Contra entrega:**
  - deja el pago `PENDING_COLLECTION` y el pedido `PENDING_CONFIRMATION`, sin procesador, y es idempotente;
  - elegida, la tarjeta ya no se acepta; pagado con tarjeta, no se puede cambiar a contra entrega.
- **Reglas y seguridad del cliente:**
  - vencida la reserva de 30 min, ni la tarjeta ni la contra entrega;
  - un cuerpo con monto → 400; un escenario fuera de la lista → 400; sin `Idempotency-Key` → 400;
  - sin sesión 401, sin verificar 403, pedido ajeno 404, sin CSRF 403;
  - con `DEMO_PAYMENTS_ENABLED=false`, la tarjeta responde 403 y solo se ofrece la contra entrega;
  - el 11.º intento de autorizar por pedido en una hora → 429 con `Retry-After`.
- **Staff y admin:**
  - RBAC: el cliente → 403; el staff ve, captura y anula, pero no reembolsa; solo el admin reembolsa;
  - captura única también con dos capturas simultáneas, con AuditLog del staff. El pedido sigue en `PENDING_CONFIRMATION` (lo conecta M7);
  - reembolso parcial (201) e idempotente; uno que supera lo capturado → 422; dos simultáneos que juntos se pasan → solo entra uno; el estado final es `REFUNDED` con Σ = capturado y una entrada de AuditLog por reembolso;
  - anular una autorización (vía el procesador) y una contra entrega (sin procesador). Después de anular no se captura;
  - no se captura ni se anula un pedido sin pagar, ni se reembolsa sin capturar;
  - el límite de 30 / 10 min por usuario → 429, con la entrada `payment.rate_limited` en el AuditLog.
- **Base:** los `CHECK` impiden capturar más de lo autorizado y reembolsar más de lo capturado.

### E2E de pagos (`apps/web/e2e/pagos/pagos.spec.ts`, 3 pruebas × 2 proyectos)

1. **Rechazo y reintento, en es-CR:**
   - el paso 3 muestra la ilustración "DEMO •••• 0000", **sin ningún campo de tarjeta**;
   - con "Fondos insuficientes" (axe), la confirmación muestra el mensaje, el pago "Pendiente de pago" y la hora hasta la que sigue reservado (axe);
   - el reintento con "Aprobado" deja el pago autorizado y el pedido esperando la confirmación. En la base: intentos `FAILED, SUCCEEDED` y autorizado = total.
2. **Contra entrega, en inglés:** el selector de escenarios desaparece. La confirmación dice "Awaiting collection" (axe). En la base: `CASH_ON_DELIVERY`, `PENDING_COLLECTION`, sin autorización ni intentos.
3. **Pendiente:** la confirmación muestra "En proceso" y "Esta pantalla se actualiza sola", y cambia sola a "Autorizado" (consulta cada 2 s y reconciliación del servidor cada 5 s).

### Revisión visual

- **Capturas:** paso 3, rechazo, en proceso y autorizado, a 390 y 1280 px, en Chromium y `Mobile Safari`, sin desborde horizontal. Quedaron en la carpeta temporal de la sesión y **no se versionan**.
- **Corregido durante la revisión:**
  - radios que se achicaban cuando el texto ocupaba dos líneas (`shrink-0`);
  - doble punto en "hasta las 4:46 p. m.";
  - el aviso de reserva repetido.

## WebKit (opción A, incremental)

- **Pedido y pagos:** las 9 pruebas pasan en `Mobile Safari` (motor WebKit de Playwright con perfil de iPhone 13, en Windows; **no es Safari de iOS real**).
- **Suites heredadas de M1–M4:** repetidas con los cambios de M6. Quedaron **idénticas** a la línea base de M5: M1 35 pasan, 6 fallan y 1 se omite; identidad 12/2; catálogo 15/4; idioma del documento 8/1. No hay fallas nuevas; son las heredadas del riesgo R-M5-2 y no se corrigieron.

**Repetición en la revisión de aceptación (con las correcciones R-1 a R-4):**

- **M1:** 35 pasan, 6 fallan y 1 se omite, como en la línea base. En una primera corrida hubo una falla intermitente más, en páginas que M6 no toca; la segunda corrida volvió a la línea base.
- **Identidad:** 13 pasan y 1 falla. La segunda falla de la línea base (el helper móvil) es intermitente y esta vez no apareció.
- **Catálogo:** 15/4.
- **Idioma del documento:** 8/1.
- **Conclusión:** no hay fallas nuevas.

## Lo que no se verificó o queda pendiente

| Tema | Estado |
|---|---|
| CI en GitHub Actions (job **Pedido y pagos**) | Sin ejecución remota (requiere push) |
| Marcar `COLLECTED` al entregar (contra entrega) | M7 (staff, Pase) |
| Capturar al confirmar y anular al cancelar (estado del pedido) | M7 (D-M6-2). Hoy, por API sin interfaz y sin cambiar el pedido |
| Pantalla de reembolsos | M8 (D-M6-2) |
| Correo "Pedido recibido" | M7 (D-M6-3) |
| Job que cancela pedidos vencidos y anula su autorización | M7 |
| `DEMO_PAYMENTS_ENABLED=true` en la demo pública | M10 (configuración del despliegue) |
| Safari de iOS real | No probado (M9) |
| Riesgos heredados R-M5-1 (`npm audit`) y R-M5-2 (WebKit M1–M4) | Siguen aceptados temporalmente y no resueltos; M6 no los cambia |
| **D-M6-4:** contra entrega en retiro y/o delivery | **Decisión pendiente del propietario** (ver la sección final). No se cambió la regla actual (las dos modalidades) |
| Reconciliación sin tope de reintentos (R-M6-3) | Aceptado para el procesador simulado; a revisar con un procesador real |

## Revisión de aceptación técnica (23/11/2026)

Revisión pedida antes de autorizar el push y el PR. Se contrastó el código con §7.1–7.4, §8.4 y §12 de la propuesta. Cada caso de las tablas siguientes es una prueba que se ejecutó (`apps/api/test/pagos.db.test.ts`, salvo que se indique otra cosa).

### Defectos encontrados y corregidos

Los cuatro son de M6 y se reprodujeron con pruebas que fallaban antes de la corrección: 8 pruebas en rojo, dos de ellas con 500.

| # | Defecto | Causa | Corrección | Archivos |
|---|---|---|---|---|
| R-1 | Dos capturas o anulaciones simultáneas con **la misma clave** en el procesador simulado: una respondía `SUCCEEDED` y las otras `DECLINED`, aunque la operación sí se había hecho. Pasa si la reconciliación repite la operación mientras la petición original todavía está en vuelo. Entonces el pago quedaba `AUTHORIZED` con el procesador ya `CAPTURED` (se arreglaba al reintentar) | `MockGateway.#operate` buscaba la marca de la clave **antes** de bloquear la transacción padre | Primero bloquea y después busca la marca | `mock-gateway.ts` |
| R-2 | Respuesta perdida en `/authorize`: si la reconciliación ya había resuelto el intento y el cliente lo repetía con la misma `Idempotency-Key` (con la clave HTTP liberada por el corte), la API respondía **500** cuando el intento se había rechazado y 409 cuando se había aprobado | Se intentaba crear otra `PaymentOperation` con la misma clave determinística (única) | Si la operación de ese intento ya existe, no se abre otra: se responde el estado actual del pedido (200) | `service.ts` |
| R-3 | Respuesta perdida en `/refunds`: el mismo caso respondía **500** | Se intentaba crear otro `Refund` con la misma clave (única) | Si el reembolso ya existe, se responde según cómo terminó su operación (201 hecho, 202 en curso), sin otra llamada ni otro reembolso | `service.ts` |
| R-4 | Capturar y anular a la vez: la segunda operación llegaba al procesador, competía con la primera y terminaba en **502** `GATEWAY_ERROR`. Con la primera todavía sin respuesta, la segunda podía incluso ganarle | Solo se comprobaba que no hubiera otra operación con **la misma clave** | Con una captura o anulación en curso (`REQUESTED`/`UNKNOWN`), la otra → 409 `PAYMENT_IN_PROGRESS`, sin llegar al procesador. Además, la respuesta de staff y admin sale del estado final de la operación (si la reconciliación la terminó antes, se informa eso) | `service.ts` |

Ninguna corrección cambia reglas de negocio, contratos (`shared`), esquema, dependencias ni el comportamiento de M0–M5. El módulo de idempotencia HTTP compartido no se tocó.

### Matriz de escenarios de la tarjeta demo

| Escenario | Respuesta de la API | Pago | Pedido | Procesador | Intentos y operación | Reintento |
|---|---|---|---|---|---|---|
| Aprobado | 200, `AUTHORIZED` | `AUTHORIZED`, autorizado = total de la base | `PENDING_CONFIRMATION` + historial `payment.authorized` | 1 transacción `AUTHORIZED` | 1 `SUCCEEDED` / `SUCCEEDED` | Otro intento → 409 `PAYMENT_NOT_ALLOWED` |
| Rechazado | 200, `REQUIRES_PAYMENT`, `card_declined` | `REQUIRES_PAYMENT`, autorizado 0 | `PENDING_PAYMENT` (sigue reservado) | `DECLINED` | `FAILED` / `FAILED` con el código | Con "Aprobado" autoriza; intentos `FAILED, SUCCEEDED` |
| Fondos insuficientes | Ídem, `insufficient_funds` (mensaje propio) | Ídem | Ídem | Ídem | Ídem | Ídem |
| Error del procesador | Ídem, `processor_error` | Ídem | Ídem | Ídem | Ídem | Ídem |
| Tiempo agotado | 200, `PROCESSING` | `PROCESSING` | `PENDING_PAYMENT` | **`AUTHORIZED`** (autorizó sin avisar) | `UNKNOWN` / `UNKNOWN` | Otro intento → 409 `PAYMENT_IN_PROGRESS`. La reconciliación encuentra la autorización: **1 sola** transacción |
| Pendiente | 200, `PROCESSING` | `PROCESSING` hasta ~20 s | `PENDING_PAYMENT`, luego `PENDING_CONFIRMATION` (sin actor) | `PENDING` → `AUTHORIZED` a los 20 s | `PENDING` → `SUCCEEDED` | Otro intento o contra entrega → 409 |
| Contra entrega | 200, `PENDING_COLLECTION` | `CASH_ON_DELIVERY` | `PENDING_CONFIRMATION` + historial `payment.cash_on_delivery` | Sin llamada | Sin intentos | Repetirlo no cambia nada; después la tarjeta → 409 |

### Idempotencia

| Caso | Resultado |
|---|---|
| Misma clave y mismo cuerpo | La respuesta original, idéntica (autorizar y reembolsar) |
| Misma clave con otro cuerpo (otro escenario, otro monto) | 422 `IDEMPOTENCY_KEY_REUSED` |
| Misma clave, dos peticiones a la vez | La segunda → 409 `IDEMPOTENCY_IN_PROGRESS`; al terminar la primera, repetirla devuelve la respuesta original. 1 operación, 1 intento, 1 transacción |
| Respuesta perdida, reintento con la misma clave (aprobado y rechazado) | 200 con el resultado que dejó la reconciliación, sin otra operación (R-2) |
| Repetición mientras la reconciliación trabaja | La petición y la reconciliación terminan la misma operación: se aplica una vez, con un solo historial |
| Repetición después de la resolución final | La respuesta guardada (misma clave) o 409 `PAYMENT_NOT_ALLOWED` (otra clave) |
| Procesador (`capture`, `void`, `refund` con la misma clave × 3 a la vez) | Las tres reciben el mismo resultado y la misma referencia; 1 sola marca (R-1) |

### Concurrencia

| Caso | Resultado |
|---|---|
| Dos autorizaciones con claves distintas a la vez | 200 y 409; una sola autorización |
| Autorizar con el pago `PROCESSING` (tiempo agotado o pendiente) | 409 `PAYMENT_IN_PROGRESS` |
| Tres reconciliaciones a la vez sobre el mismo tiempo agotado | Una sola autorización y un solo historial; una operación resuelta no se vuelve a tomar |
| Procesador caído durante la reconciliación | No cambia nada (operación `UNKNOWN`); la vuelta siguiente la resuelve |
| Captura en vuelo + anulación (y al revés), staff y admin | 409 `PAYMENT_IN_PROGRESS`; el pago y el procesador quedan iguales; 1 AuditLog (R-4) |
| Captura y anulación a la vez (`Promise.all`) | 200 y 409, sin 502; el estado del pago coincide con el del procesador; 1 AuditLog |
| Staff y admin capturan a la vez | 200 y 409; 1 captura y 1 AuditLog |
| Repetir una captura o una anulación ya hechas | 409 `PAYMENT_NOT_ALLOWED`; sin otra operación ni otra auditoría |
| Dos reembolsos con claves distintas que juntos se pasan | 201 y 422 |
| Un reembolso en vuelo + otro de 1 colón sobre el total | 422 `REFUND_EXCEEDS_CAPTURED` (los reembolsos en curso cuentan) |
| Reembolso con respuesta perdida | La reconciliación lo hace; el reintento con la misma clave → 201 sin duplicarlo: 1 `Refund`, 1 operación, 1 AuditLog (R-3) |
| Reembolso parcial, luego el resto | `PARTIALLY_REFUNDED` → `REFUNDED`, Σ = capturado |
| Reembolso de un pago anulado, contra entrega o sin capturar | 409 `PAYMENT_NOT_ALLOWED` |

**Estado en pantalla mientras cambia:** la E2E "pendiente" y la pasada visual con tiempo agotado comprueban que la confirmación pasa sola de "En proceso" a "Autorizado" (consulta cada 2 s).

### Reconciliación

- **Persistente:** trabaja sobre `PaymentOperation` en la base, no sobre memoria. Una API nueva (un reinicio) retoma las operaciones de la anterior; lo prueba el caso "la llamada se cae", que reconcilia con otra instancia.
- **Idempotente y segura en paralelo:** cada aplicación bloquea el pago y solo cambia operaciones abiertas. Las repeticiones al procesador usan la misma clave.
- **Límites:** hasta 20 operaciones por vuelta, cada 5 s, de a una vuelta por proceso (`reconciling`). Sin operaciones abiertas, hace una sola consulta con índice (`status, updatedAt`).
- **Errores:** un fallo en una operación se registra en el log (sin datos del pago) y no detiene las demás.
- **Limitación aceptada (no se cambia la arquitectura):** una operación que el procesador nunca resuelve se vuelve a consultar cada 5 s, sin tope ni espera creciente. Con el procesador simulado no pasa: sus estados siempre se resuelven. Con un procesador real convendría un tope o una espera creciente; queda anotado como riesgo R-M6-3.

### Seguridad

- **Cuerpos estrictos:** un `amountMinor`, un estado o un campo de más (incluido `demoPaymentsEnabled`) en el cuerpo → 400. El escenario es una lista cerrada.
- **Acceso:**
  - invitado → 401;
  - sin verificar → 403;
  - pedido ajeno, inexistente o con id inválido → 404;
  - sin CSRF → 403 (cliente y staff/admin);
  - el cliente no ve ni opera las rutas de staff/admin (403);
  - solo ADMIN reembolsa.
- **Límites y AuditLog:**
  - los límites de §8.4 funcionan, con `Retry-After`;
  - captura, anulación, reembolso y límite de staff/admin superado quedan en el AuditLog con la lista blanca `payment`;
  - un rechazo del procesador en una operación de staff/admin no se audita como hecho: queda en la operación (`FAILED` y su código).
- **Datos expuestos:** las respuestas del cliente y de staff/admin no incluyen referencias del procesador (`mock_…`), claves de idempotencia ni datos de tarjeta (prueba nueva). No hay campos de tarjeta en la interfaz (E2E).
- **Switch:**
  - `DEMO_PAYMENTS_ENABLED` viene de la variable de entorno y ninguna petición lo cambia;
  - apagado, la tarjeta → 403 y la contra entrega sigue funcionando;
  - las rutas de staff/admin no dependen del switch: así se pueden terminar operaciones existentes si se apaga.

### UX (pasada visual de la revisión)

- **Cobertura:**
  - paso 3, tiempo agotado → autorizado, rechazo y reintento con contra entrega;
  - es-CR y en, a 390, 768, 1024 y 1280 px en Chromium, y a 390 px en `Mobile Safari`.
- **Resultado:** 8/8 recorridos sin desborde horizontal.
- **Teclado:** con las flechas se cambia de escenario y el foco acompaña.
- **Errores:** el mensaje de error recibe el foco (`role="alert"`).
- **Capturas:** quedaron en la carpeta temporal de la sesión y no se versionan.
- **Defectos visuales nuevos atribuibles a M6:** ninguno. El encabezado fijo que aparece a mitad de una captura de página completa a 768 px es el encabezado sticky de M1 dibujado por la herramienta, no un defecto.

### D-M6-4 · Contra entrega en retiro y/o delivery (pendiente de decisión del propietario)

- **Hoy:** se ofrece en `PICKUP` y en `DELIVERY` como "Pagar al recibir o al retirar" (`view.ts` no mira la modalidad).
- **La propuesta no lo define:**
  - §7.2 y §7.4 dicen "contra entrega" y que el staff marca `COLLECTED` "al entregar";
  - §7.1 lleva las dos modalidades a `DELIVERED`.

No se cambió la regla. Las alternativas:

| Alternativa | Impacto |
|---|---|
| **A. Retiro y delivery (lo actual)** | Sin cambios. Es habitual pagar al retirar en un local. En M7, `COLLECTED` se marca al entregar en las dos modalidades |
| B. Solo delivery | Filtrar `availableMethods` y `paymentMethods` por modalidad, rechazar en la API la contra entrega con `PICKUP`, cambiar los textos y adaptar las pruebas (la E2E de contra entrega usa retiro) |
| C. Solo retiro | Los mismos cambios que B, al revés. Poco habitual |

**Recomendación:** A, porque no cambia nada y es coherente con que las dos modalidades terminen en `DELIVERED`.

### Evaluación de aceptación

- **Criterio de §12 (matriz de escenarios + concurrencia):** cumplido con pruebas ejecutadas; las tablas anteriores reflejan solo lo que se probó.
- **Pendientes que no bloquean la revisión:**
  - el CI en GitHub (requiere push);
  - D-M6-4;
  - lo previsto para M7, M8 y M10.
- **Riesgo R-M6-1 (D-M6-2):** el pedido puede quedar desalineado con el pago hasta M7. No compromete la integridad del pago: la máquina de estados, las operaciones y el procesador siguen coherentes, y no se puede capturar ni anular fuera de `PENDING_CONFIRMATION`.
- **Riesgo R-M6-2:** la reconciliación puede pasar un pedido vencido a `PENDING_CONFIRMATION` si el pago se inició antes del vencimiento. Lo cancela el job de M7.
