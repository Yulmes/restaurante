# ADR 0006 · Pedido: carrito, motor de precios, fusión e idempotencia

> **Estado:** aceptado para M5 (22/11/2026), pendiente de la revisión del propietario.
> **Contexto de negocio (no cambia nada aprobado):** D3, D4, D5, C5, §6.2, §7.3 y §7.5 de la propuesta, más las decisiones del propietario para M5: D-M5-1 (pedido en `PENDING_PAYMENT` con el pago en `REQUIRES_PAYMENT`), D-M5-2 (`409 PRICE_CHANGED`), D-M5-3 (bloqueo fuera de horario salvo modo de demostración en la API), D-M5-4 (mínimo de ₡5 000 sobre el subtotal de productos, sin envío, en las dos modalidades), D-M5-5 (sin códigos promocionales en M5) y WebKit incremental (opción A).

## Contexto

M5 necesita decisiones técnicas internas que la propuesta no fija: dónde vive el motor de precios, cómo se identifica una línea, cómo se hace idempotente la fusión, cómo se detecta un cambio de precio y qué límites técnicos protegen la API. Ninguna cambia reglas de negocio ni el esquema de M2.

## Decisiones

### 1. Sin migraciones

El esquema de M2 alcanza: `Cart`, `CartItem` (CHECK 1–20), `CartItemOption`, `Order`, `OrderItem` (CHECK 1–20 y `lineTotal = (unit + opciones) × qty`), `OrderItemOption`, `OrderTaxLine`, `OrderStatusHistory`, `Payment`, `IdempotencyKey`, `Address` y `DeliveryZone`.

### 2. Motor de precios puro (`apps/api/src/modules/pricing/engine.ts`)

- Sin base de datos, red ni reloj. Enteros en la unidad menor, sin decimales.
- Algoritmo de §6.2:
  1. líneas;
  2. descuento por mayor resto;
  3. bases por tasa;
  4. impuesto incluido `round(base × r / (1 + r))` o sumado `round(base × r)`;
  5. half-up una vez por tasa y por pedido;
  6. total redondeado al incremento con la diferencia en `roundingAdjustmentMinor`.
- Una tasa aplica si está activa, si su `fulfillmentTypes` incluye la modalidad y, para productos, si el plato la tiene en `ProductTaxRate`. El envío entra en la base de las tasas `DELIVERY`/`BOTH`.
- **`roundingIncrementMinor`:** se lee de `RestaurantSettings`, que es la configuración real que el admin editará en M8. §6.2 lo describe también en `CURRENCIES` de `shared`; el código de M2 nunca lo puso ahí, y agregarlo crearía dos fuentes. Es una discrepancia documental, no una decisión nueva.
- `promotionDiscount` calcula un descuento de promoción, pero M5 no lo usa (D-M5-5): el pedido siempre lleva `discountMinor = 0`.

### 3. Identidad de línea y regla C5

- **Identidad:** `productId` + ids de opciones **ordenados y sin repetir** (`lineKey` en `shared`).
- La API maneja la **cantidad total** de cada identidad y la reparte en líneas internas de hasta 20 (`splitQuantity`) en la misma transacción. La interfaz nunca ve las líneas internas.
- Al editar, solo se reescriben las identidades que cambiaron; cada una conserva su posición.
- Toda escritura del carrito bloquea su fila (`SELECT … FOR UPDATE`).

### 4. Fusión idempotente

- Cada `mergeKey` fusionada se registra en `IdempotencyKey` (`scope = cart.merge:<userId>`, 30 días), además de `Cart.lastMergeKey`.
- **Problema detectado:** `lastMergeKey` solo guarda la última clave. Con la secuencia A → B → A, la segunda A volvería a sumar. Con el registro por clave no pasa: está probado con pruebas de integración de A → B → A y de fusiones simultáneas.
- La clave es por cuenta: la misma `mergeKey` en otra cuenta es otra fusión.
- Las líneas que no se pueden pedir no se guardan y vuelven en `unavailable[]` con su motivo. Lo que supera el tope técnico vuelve como `QUANTITY_LIMIT`.

### 5. Cambio de precio: huella de la cotización (D-M5-2)

- `quoteVersion` es un hash de:
  - moneda, modalidad y zona;
  - líneas (identidad, cantidad, precio unitario y total);
  - envío, descuento, impuestos y total.
- El cliente envía la huella que vio. Si la recalculada en la transacción es otra, la API responde `409 PRICE_CHANGED` con la cotización nueva en `details.quote` y no crea nada.
- **Alcance de "cambio de precio":** cubre cualquier diferencia entre lo aceptado y lo recalculado (precio, opciones, envío, impuestos o líneas). En todos esos casos, lo que se registraría no es lo que el cliente aceptó.

### 6. Idempotencia del pedido (§7.3, punto 1)

- `Idempotency-Key` (UUID) es obligatoria.
- `requestHash` = hash del cuerpo canónico.
- **Toma de la clave:** inserción con `lockedUntil` de 30 s.
  - Misma clave y cuerpo con respuesta guardada: la respuesta original (mismo estado y cuerpo).
  - Otro cuerpo u otra cuenta: `422 IDEMPOTENCY_KEY_REUSED`.
  - En curso: `409 IDEMPOTENCY_IN_PROGRESS`.
  - Un bloqueo vencido sin respuesta (caída) se toma una sola vez.
- La respuesta se guarda **en la misma transacción** que el pedido.
- Si la transacción falla, la clave se libera: nada quedó confirmado y el mismo intento puede repetirse.
- La web genera una clave por intento y la reusa solo para reintentar el mismo cuerpo.

### 7. Duplicados en 60 s (§7.3, punto 5)

- Antes de validar, la transacción (con el carrito bloqueado) busca un pedido `PENDING_PAYMENT` del mismo usuario de los últimos 60 s cuya huella, recalculada desde la copia histórica, sea la misma que la `quoteVersion` recibida. Si existe, responde 200 con `duplicate: true`.
- Funciona aunque el carrito ya se haya vaciado y aunque la clave sea otra (doble clic o dos pestañas).

### 8. Pedido sin pago (D-M5-1)

- El pedido se crea en `PENDING_PAYMENT`, con `OrderStatusHistory` inicial y `Payment` en `REQUIRES_PAYMENT` con montos en 0.
- El `method` es `DEMO_CARD`: la columna es obligatoria, y es el único método en línea previsto (M6). No hay contra entrega.
- `expiresAt` = 30 min (§7.1). El job que cancela es de M7.
- El carrito se vacía en la misma transacción.

### 9. Horario (D-M5-3)

- `isOpenAt` en la zona horaria de `RestaurantSettings`: la apertura cuenta, el cierre no.
- `ORDERS_ALLOW_OUTSIDE_HOURS` es una variable de la API, `false` por defecto, y solo acepta `true` o `false`. El navegador no la puede cambiar.
- La cotización informa `openNow` y `orderingAllowed` para avisar antes de confirmar.

### 10. Direcciones y zonas

- Solo se guardan direcciones de distritos cubiertos por una zona activa, comparados sin tildes, mayúsculas ni espacios. Se guarda el nombre de la zona.
- La tarifa y la ETA salen siempre de la zona vigente al cotizar y al confirmar.
- Una dirección ajena responde 404.
- El teléfono de contacto es obligatorio para el delivery y opcional para el retiro.

### 11. Límites técnicos (no son reglas comerciales)

| Límite | Valor | Por qué |
|---|---|---|
| Unidades totales de una identidad | 999 | Evita carritos de miles de filas. **No** es el tope de 20 de C5, que sigue siendo solo por línea interna |
| Identidades por carrito | 50 | Tamaño acotado de las peticiones y de la transacción |
| Direcciones por cuenta | 10 | Ídem |
| Cotizar y editar el carrito | 240 / 10 min por IP | La propuesta no fija límites para el carrito |
| Fusiones | 30 / 10 min por cuenta | Ídem |
| Crear pedidos | 20 / h por cuenta y 60 / h por IP | §8.4 solo fija los de pagos (M6) |
| Direcciones | 60 / h por cuenta | — |

### 12. Sesión para el invitado

- `GET /api/auth/session` responde `200 { user: null }` al invitado. El botón del pedido de las páginas públicas lo usa en lugar de `/auth/me`, que conserva su 401, para no registrar un error en la consola en cada página pública.
- Las páginas de la cuenta siguen usando `/auth/me`.

## Consecuencias

- La web nunca calcula importes que se cobren: muestra los de la API.
- `IdempotencyKey` crece con las claves de fusión y de pedidos. Tienen `expiresAt`, pero ningún job las borra todavía. La propuesta no lista esa limpieza entre los jobs de §4.3: queda como pendiente técnico, para agregarla junto a los barridos (M7) con aprobación.
- El contrato público del catálogo agrega `id` en cada plato (campo nuevo, compatible).
