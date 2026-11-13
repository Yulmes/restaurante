# Base de datos

PostgreSQL 17 con Prisma 7 (ORM y migraciones). Diseño aprobado: propuesta §6, §6.1, §6.2, §6.3, §7 y §8. Decisiones técnicas: [ADR 0003](docs/adr/0003-prisma-y-roles-de-base-de-datos.md).

> **Estado (M2):** existen el esquema completo, las migraciones, los permisos, el trigger del AuditLog y la semilla. **Todavía no hay lógica que use los datos**: autenticación (M3), carta pública (M4), carrito y pedidos (M5), pagos (M6), operación (M7) y admin (M8) llegan en sus hitos.

## Archivos

| Archivo | Contenido |
|---|---|
| `apps/api/prisma/schema.prisma` | 42 modelos y 18 enumeraciones |
| `apps/api/prisma/migrations/…_esquema_inicial` | Tablas, claves, relaciones e índices (generada por Prisma) |
| `apps/api/prisma/migrations/…_restricciones_auditoria_y_permisos` | 33 CHECK, índice `lower(email)`, trigger del AuditLog y permisos (SQL escrito a mano) |
| `apps/api/prisma/seed-data.ts` / `seed.ts` | Datos semilla y su carga idempotente |
| `apps/api/prisma.config.ts` | Configuración de la CLI de Prisma |
| `apps/api/scripts/db-app-role.ts` | Crea el usuario de la API (local y CI) |
| `apps/api/src/db/client.ts` | Fábrica del cliente de Prisma con `@prisma/adapter-pg` |
| `apps/api/test/*.db.test.ts` | Pruebas contra PostgreSQL real |

## Comandos

Con PostgreSQL levantado (`npm run services:up`) y `.env` copiado de `.env.example`:

| Comando | Qué hace |
|---|---|
| `npm run db:setup` | Genera el cliente, aplica las migraciones, crea el usuario de la API y carga la semilla |
| `npm run db:migrate -w @marea-baja/api` | Aplica las migraciones pendientes (`prisma migrate deploy`) |
| `npm run db:app-role -w @marea-baja/api` | Crea o actualiza el usuario de la API y lo agrega a `marea_app_rw` |
| `npm run db:seed -w @marea-baja/api` | Carga la semilla. Se puede repetir sin duplicar |
| `npm run db:drift -w @marea-baja/api` | Falla si el esquema y la base migrada difieren |
| `npm run test:db` | Pruebas de restricciones, AuditLog, permisos y semilla en una base aparte (`marea_baja_test`) |

Para crear una migración nueva durante el desarrollo: `npx prisma migrate dev --name <nombre>` dentro de `apps/api`. Usa el rol propietario.

## Convenciones

- **Dinero:** enteros en la unidad menor ISO 4217 (`…Minor`): céntimos para CRC y centavos para USD. ₡8 900 = `890000`.
- **Tasas:** puntos básicos (`rateBps`): 1300 = 13,00 %.
- **Textos (D2):** el texto es-CR vive en la entidad principal y el inglés en `…Translation`, con una fila por idioma. Las traducciones no admiten `es-CR`.
- **Nombres de platos:** se conservan en su idioma original. `ProductTranslation.name` solo se usa para nombres descriptivos ("Langostinos crudos al ají amarillo" → "Raw prawns with ají amarillo").
- **Identificadores:** `uuid` generados por la base (`gen_random_uuid()`).
- **Copias históricas:** `OrderItem`, `OrderItemOption` y `OrderTaxLine` copian nombres, precios y tasas al crear el pedido. Un cambio posterior no altera pedidos pasados.
- **Idioma en la base:** el enum `Locale` guarda `es-CR` y `en`. En TypeScript, Prisma lo expone como `es_CR` / `en`.

## Modelos por área

| Área | Modelos |
|---|---|
| Identidad (§8) | `User` (con `locale` y `emailVerifiedAt`, D2/D3), `Role`, `UserRole`, `Session`, `EmailVerificationToken`, `PasswordResetToken`, `LoginLock`, `RateLimitCounter`, `Address` |
| Catálogo (§3.6, §4.5) | `Category`, `CategoryTranslation`, `Product`, `ProductTranslation`, `ProductImage`, `ProductOptionGroup`, `OptionGroupTranslation`, `ProductOption`, `OptionTranslation`, `CatchOfTheDay`, `CatchItem` |
| Configuración (§6.2) | `RestaurantSettings` (una fila), `OpeningHours`, `TaxRate`, `ProductTaxRate`, `DeliveryZone`, `Promotion` |
| Carrito (§7.5) | `Cart` (solo de cuentas, con `lastMergeKey`), `CartItem`, `CartItemOption` |
| Pedidos (§7.1) | `Order`, `OrderItem`, `OrderItemOption`, `OrderTaxLine`, `OrderStatusHistory` |
| Pagos (§7.2–7.4) | `Payment`, `PaymentAttempt`, `PaymentOperation`, `Refund`, `MockGatewayTransaction`, `IdempotencyKey` |
| Correo y auditoría (§8.5, §8.6) | `EmailOutbox` (con `locale`), `AuditLog` |

## Restricciones (§6.3)

Todas tienen una prueba en `apps/api/test/restricciones.db.test.ts` o `auditoria.db.test.ts`.

| Regla | Cómo se aplica |
|---|---|
| Correo único sin distinguir mayúsculas | Índice único `lower(email)` y CHECK sin espacios alrededor y con `@` |
| Slugs de plato y categoría, código de pedido, un pago por pedido | Índices únicos |
| Idempotencia | Única `(scope, key)` en `IdempotencyKey`; única `idempotencyKey` en `Refund` y `PaymentOperation` |
| **Regla C5:** hasta 20 unidades por línea interna | CHECK `quantity BETWEEN 1 AND 20` en `CartItem` y `OrderItem`. El total que gestiona el cliente no tiene tope: un total de 25 se guarda como 20 + 5 (lo reparte la API en M5) |
| Montos no negativos | CHECK en precios, recargos, tarifas y montos del pedido. Excepción: `roundingAdjustmentMinor` puede ser negativo, porque es la diferencia del redondeo |
| Total de la línea del pedido | CHECK `lineTotalMinor = (unitPriceMinor + optionsTotalMinor) × quantity` |
| Tasas | CHECK `rateBps BETWEEN 0 AND 10000`; un impuesto aplica al menos a un tipo de entrega |
| Pagos | CHECK `reembolsado ≤ capturado ≤ autorizado` (también en el procesador simulado) |
| Solo retiro y delivery (D4, C10) | `Order.fulfillmentType` usa un enum sin `DINE_IN`. `DINE_IN` existe solo como ámbito de `TaxRate` |
| Delivery con zona | CHECK: un delivery tiene zona y un retiro no |
| Una sola configuración | CHECK `id = 1` en `RestaurantSettings` |
| Coherencia | Horarios (día 0–6, apertura antes del cierre), grupos de opciones (mínimo ≤ máximo), promociones (tipo y valor coherentes, fin después del inicio), sesiones (inactividad ≤ vencimiento absoluto) |
| Índices de consulta | `Order(status, createdAt)`, `Order(userId, createdAt)`, `Product(categoryId, isActive)`, `AuditLog(entityType, entityId, createdAt)`, `RateLimitCounter(windowStart)`, `EmailOutbox(status, createdAt)` |

## AuditLog y permisos (§8.6)

1. El rol `marea_app_rw` solo tiene `SELECT` e `INSERT` sobre `AuditLog`. `UPDATE`, `DELETE` y `TRUNCATE` → *permission denied*.
2. El trigger `audit_log_append_only` rechaza `UPDATE`, `DELETE` y `TRUNCATE` **también para el propietario**.
3. Un usuario con entradas de auditoría no se puede borrar: la clave foránea es `RESTRICT`, así la traza no queda huérfana.
4. La aplicación no puede crear ni borrar tablas, quitar el trigger ni leer `_prisma_migrations`.

Pendiente para hitos posteriores: la escritura del AuditLog en la misma transacción que cada cambio, la lista blanca de campos y el enmascarado de correos (§8.6). Corresponden a los servicios que hacen esos cambios (M3, M7 y M8).

## Semilla

- **Carta:** 7 categorías, 17 platos, 36 opciones y 14 fotos de platos. Todo en es-CR y en. Se ajustó a las 19 fotos aprobadas (R7): ver [docs/m2/CARTA_SEMILLA.md](docs/m2/CARTA_SEMILLA.md), aprobada por el propietario el 13/11/2026 (R18). "Sin gluten" solo aparece donde los ingredientes permiten respaldarlo: hoy, en las bebidas.
- **Valores fiscales (D5):**
  - IVA 13 % incluido en los precios, sobre productos y envío, para retiro y delivery.
  - Cargo de servicio 10 %, **inactivo**, solo para `DINE_IN` (C10).
  - Son parámetros de demostración, no asesoría tributaria.
- **Configuración:**
  - Moneda CRC con redondeo al colón entero (100 céntimos) y pedido mínimo de ₡5 000.
  - Horario de martes a domingo y 3 zonas de delivery.
  - Umbral de Turnstile 50 fallos / 60 min (D8).
- **Otros:** los roles `CUSTOMER`, `STAFF` y `ADMIN`, y la pizarra de pesca del día de la fecha de carga.
- **Sin usuarios ni contraseñas:** las cuentas llegan en M3.
- **Fotos:** `ProductImage` guarda `provider = STATIC` y el nombre del archivo, nunca una URL (§9.4). Las variantes AVIF/WebP se generan en el hito de la carta (M4).
