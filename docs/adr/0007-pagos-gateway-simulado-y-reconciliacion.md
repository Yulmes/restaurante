# ADR 0007 · Pagos: gateway simulado, idempotencia y reconciliación

> **Estado:** aceptado para M6 (23/11/2026), pendiente de la revisión del propietario.
> **Contexto de negocio (no cambia nada aprobado):** §7.1–7.4, §8.4, §8.6 y §11 de la propuesta, más las decisiones del propietario al iniciar M6:
>
> - **D-M6-1:** se incluye el pago contra entrega, como dice la propuesta (§7.2, §7.4). Esto cierra la observación de `REVISION_ACEPTACION_M5.md` §3. El ADR 0006 decía "no hay contra entrega": era cierto para M5 y queda superado aquí.
> - **D-M6-2:** capturar, anular y reembolsar se implementan en el servicio y en una API solo para staff y admin, sin interfaz. M7 los conecta con los estados del Pase y M8 agrega la pantalla de reembolsos.
> - **D-M6-3:** el correo "Pedido recibido" queda para M7, junto con los demás correos de estado.
> - **D-M6-4 (24/11/2026):** la contra entrega se ofrece en retiro y en delivery (§6 de este ADR), sin cambios en la implementación.

## Contexto

M6 implementa la interfaz `PaymentGateway`, el procesador simulado, la idempotencia, la reconciliación y los reembolsos (§12, fila M6). El esquema de M2 ya trae todas las tablas (`Payment`, `PaymentAttempt`, `PaymentOperation`, `Refund` y `MockGatewayTransaction`) y sus restricciones `CHECK` (reembolsado ≤ capturado ≤ autorizado).

## Decisiones

### 1. Sin migraciones

Alcanza el esquema de M2. `db:drift` sigue sin diferencias.

### 2. Interfaz `PaymentGateway` y `MockGateway`

- **Interfaz:** `authorize`, `capture`, `void`, `refund` y `retrieve` (`apps/api/src/modules/payments/gateway.ts`). Cada operación devuelve uno de cuatro resultados:
  - `SUCCEEDED`: aprobada;
  - `DECLINED`, con un código;
  - `PENDING`: recibida pero sin resolver;
  - `UNKNOWN`: sin respuesta.
- **`MockGateway`:** guarda sus "transacciones" en `MockGatewayTransaction`. El servicio de pagos **nunca lee esa tabla** (§6.1).
  - Una autorización es una fila, identificada por la clave de idempotencia de la operación.
  - Cada captura, anulación o reembolso deja una fila "marca" con su propia clave. Repetir la clave devuelve el mismo resultado sin volver a aplicar la operación.
  - **Orden dentro del procesador (revisión de aceptación):** primero bloquea la transacción padre y después busca la marca. Si dos llamadas con la misma clave llegan a la vez, la segunda espera el bloqueo y encuentra la marca de la primera. Antes buscaba la marca primero: la segunda veía la autorización ya capturada o anulada y respondía un rechazo.
- **Escenarios (§7.4):**

| Escenario | Respuesta | Qué queda en el procesador |
|---|---|---|
| `APPROVED` | `SUCCEEDED` | Autorizado |
| `DECLINED` | `DECLINED` (`card_declined`) | Rechazado |
| `INSUFFICIENT_FUNDS` | `DECLINED` (`insufficient_funds`) | Rechazado |
| `PROCESSOR_ERROR` | `DECLINED` (`processor_error`) | Rechazado |
| `TIMEOUT` | `UNKNOWN` | **Autorizado** (el caso clásico: se autorizó y no se supo) |
| `PENDING` | `PENDING` | Pendiente, que se aprueba solo a los 20 s (`resolveAt`) |

- **Usar un procesador real** sería escribir otra implementación de la interfaz y pasarla a `createApp` (`paymentGateway`). En las pruebas se inyecta así una falla.

### 3. Intención antes de la llamada externa

Cada operación tiene tres fases, en este orden:

1. **Primera transacción:** bloquea el pago (`SELECT … FOR UPDATE`), valida el estado con la máquina de `machine.ts` y registra `PaymentOperation REQUESTED` con una clave determinística. En `authorize`, el pago pasa a `PROCESSING` y se crea el `PaymentAttempt`. Luego **confirma**.
2. **Llamada al procesador**, fuera de cualquier transacción. Una excepción cuenta como `UNKNOWN`.
3. **Segunda transacción:** vuelve a bloquear el pago y aplica el resultado **solo si la operación sigue abierta**. Así, la reconciliación y la petición nunca aplican dos veces lo mismo.

**Claves determinísticas:**

| Operación | Clave |
|---|---|
| Autorizar | `paymentId:authorize:<Idempotency-Key>` (un intento del cliente = una clave; tras un rechazo, el próximo intento usa otra) |
| Capturar | `paymentId:capture` |
| Anular | `paymentId:void` |
| Reembolsar | `refund:<refundId>` |

**Intento retomado (revisión de aceptación):** si la respuesta de `/authorize` se perdió y el cliente repite el intento con la misma `Idempotency-Key` cuando la clave HTTP ya se liberó, la operación del procesador de ese intento ya existe. Entonces no se abre otra: se responde el estado actual del pedido, que la reconciliación termina. Antes ese reintento respondía 500 (clave única de `PaymentOperation`) o 409. Con `/refunds` pasa lo mismo: el `Refund` ya registrado con esa clave no se duplica, y la respuesta sale de cómo terminó su operación.

**Resultado para el pedido:** con la autorización aprobada, el pedido pasa de `PENDING_PAYMENT` a `PENDING_CONFIRMATION` (§7.1), con su `OrderStatusHistory`: el actor es el cliente, o ninguno si lo hizo la reconciliación. Con la contra entrega pasa lo mismo, sin procesador.

### 4. Reconciliación

`PaymentService.reconcile()` corre cada 5 s en `server.ts`, de a una vuelta por vez, mientras la API está despierta.

1. Toma las operaciones `UNKNOWN` y las `REQUESTED` de más de 30 s. Ese margen es el bloqueo de la idempotencia: así no pisa una petición en curso.
2. Consulta al procesador con `retrieve(clave)`.
3. Si el procesador nunca recibió la operación (`NOT_FOUND`), la repite con **la misma clave**. Para autorizar usa el escenario guardado en el intento.
4. Aplica el resultado como en la fase 3.

**Qué resuelve:** el tiempo agotado (encuentra la autorización y no cobra dos veces), el pendiente de la demo y la caída a mitad de camino. El job que cancela los pedidos vencidos es de M7.

### 5. Idempotencia HTTP compartida

La lógica de `POST /orders` (M5) se extrajo **sin cambios de comportamiento** a `modules/idempotency/http-idempotency.ts`. La usan:

- `POST /orders` (alcance `orders.create`);
- `/authorize` (`payments.authorize`);
- `/refunds` (`payments.refund`).

El comportamiento es el mismo en los tres:

- misma clave y mismo cuerpo → la respuesta original;
- otro cuerpo, u otra cuenta con la misma clave → 422;
- una petición en curso → 409;
- una petición interrumpida se retoma una sola vez.

Las 38 pruebas de integración de M5 siguen pasando.

### 6. Contra entrega (D-M6-1)

- **Endpoint:** `POST /orders/:id/payments/cash-on-delivery`. Es idempotente por estado y no usa el procesador.
- **Qué cambia:** el método del `Payment` pasa a `CASH_ON_DELIVERY`, el pago a `PENDING_COLLECTION` y el pedido a `PENDING_CONFIRMATION`.
- **Retiro y delivery (D-M6-4, confirmada por el propietario el 24/11/2026):** se ofrece en los dos, como "pagar al recibir o al retirar". La propuesta habla de "contra entrega" y el pedido termina en `DELIVERED` en ambos casos.
- **Pendiente para M7:** marcar `COLLECTED` al entregar (staff).
- **Interpretación:** el `Payment` se sigue creando con `DEMO_CARD` (M5), y el método se fija al pagar. De las dos opciones que dejó abiertas la revisión de M5, es la que no cambia el flujo de creación del pedido.

### 7. Staff y admin (D-M6-2)

| Ruta | Quién | Notas |
|---|---|---|
| `GET /admin/orders/:id/payment` | STAFF, ADMIN | Vista sin datos de tarjeta (no existen) |
| `POST /admin/orders/:id/payment/capture` | STAFF, ADMIN | Solo `AUTHORIZED` con el pedido en `PENDING_CONFIRMATION` |
| `POST /admin/orders/:id/payment/void` | STAFF, ADMIN | Autorización (vía procesador) o contra entrega pendiente (sin procesador) |
| `POST /admin/orders/:id/payment/refunds` | Solo ADMIN | `Idempotency-Key`, monto y motivo; Σ reembolsos ≤ capturado |

- **Respuestas:** salen del estado final de **la operación**, no de la llamada: rechazada → 502 `GATEWAY_ERROR`; sin resultado → 202 (la termina la reconciliación); hecha → 200 (201 en `/refunds`). Si la reconciliación la terminó antes que la petición, se informa ese resultado.
- **Capturar y anular se excluyen entre sí:** con una de las dos en curso (`REQUESTED`/`UNKNOWN`), la otra → 409 `PAYMENT_IN_PROGRESS` y no llega al procesador. Antes la segunda competía en el procesador y terminaba en 502.
- **Estado del pedido:** **ninguna de estas rutas lo cambia** en M6. M7 encadena "confirmar → capturar" y "cancelar → anular". Mientras tanto puede quedar un pedido en `PENDING_CONFIRMATION` con el pago `CAPTURED` o `VOIDED`. Es aceptable porque no hay interfaz que lo muestre.
- **Reembolsos simultáneos:** Σ reembolsos ≤ capturado cuenta también los reembolsos en curso (`REQUESTED`/`UNKNOWN`) bajo el bloqueo del pago, así que dos reembolsos simultáneos no se pueden pasar del total.
- **Reembolso rechazado:** se borra su fila `Refund` (no ocurrió).
- **AuditLog:** `payment.captured`, `payment.voided`, `payment.refunded` y `payment.rate_limited`, con la lista blanca `payment` (código del pedido, estado, método y montos).

### 8. Límites (§8.4)

| Operación | Límite | Origen |
|---|---|---|
| Autorizar | 30 / h por IP y 10 / h por pedido | Tabla de la propuesta |
| Contra entrega | 10 / h por pedido | Implementación |
| Staff y admin | 30 / 10 min por usuario; al exceder, 429 y entrada en el AuditLog | Tabla de la propuesta |

### 9. `DEMO_PAYMENTS_ENABLED`

- **Por defecto `false`**, igual que `ORDERS_ALLOW_OUTSIDE_HOURS`.
- Sin la variable, `/authorize` responde 403 `DEMO_PAYMENTS_DISABLED` y la web solo ofrece la contra entrega.
- La cotización del checkout trae `paymentMethods`; el pedido trae `payment.availableMethods`.
- **Dónde se activa:** las E2E y el `.env.example` la ponen en `true`. Para la demo pública (M10) habrá que activarla.

### 10. Web

- **Paso 3 del checkout:** el cliente elige la forma de pago y, con la tarjeta demo, el escenario. **No hay campos de tarjeta**: "DEMO •••• 0000" es solo una ilustración.
- **Al confirmar:** se crea el pedido y enseguida se paga.
- **Confirmación:** muestra el resultado. Si el pago se rechazó, permite reintentar con otro escenario mientras dure la reserva. Si está en proceso, consulta el pedido cada 2 s y lo anuncia en una región `aria-live`.

### 11. E2E de pagos aparte

- **Configuración:** la suite tiene su propia configuración (`playwright.pagos.config.ts`), con API y web propias (3410 y 5188).
- **Por qué:** el freno global de ráfagas de la API (300 solicitudes cada 5 min por IP, en memoria) se agotaba al sumar 6 pruebas a la suite del pedido en el mismo proceso. Separadas, cada API arranca con su contador en cero.
- **Base:** las dos suites comparten la base `_e2e` y corren una después de la otra (también en CI, en el job **Pedido y pagos**).

## Consecuencias

- El cobro real (capturar) ocurre recién con la confirmación del local, que es de M7. Hasta entonces, un pago demo aprobado queda `AUTHORIZED`.
- Un pedido que vence con la autorización aprobada lo resuelve el job de M7, que cancela y anula.
- No se guardan datos de tarjeta en ninguna parte: no se piden.
