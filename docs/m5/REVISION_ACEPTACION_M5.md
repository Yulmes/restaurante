# Revisión de aceptación de M5 · Pedido

> **Fecha:** 22/11/2026. Revisión de Nivel 1 en la rama `m5-pedido` (desde `7569f3a`). **No autoriza la integración.** Solo se corrigieron los dos textos editoriales autorizados. No se cambiaron dependencias, esquema ni reglas de negocio.

## 1. Corrección editorial autorizada

| Clave | Antes | Ahora |
|---|---|---|
| `home.visitBody` (es-CR) | La propuesta contempla retiro en el local o delivery propio dentro de nuestras zonas. Esta demostración todavía no recibe pedidos. | La propuesta contempla retiro en el local o delivery propio dentro de nuestras zonas. En esta demostración podés armar y registrar un pedido, pero no es una compra real: el pago no está habilitado y el pedido no se prepara. |
| `home.visitBody` (en) | The concept offers pickup at the restaurant or our own delivery within designated areas. This demo does not accept orders yet. | The concept offers pickup at the restaurant or our own delivery within designated areas. In this demo you can build and place an order, but it isn’t a real purchase: payment isn’t enabled and the order isn’t prepared. |
| `visit.lead` (es-CR) | Estamos en Barrio Escalante. La propuesta contempla retiro en el local o delivery propio; esta demostración todavía no recibe pedidos. | Estamos en Barrio Escalante. La propuesta contempla retiro en el local o delivery propio. En esta demostración podés registrar un pedido de ejemplo, sin pago ni compra real. |
| `visit.lead` (en) | We’re in Barrio Escalante. The concept offers pickup at the restaurant or our own delivery; this demo does not accept orders yet. | We’re in Barrio Escalante. The concept offers pickup at the restaurant or our own delivery. In this demo you can place a sample order, with no payment and no real purchase. |

- **Archivos:**
  - `apps/web/app/i18n/locales/es-CR/site.json` y `apps/web/app/i18n/locales/en/site.json`;
  - el registro editorial en `docs/m4/CONTENIDO_EDITORIAL.md` (filas y criterio).
- **Sin cambios en:** el eslogan, otras secciones y los metadatos SEO.
- **Verificación:** el HTML prerenderizado de `/`, `/en`, `/visitanos` y `/en/visit` trae los textos nuevos. axe sigue en 0 problemas serios o críticos en las páginas públicas (E2E del catálogo, 1280 y 375 px).

## 2. Avisos de `npm audit --omit=dev`

Los tres avisos son **uno solo** (GHSA-7589-6fvf-x4pw, CVE-2026-121707) contado en tres paquetes de la misma cadena.

| Campo | `effect` | `@prisma/config` | `prisma` |
|---|---|---|---|
| Vulnerabilidad | GHSA-7589-6fvf-x4pw: ReDoS en la expresión regular compilada de `Schema.TemplateLiteral` (CWE-1333) | La misma, heredada (depende de `effect`) | La misma, heredada (depende de `@prisma/config`) |
| Severidad | Alta en GitHub (CVSS 4.0: 8.7, solo disponibilidad). El repositorio de Effect la marca como moderada | Alta (heredada) | Alta (heredada) |
| Versión instalada | 3.20.0 | 7.10.1 | 7.10.1 |
| Cadena | `@marea-baja/api` → `prisma` (**devDependency**) → `@prisma/config` → `effect` | `prisma` → `@prisma/config` | `@marea-baja/api` (devDependency) |
| Versión corregida | 3.22.1 o superior en 3.x (la última 3.x es 3.22.5) | Ninguna 7.x publicada: `@prisma/config@7.10.1` **fija** `effect` en `3.20.0` exacto | Ninguna 7.x estable corregida (7.10.1 es la última 7.x; `latest` apunta a 8.0.0-rc, no estable) |
| Impacto en Marea Baja | Bajo. No está en el runtime de la API: ni `@prisma/client`, ni `@prisma/adapter-pg`, ni el cliente generado importan `effect`. Tampoco llega al paquete del navegador (verificado en el build; `@hookform/resolvers` solo lo declara como dependencia opcional y la web usa el resolvedor de Zod) | Ídem: solo lo carga la CLI al leer `prisma.config.ts` | Solo la CLI: `generate`, `migrate deploy`, `db:drift` y la semilla, en desarrollo, CI y despliegue |
| Explotabilidad | Muy baja en este proyecto. Exige decodificar **una entrada controlada por un atacante** con un `Schema.TemplateLiteral` de dos o más `Schema.String`. `@prisma/config` no usa `TemplateLiteral` (0 apariciones): valida la configuración con `Struct`, `String`, `optional` y similares. El paquete de la CLI incluye la clase, pero sus entradas son la configuración, los argumentos y las variables del desarrollador, no tráfico de red | Ídem | Ídem |
| Remediación recomendada | Esperar una versión 7.x de Prisma que actualice `effect`. Alternativa: un `overrides` de npm a `effect@3.22.5` | Ídem | No bajar a Prisma 6 |
| Riesgo de la remediación | `overrides`: bajo o medio (versión menor dentro de 3.x, pero Prisma fija 3.20.0 a propósito; habría que validar `generate`, `migrate`, `db:drift`, la semilla y las E2E). **`npm audit fix --force` bajaría a Prisma 6.12: alto**, porque rompe el ADR 0003 y la configuración de Prisma 7 | — | — |

**Otros hallazgos:**
- `npm audit --omit=dev` lista `prisma` aunque es una **devDependency** de `@marea-baja/api`: la auditoría de npm en workspaces no la excluye.
- `npm ls effect` marca `effect@3.20.0` como "invalid" para `@hookform/resolvers` (que declara la dependencia opcional `effect ^4`). Es una advertencia de árbol, no un uso real.

**Recomendación: aceptar temporalmente el riesgo, con mitigaciones, y esperar una actualización compatible de Prisma 7.**

- **Por qué:**
  - el código vulnerable no está en el runtime de la API ni del navegador;
  - la API nunca procesa entradas de red con `effect`;
  - la CLI solo recibe datos del propio proyecto.
- **Mitigaciones:**
  - no usar `effect` en código propio;
  - volver a revisar con cada versión de Prisma 7.x;
  - en M10, que la API desplegada se instale y ejecute sin la CLI cuando sea posible (`npm ci --omit=dev`, migraciones como paso aparte).
- **Si el propietario prefiere una auditoría limpia antes:** el `overrides` a `effect@3.22.5` es la opción menos invasiva. Requiere autorización (modifica `package.json` y el lockfile) y la batería completa de pruebas.

No se ejecutó `npm audit fix` ni se modificaron `package.json` ni el lockfile.

## 3. `Payment.method = DEMO_CARD`

| Punto | Resultado | Evidencia |
|---|---|---|
| No provoca un cobro | ✅ | `OrderService.#insertOrder` (`apps/api/src/modules/orders/service.ts`) solo crea la fila `Payment` (`REQUIRES_PAYMENT`, montos en 0). No hay código de autorización ni de captura en M5 |
| Ninguna solicitud a una pasarela | ✅ | No existe un módulo de pasarela ni llamadas de red en `orders`, `cart`, `addresses` ni `pricing`. No se escribe `PaymentOperation`, `PaymentAttempt` ni `MockGatewayTransaction` |
| No se piden datos de tarjeta | ✅ | El checkout (`routes/pedido/finalizar.tsx`) no tiene campos de pago. `createOrderRequestSchema` no acepta datos de pago (Zod descarta campos desconocidos) |
| No se guardan tarjeta, CVV ni datos sensibles | ✅ | El esquema `Payment` no tiene columnas para eso. Ninguna búsqueda de `card`, `cvv` o `cvc` en el código da resultados |
| `REQUIRES_PAYMENT` se conserva | ✅ | Integración: "crea el pedido en PENDING_PAYMENT…" (`amountAuthorizedMinor` y `amountCapturedMinor` en 0) y E2E: consulta directa a la base |
| El pedido queda en `PENDING_PAYMENT` | ✅ | Ídem, más `OrderStatusHistory` inicial |
| La interfaz no lo presenta como pagado | ✅ | Confirmación: "Pago: Pendiente: el pago no está habilitado en esta demostración". La API solo expone `payment.status`, nunca el método |
| Sin confirmación falsa de transacción ni recibo | ✅ | No hay recibo, factura ni correo de pago. La confirmación dice "no se cobró nada" |
| El usuario entiende que es una demo | ✅ | Banner permanente, aviso en el paso de pago, texto de la confirmación y, ahora, la portada y "Ubicación y horario" |
| Logs | ✅ | Los módulos del pedido no registran datos de pago; el log de peticiones de M3 ya redacta los encabezados sensibles |

**Observación para M6 (no resuelta, requiere decisión):**
- El `Payment` se crea con `DEMO_CARD` **al crear el pedido**, antes de que el cliente elija cómo pagar.
- Si M6 ofrece también contra entrega (`CASH_ON_DELIVERY`, §7.2 y §7.4), tendrá que cambiar el método de un pago ya creado, o crear el `Payment` al elegir el método. Las dos opciones son compatibles con el esquema (`method` no es único), pero conviene decidirlo al iniciar M6.

**Conclusión: correcto con observaciones.** Es seguro para la demo y no hay cobro, pasarela ni datos de tarjeta. La única observación es la anterior, sobre M6.

## 4. Revisión visual del checkout

**Método:** recorrido real con Playwright y Chromium (API y web locales), con capturas de página completa a 1440, 1024, 768 y 390 px de:
1. carrito vacío;
2. carrito con productos;
3. entrega (con validación y con dirección);
4. datos;
5. pago;
6. confirmación;
7. error de red;
8. cambio de precio;
9. producto agotado.

En cada pantalla se midió el desborde horizontal y se corrió axe (WCAG 2.2 AA). Las capturas quedan fuera del repositorio.

| Pantalla | 1440 | 1024 | 768 | 390 |
|---|---|---|---|---|
| Carrito vacío | ✅ | ✅ | ⚠️ D1 | ✅ |
| Carrito con productos | ✅ | ✅ | ⚠️ D1 | ⚠️ D2, D4 |
| Entrega | ✅ D3 | ✅ D3 | ⚠️ D1, D3 | ⚠️ D2, D3 |
| Datos | ✅ | ✅ | ⚠️ D1 | ⚠️ D2 |
| Pago | ✅ | ✅ | ⚠️ D1 | ⚠️ D2 |
| Confirmación demo | ✅ | ✅ | ⚠️ D1 | ✅ |
| Error de red | ✅ | ✅ | ⚠️ D1 | ⚠️ D2 |
| Cambio de precio | ✅ | ✅ | ⚠️ D1 | ⚠️ D2 |
| Producto agotado | ✅ | ✅ | ⚠️ D1 | ⚠️ D2, D4 |

En todas las pantallas y anchos: axe con 0 problemas serios o críticos. Teclado: el foco siempre es visible (contorno de 2 px) en el recorrido de la confirmación.

**Defectos encontrados (no corregidos: están fuera de lo autorizado):**

| ID | Defecto | Dónde | Severidad | Causa y propuesta |
|---|---|---|---|---|
| D1 | **Desborde horizontal de la barra a 768 px:** la página mide 783 px con el pedido vacío y 837 px con productos. "Pesca del día" y "Ubicación y horario" se parten en varias líneas | Barra de todas las páginas (`SiteHeader`). **Regresión de M5:** la causa es el botón "Pedido" | Media: scroll horizontal en tablet; no impide pedir | Mostrar la navegación completa desde `lg` o compactar el botón entre `md` y `lg`. Requiere autorización |
| D2 | **Desborde a 390 px con productos en el pedido** (396 px): el botón "Pedido · N · ₡X" se parte en dos líneas y empuja "Menú" fuera del borde | Barra en el celular. Regresión de M5 | Media: "Menú" queda cortado | Mostrar solo la cantidad en el celular, o mover el total a la hoja del menú. Requiere autorización |
| D3 | **Clic perdido al guardar una dirección después de un error:** al corregir el último campo, el aviso de error desaparece al salir del campo, el botón "Guardar la dirección" sube 26 px y el primer clic cae fuera. El segundo clic guarda | `AddressForm` (`apps/web/app/cart/addresses.tsx`), en el checkout y el perfil | Media-baja: no impide pedir, pero confunde | Mantener el espacio del aviso o validar solo al enviar. Requiere autorización |
| D4 | En el celular, el precio de una opción se parte ("(+" en una línea y "₡600)" en la siguiente) | Línea del carrito | Baja (cosmético) | `whitespace-nowrap` en el precio de la opción |

**Notas sobre las capturas:**
- En las capturas de página completa la barra fija aparece a mitad de la página: es un efecto de cómo se compone la captura, no un solapamiento real.
- El botón de la barra muestra el **subtotal de productos** y el checkout, el **total con envío**. Los dos están rotulados en su lugar, pero puede confundir. Lo dejo como observación.

## 5. WebKit

Las E2E del pedido pasan en `Mobile Safari` (3/3; motor WebKit de Playwright, no un iPhone real). Las fallas heredadas de M1–M4 en WebKit siguen como se documentó en `VALIDACIONES_M5.md` y no se corrigieron.
