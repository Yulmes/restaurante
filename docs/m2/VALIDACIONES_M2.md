# Validaciones de M2 · Datos

> Fecha: 13/11/2026. Son resultados de ejecutar los comandos, no estimaciones. PostgreSQL 17.11 en Docker, Node 24.15 y Windows 10. Comandos en [TESTING.md](../../TESTING.md).

## Evidencia de cierre del plan (§12: "Tests de restricciones")

| Comprobación | Comando | Resultado |
|---|---|---|
| Migraciones sobre una base vacía | `npm run test:db` (recrea `marea_baja_test`) | ✅ 2 migraciones aplicadas |
| Esquema y migraciones sin diferencias | `npm run db:drift -w @marea-baja/api` | ✅ "No difference detected". Comprobado que falla (código 2) si se agrega un campo al esquema sin migración |
| Restricciones, AuditLog, permisos y semilla | `npm run test:db` | ✅ 71 / 71 |
| Datos semilla y enums frente a `shared` | `npm run test` | ✅ 14 / 14 (62 / 62 en total). Incluye la regla de etiquetas "Sin gluten" de la revisión de la carta |
| Semilla idempotente | Ejecutada 3 veces sobre la base de desarrollo, y otra vez dentro de `semilla.db.test.ts` | ✅ Los conteos no cambian (7 categorías, 17 platos, 36 opciones) |
| Configuración desde cero (como en CI) | Borrar el cliente generado y ejecutar `db:setup` y `test:db` | ✅ |
| Formato, lint, tipos | `npm run check` | ✅ |
| Sin regresiones en la web | `npm run test:e2e -w @marea-baja/web` y `build` | ✅ 41 pasan y 1 se omite (capturas); build OK |
| Dependencias | `npm audit --omit=dev` | ✅ 0 vulnerabilidades. Con las de desarrollo, sigue la moderada de `minimatch` aceptada en M0, sin cambios |

## Ajustes de la carta semilla (revisión del propietario, 13/11/2026)

Detalle en [CARTA_SEMILLA.md](CARTA_SEMILLA.md#revisión-del-propietario-13112026).

| Comprobación | Comando | Resultado |
|---|---|---|
| Platos, precios, fotos, opciones, configuración, impuestos y zonas sin cambios | Comparación de `seed-data.ts` con el commit `fe3bec7`, excluyendo descripciones, etiquetas y nombres de categoría en inglés | ✅ Idénticos (17 platos, 36 opciones) |
| La semilla aplica los cambios sobre una base ya cargada | `npm run db:seed -w @marea-baja/api` dos veces sobre `marea_baja` | ✅ Categorías en inglés y etiquetas actualizadas. Conteos, suma de precios (`14240000`), suma de opciones (`1360000`) e impuestos sin cambios |
| Base de datos | `npm run test:db` y `db:drift` | ✅ 71 / 71. Sin diferencias |

## Requisitos de M2 y dónde se verifican

| Requisito (propuesta) | Implementación | Verificación |
|---|---|---|
| Esquema Prisma completo (§6, §6.1) | 42 modelos y 18 enumeraciones | `prisma validate`, `db:drift` y tipos |
| Trigger del AuditLog (§8.6.3) | `audit_log_append_only`: UPDATE, DELETE y TRUNCATE | `auditoria.db.test.ts`: también falla para el propietario |
| Grants (§8.6.2) | `marea_app_rw`: solo SELECT e INSERT en `AuditLog` | `auditoria.db.test.ts`: *permission denied* para UPDATE, DELETE y TRUNCATE; sin cambios de esquema |
| Tablas de traducción (D2) | 4 tablas `…Translation`, únicas por entidad e idioma, sin es-CR | `restricciones.db.test.ts`, `semilla.db.test.ts` |
| `User.locale` y `emailVerifiedAt` (D2, D3) | Columnas en `User` | Esquema y tipos generados |
| Semilla de la carta en CRC, es-CR y en | `seed-data.ts`: 17 platos, todos traducidos | `seed-data.test.ts`, `semilla.db.test.ts` (lectura con Prisma como rol de la aplicación) |
| Valores fiscales de D5 | IVA 1300 bps incluido; servicio 1000 bps inactivo, solo `DINE_IN` | `seed-data.test.ts`, `semilla.db.test.ts` |
| Restricciones de §6.3 | Únicos, 33 CHECK e índices | `restricciones.db.test.ts` (49 casos) |
| Regla C5 en el almacenamiento | CHECK 1–20 por línea interna | 1 y 20 aceptados, 0 y 21 rechazados; 25 guardado como 20 + 5 |

## Lo que M2 no verifica (corresponde a otros hitos)

- La **división automática** en líneas de hasta 20 y la fusión idempotente del carrito (lógica de la API, M5; validación V11).
- Escribir el AuditLog en la misma transacción, la lista blanca de campos y el enmascarado (M3, M7, M8).
- El motor de precios e impuestos (M5).
- Los roles y la base en Neon (M10). Las pruebas usan PostgreSQL 17 local con un propietario superusuario. En Neon el propietario no es superusuario, y la creación del rol se verificará al desplegar.
