# ADR 0009 · Admin: carta, configuración, moneda, clientes y auditoría

> **Estado:** propuesto con M8 (24/11/2026), implementación local en la rama `m8-admin`, pendiente de la revisión del propietario. No integrado en `main`.
>
> **Contexto de decisiones previas:** §12 (M8: "Dashboard (datos reales), carta con edición de traducciones (D2), clientes, configuración, moneda, impuestos configurables (D5), umbral de Turnstile (D8), auditoría; admin completo en ambos idiomas"), §3.6 (editor de plato con vista previa, pizarra editable), §6.1–6.2 (configuración, impuestos, asistente de moneda), §8.4 (límite de cambios del admin), §8.6 (AuditLog y UI de solo lectura), ADR 0008 (pantalla de reembolsos pendiente para M8).

## Contexto

M7 dejó el Pase para staff y admin, pero el resto del admin seguía sin existir: la carta, la configuración y los roles solo se cambiaban con la semilla o con scripts del propietario, y la auditoría no tenía pantalla. M8 completa el admin en es-CR y en sin cambiar el esquema de M2, que ya tenía todo lo necesario (`RestaurantSettings.version`, `TaxRate`, `DeliveryZone`, tablas de traducción, `CatchOfTheDay`, `User.blockedAt`, `AuditLog`).

## Decisiones del propietario al iniciar M8

- **D-M8-1 · Promociones fuera de M8.** §12 no las lista en M8 (la auditoría decía "M5/M8"). El motor de descuento existe sin conectar al checkout; queda sin hito asignado.
- **D-M8-2 · Fotos: solo el texto alternativo.** Subir fotos necesita Cloudinary, cuya cuenta se crea en M10 (D14). El editor edita el `alt` en es-CR y en.
- **D-M8-3 · Todo M8 es solo de ADMIN.** STAFF conserva el Pase (M7) y no ve el resto.
- **D-M8-4 · Moneda por tipo de cambio.** El asistente de §6.2 convierte con un tipo de cambio; los precios puntuales se ajustan después en el editor.

## Decisiones técnicas

### 1. API única del admin, montada detrás del resto

`modules/admin/routes.ts` se monta después de los routers de pagos (M6) y operación (M7): el Pase y las operaciones de pago responden antes con sus propias reglas de rol, y todo lo que llega al router del admin exige ADMIN (`requireRole('ADMIN')` sobre `/admin`). La web solo oculta; la protección real está en la API (§8.7).

### 2. Concurrencia optimista sin migraciones

- `RestaurantSettings` usa su `version` (`UPDATE … WHERE version = v`, 409 `RESOURCE_VERSION_CONFLICT`).
- Platos y categorías no tienen versión: se usa `updatedAt` como token (`updateMany … WHERE id AND updatedAt = token`). El editor lo devuelve en cada `PUT`; si otra persona guardó antes, 409 y no se pisa nada.
- Los grupos y opciones actualizan el `updatedAt` del plato, para que un editor abierto detecte el cambio.

### 3. Precios en el incremento de la moneda

Precios de platos, recargos de opciones y tarifas de zonas tienen que ser múltiplos de `roundingIncrementMinor` (CRC: colón entero), 400 `PRICE_INCREMENT`. Evita precios con céntimos que la carta mostraría redondeados.

### 4. Asistente de cambio de moneda (§6.2, punto 3)

En una sola transacción:

1. exige la versión vigente de la configuración;
2. después de tomar la fila de configuración, cuenta los pedidos activos y, si hay alguno, 409 `CURRENCY_CHANGE_BLOCKED`;
3. convierte precios, recargos, tarifas y pedido mínimo con el tipo de cambio en centésimas enteras (sin coma flotante), half-up, y los ajusta al incremento por defecto de la moneda nueva (CRC 100, USD 1);
4. registra `settings.currency_changed` con el tipo, el motivo y la cantidad de registros convertidos.

Los pedidos existentes conservan su moneda (§6.2, punto 2). El dashboard no suma pedidos de otra moneda: los cuenta aparte.

### 5. AuditLog

- Listas blancas nuevas: `product`, `category`, `optionGroup`, `option`, `catch`, `settings`, `taxRate`, `deliveryZone`. `user` ya tenía `blocked`.
- Un cambio de plato puede generar varias entradas, una por tipo que pide §8.6: `product.price_changed`, `product.availability_changed`, `product.activated`/`deactivated` y `product.updated` para el resto.
- El umbral de Turnstile tiene su propia acción (`settings.turnstile_threshold_changed`).
- La UI de auditoría es de solo lectura, con filtros por tipo, prefijo de acción y fechas locales, y paginada por cursor (§8.6, punto 4). No hay endpoints de edición.

### 6. Clientes: bloqueo y roles

- Bloquear marca `blockedAt` y revoca todas las sesiones abiertas en la misma transacción; el login ya rechazaba cuentas bloqueadas (M3).
- Los roles reutilizan el cambio de M3 (`replaceUserRoles`, con rotación de sesiones y AuditLog), ahora dentro de la transacción de la pantalla.
- Nadie se cambia a sí mismo (403 `ADMIN_SELF_CHANGE`) y siempre queda un ADMIN activo (409 `LAST_ADMIN`). Los cambios se serializan con `pg_advisory_xact_lock`: dos admins que se quitan el rol a la vez no dejan el local sin administración.
- Bloqueos y cambios de roles llevan motivo obligatorio (§8.6).

### 7. Límite de §8.4

Todos los cambios del admin comparten el límite "reembolsos y cambios de configuración (admin)" de 30 / 10 min por usuario, con la misma clave que los pagos (M6) y el Pase (M7). Al excederlo, 429 y `<entidad>.rate_limited` en el AuditLog. Se aplica también a la carta (D-M8-5, ver riesgos).

### 8. Dashboard con datos reales

- Lo primero que se lee es el trabajo pendiente y el enlace al Pase: §2.4 prohíbe un tablero de métricas antes del trabajo.
- Ventas = pedidos aceptados por el local (de `CONFIRMED` a `DELIVERED`) en el período, en la moneda activa; se restan los reembolsos parciales y los cancelados no cuentan (D-M8-6).
- Los períodos (hoy, 7 y 30 días) se cortan en la zona horaria del local.

### 9. Pesca del día

Se guarda o se publica la pizarra de hoy o de mañana; el pasado no se reescribe. Las horas se escriben en hora local. La portada muestra la última publicada (M4).

## Consecuencias

- El admin queda completo en es-CR y en, sin migraciones ni dependencias nuevas.
- **Pendiente para M10:** subida de fotos con Cloudinary (D-M8-2).
- **Pendiente sin hito:** promociones (D-M8-1).
- **Riesgos registrados en `docs/m8/VALIDACIONES_M8.md`.**
