# Validaciones de M6 · Pagos

> **Fecha:** 23/11/2026. Son resultados de ejecuciones locales en la rama `m6-pagos` (base `bcebdcb`, M5 integrado). **M6 no está integrado ni cerrado:** espera la revisión del propietario. **Sin ejecución en GitHub Actions** (requiere push, no autorizado).
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
| Integración con PostgreSQL | `npm run test:db` | ✅ 197 / 197 en 9 archivos (antes: 172). `pagos.db.test.ts`: 25 pruebas. Las 38 de `pedido.db.test.ts` siguen pasando con la idempotencia extraída |
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

### Integración (`apps/api/test/pagos.db.test.ts`, 25 pruebas)

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
