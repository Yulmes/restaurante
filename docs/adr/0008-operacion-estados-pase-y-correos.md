# ADR 0008 · Operación: estados del pedido, Pase, correos de estado y bandeja de demostración

> **Estado:** aceptado (24/11/2026) e integrado en `main` con M7 (PR #9, merge `991ddba`, 24/11/2026).
>
> **Contexto de decisiones previas:** §7.1 (máquina de estados y quién hace cada transición), §7.2–7.3 (capturar al confirmar, anular al cancelar, reembolso total al cancelar después), §3.6 y §2.4 (Pase y seguimiento), §8.5 (outbox, estados honestos, bandeja demo), §8.6 (AuditLog), D2 (dos idiomas), D3 (historial y seguimiento), D-M6-2 y D-M6-3 (lo que M6 dejó para M7).

## Contexto

M6 dejó los pagos completos pero desconectados del pedido (R-M6-1): capturar y anular no movían el estado, y un pago autorizado tarde podía dejar un pedido vencido esperando confirmación (R-M6-2). M7 tiene que dar la operación del local (Pase), el seguimiento y el historial del cliente, y los correos de estado en es-CR y en.

## Decisiones

### 1. Una sola máquina y un solo punto de transición

- `modules/orders/machine.ts` es la única fuente de las transiciones y de quién puede hacerlas (cliente, staff, admin y `SYSTEM`, la API misma). La matriz completa (8 × 8 estados × 4 actores × 2 modalidades = 512 casos) está probada.
- `modules/orders/transitions.ts` aplica cada transición dentro de la transacción de quien la pide, como fija §7.1:
  1. `UPDATE … WHERE id AND status = from [AND version = v]` (409 `ORDER_VERSION_CONFLICT` si la versión no coincide);
  2. `OrderStatusHistory` con actor, rol y motivo;
  3. `AuditLog` si el actor es staff o admin (lista blanca `order`: código, estado y versión);
  4. los correos al `EmailOutbox`.
- Las transiciones que dependen del procesador no se aplican al pedirlas, sino **cuando la operación de pago termina**, en la misma transacción que la aplica (§7.3), venga de la petición o de la reconciliación:
  - captura hecha → `CONFIRMED`;
  - anulación hecha → `CANCELLED`;
  - reembolso de la cancelación de un pedido confirmado → `CANCELLED`.

  Si el procesador rechaza la operación, el pedido no cambia y el Pase lo muestra para reintentar (502). Si no responde, queda "en curso" (202) y lo termina la reconciliación.
- Mientras una operación de pago del pedido está en curso, ninguna otra transición avanza (409 `PAYMENT_IN_PROGRESS`).
- **Cierra R-M6-1.** Los endpoints de M6 (`/admin/orders/:id/payment/capture` y `/void`) siguen existiendo y ahora también mueven el pedido.

### 2. Cancelar después de confirmar (solo admin)

El reembolso se crea con la clave `cancel:<pedido>` y devuelve lo capturado que falte devolver (descuenta reembolsos parciales previos). Así, al aplicarse el reembolso (también por reconciliación), se sabe que cancela el pedido. Un reembolso parcial del admin no cambia el pedido. Con contra entrega sin cobrar, o todo ya reembolsado, la cancelación es inmediata.

### 3. Contra entrega al entregar (D-M7-2)

§7.4 dice que el staff marca `COLLECTED` "al entregar". Se implementa como parte de la transición a `DELIVERED`: en la misma transacción, `PENDING_COLLECTION → COLLECTED`, con su entrada `payment.collected` en el AuditLog. No hay un segundo botón: en el Pase, el paso dice "Entregado y cobrado". Los montos del pago siguen en 0, porque el `CHECK` de M2 exige capturado ≤ autorizado y en contra entrega no hay autorización.

### 4. Barridos (§7.1, §4.3)

Corren cada minuto mientras la API está despierta:

- **`PENDING_PAYMENT` vencido** (30 min) → `CANCELLED`, sin correo, porque `PENDING_PAYMENT` es interno. Si el pago está en `PROCESSING`, se espera a la reconciliación.
- **`PENDING_CONFIRMATION` sin confirmar** a los 20 min (`ORDER_CONFIRMATION_TIMEOUT_MINUTES`, "configurable" en §7.1) → se anula y se cancela.
- **Pedido que pasó a `PENDING_CONFIRMATION` después de vencer su reserva** (la reconciliación encontró la autorización tarde) → se anula y se cancela en el barrido siguiente. **Cierra R-M6-2.**

El endpoint `POST /internal/jobs/run` y el cron de GitHub Actions de §4.3 son infraestructura de despliegue: quedan para M10.

### 5. Correos de estado (§8.5, D2, D-M6-3)

- Plantillas de cliente: recibido, confirmado, en preparación, listo / en camino, entregado, cancelado y reembolso. Plantilla de administración: "nuevo pedido por confirmar".
- Están en es-CR y en, con un segundo layout MJML (`order-layout.mjml`, compilado y versionado como el de M3).
- El idioma es el `User.locale` de quien recibe. El aviso al staff va a cada cuenta STAFF o ADMIN no bloqueada (D-M7-3).
- Ningún correo lleva dirección, teléfono ni datos de pago. Un pedido que vence sin pagar no envía correo.
- Los correos de pedidos conservan su `payload` (nombre, código, enlace a la página del pedido, monto) después de enviarse: no tiene secretos y la bandeja lo necesita. Los de enlace de un solo uso lo siguen borrando.

### 6. `DEMO_ONLY` y bandeja de demostración (§8.5, C9)

- `DemoInboxProvider` (`EMAIL_PROVIDER=demo`, no admitido en producción) no envía nada.
- `EMAIL_DELIVERABLE_TO` filtra los destinatarios delante de cualquier proveedor: el resto queda `DEMO_ONLY` sin intentar el envío. Sirve para el escenario de Resend sin dominio, que solo entrega al correo de la cuenta del propietario. Sin la variable, todo va al proveedor (Mailpit en local y en CI).
- `GET /api/me/notifications` devuelve los últimos 50 correos de la cuenta con su estado (`SENT`, `DEMO_ONLY`, `QUEUED`, `FAILED`). **Nunca devuelve enlaces:** los de pedidos se reemplazan por el id del pedido, y los de un solo uso no salen de la base (D-M7-4).

### 7. Pase y seguimiento

- **Pase** (`/admin/pase`, `/en/admin/pass`):
  - columnas Por confirmar / Confirmado / En preparación / Listo-En camino;
  - en cada columna, primero el que espera hace más (antigüedad calculada con la hora del servidor);
  - avance con un clic y cancelación con confirmación en línea y motivo obligatorio (§8.6);
  - atajos J/K/A/C que solo actúan con un pedido enfocado (WCAG 2.1.4);
  - se actualiza cada 10 s.

  La API calcula `next` y `canCancel` según el rol: la web no decide permisos.
- **Seguimiento** (`/cuenta/pedidos/:id`): marcas sobre la línea de marea, el estado actual anunciado por `aria-live`, sin barra de porcentaje, actualización cada 15 s mientras el pedido está activo. Desde ahí el cliente cancela antes de la confirmación.
- **Historial** (`/cuenta/pedidos`): de a 20, por cursor.

### 8. Límites

- Los cambios de estado de staff y admin comparten el límite de §8.4 para operaciones de staff/admin (30 / 10 min por usuario, la misma clave que M6) y dejan `order.rate_limited` en el AuditLog al excederlo.
- La cancelación del cliente: 10 / h por cuenta (valor de implementación).

## Consecuencias

- El pedido y el pago ya no pueden quedar desalineados por una operación terminada. Pueden quedar "en curso" mientras el procesador no responda, y el Pase lo muestra.
- El reloj de prueba fijo comparte la hora entre transiciones. Las pruebas que dependen del orden avanzan el reloj (la base no guarda una secuencia aparte).
- Las API de prueba comparten la base y el worker del outbox de cualquiera puede tomar un correo de otra. Las pruebas usan un solo proveedor de correo en memoria por archivo.
- **Pendiente para M8:** pantalla de reembolsos, dashboard, auditoría con filtros.
- **Pendiente para M10:** endpoint interno de jobs y cron, `EMAIL_DELIVERABLE_TO` con el correo del propietario en la demo pública.
- **Pendiente sin hito, con aprobación:** limpieza de `IdempotencyKey` (ADR 0006).
