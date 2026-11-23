# Contenido editorial · M4

> **Estado:** textos **aprobados** por el propietario el 13/11/2026 (instrucción "M4 · Optimización final y ajustes editoriales"). Los textos viven en `apps/web/app/i18n/locales/{es-CR,en}/site.json`. Cambiar un texto es editar ese archivo; no toca código ni datos.

## Criterios

- **Solo hechos aprobados.** Se usan el concepto de §1.1 (cevichería nikkei, Perú × Japón, Barrio Escalante, especialidades, pizarra de pesca del día), el eslogan, D4 (solo retiro y delivery propio, sin reservas) y la carta y la semilla de M2 (puertos, descripciones de las categorías).
- **No se inventa nada:** ni personas, ni años de fundación, ni premios, ni teléfono o correo. La página "Ubicación y horario" dice explícitamente que el restaurante de demostración no tiene contacto de atención.
- **Sin prometer pedidos reales:** la portada y "Ubicación y horario" describen el retiro y el delivery como la propuesta del restaurante. Hasta M4 aclaraban que la demostración no recibía pedidos; desde M5 (actualización autorizada por el propietario el 22/11/2026, solo `home.visitBody` y `visit.lead`) dicen que se puede registrar un pedido de demostración, sin pago ni compra real.
- **Sin servicio de mesa:** el local se presenta solo como punto de retiro (D4).
- **Español de Costa Rica con voseo** en los textos comerciales ("Pedís", "Conocé"), sin mezclar tuteo.
- **Inglés natural, no literal.** No se traducen "leche de tigre", "ají" ni los nombres de los platos (D2).
- **Honestidad sobre las fotos (§2.3, R7):**
  - el pie de cada plato dice "Foto de referencia: no muestra exactamente este plato";
  - el pie del sitio dice que las fotos son de referencia;
  - la foto 22 es de Oregón: su texto alternativo no dice que sea Costa Rica.
- **Etiqueta "Sin gluten":** la etiqueta `GLUTEN_FREE` de la base se muestra como "Sin gluten" / "Gluten-free" (§3.6). Solo la tienen las bebidas, según la auditoría de la carta de M2. No se afirma nada sobre contaminación cruzada.

## Plato de la casa (portada) · aprobado

**Ceviche clásico de corvina** (₡8 900, foto 02), aprobado como destacado de la portada el 13/11/2026.

- Se elige con la constante `FEATURED_PRODUCT_SLUG = 'ceviche-clasico'` en `apps/web/app/catalog/data.ts`. La base no tiene una marca de destacado y no se agrega (sin cambios de esquema ni de semilla).
- El precio, la disponibilidad y la descripción salen de la API (descripción aprobada en M2). La foto es la 02 aprobada, en 4:5. El enlace lleva a la página del plato.

## Cambios del 13/11/2026

**Aprobados por el propietario:**

| Clave | Antes (es-CR · en) | Ahora (es-CR · en) |
|---|---|---|
| `home.aboutTitle` | Una barra nikkei en San José · A nikkei bar in San José | Una cocina nikkei en San José · A nikkei kitchen in San José |
| `home.aboutCta` | Conocé la barra · Meet the bar | Conocé nuestra propuesta · Discover our concept |
| `home.visitBody` | Pedís en línea y lo retirás… · Order online and pick it up… | Ver tabla de textos |
| `about.craftTitle` | Oficio de barra · Bar craft | El oficio detrás de cada plato · The craft behind each dish |
| `visit.title` | Visítanos · Visit | Ubicación y horario · Location and hours |
| `visit.dineIn` | El salón es para conocer la barra… · The dining room is for… | Ver tabla de textos |
| en: "cevichería" | Nikkei cevichería | Nikkei ceviche restaurant (`home.eyebrow`, `home.metaTitle`, `product.metaDescription`, `about.metaDescription`) |
| en: `about.originBody` | …plus a little grill for those who prefer a warm dish. | …plus a few dishes from the grill for anyone who’d rather have something hot. |

**Correcciones de coherencia derivadas de esas decisiones** (para tu revisión):

| Clave | Ahora | Por qué |
|---|---|---|
| `nav.visit` | Ubicación y horario · Location and hours | El enlace de la barra nombra igual que el título de la página. "Visítanos" es tuteo. |
| `visit.metaTitle` | Ubicación y horario · Marea Baja · Location and hours · Marea Baja | Igual que el título de la página. |
| `visit.lead` | Estamos en Barrio Escalante. La propuesta contempla retiro en el local o delivery propio; esta demostración todavía no recibe pedidos. · We’re in Barrio Escalante. The concept offers pickup at the restaurant or our own delivery; this demo does not accept orders yet. | Decía "Pedís en línea", lo mismo que se corrigió en la portada porque M5 no está implementado. Reutiliza la redacción aprobada. |

## Textos

| Clave | es-CR | en | Respaldo |
|---|---|---|---|
| `home.eyebrow` | Cevichería nikkei · Barrio Escalante | Nikkei ceviche restaurant · Barrio Escalante | §1.1 (concepto, barrio) |
| `home.lead` | Ceviches, tiraditos, makis y bowls con lo que entró esta mañana desde los puertos del Pacífico costarricense. | Ceviches, tiraditos, maki rolls and bowls made with what arrived this morning from Costa Rica’s Pacific ports. | §1.1 especialidades; puertos de la semilla (M2) |
| `home.aboutTitle` | Una cocina nikkei en San José | A nikkei kitchen in San José | §1.1 |
| `home.aboutBody` | La cocina nikkei nace del encuentro entre Perú y Japón: la leche de tigre y el corte preciso. En Marea Baja la aplicamos a lo que trae el Pacífico costarricense cada mañana. | Nikkei cooking comes from Peru meeting Japan: leche de tigre and the precise cut. At Marea Baja we apply it to what Costa Rica’s Pacific brings in every morning. | §1.1 (Perú × Japón); carta de M2 |
| `home.aboutCta` | Conocé nuestra propuesta | Discover our concept | Aprobado |
| `home.visitTitle` | Retiro y delivery | Pickup and delivery | D4 |
| `home.visitBody` | La propuesta contempla retiro en el local o delivery propio dentro de nuestras zonas. En esta demostración podés armar y registrar un pedido, pero no es una compra real: el pago no está habilitado y el pedido no se prepara. | The concept offers pickup at the restaurant or our own delivery within designated areas. In this demo you can build and place an order, but it isn’t a real purchase: payment isn’t enabled and the order isn’t prepared. | D4; actualizado con M5 (22/11/2026) |
| `catch.intro` | Cada mañana anotamos qué pescado entró y de qué puerto viene. | Every morning we write down which fish came in and from which port. | §1.1 (pizarra de pesca del día) |
| `about.lead` | Una barra nikkei pensada como una carta impresa: pocos platos, bien cortados, con el pescado que entró hoy. | A nikkei bar designed like a printed menu: few dishes, cut well, with the fish that came in today. | §2.1 ("carta impresa de una barra nikkei") |
| `about.originTitle` | Perú y Japón en la misma tabla | Peru and Japan on the same board | §1.1 |
| `about.originBody` | La cocina nikkei nació del encuentro entre la cocina peruana y la japonesa: la leche de tigre, el ají y el corte al momento. Ese es el oficio de la barra: ceviches, tiraditos, crudos, makis y bowls, y algo de parrilla para quien prefiere un plato caliente. | Nikkei cooking was born where Peruvian and Japanese cooking met: leche de tigre, ají and the cut made to order. That’s the bar’s craft: ceviches, tiraditos, raw dishes, maki rolls and bowls, plus a few dishes from the grill for anyone who’d rather have something hot. | §1.1; categorías de la carta aprobada (M2) |
| `about.seaTitle` | Lo que trajo el mar hoy | What the sea brought in today | Eslogan aprobado (§1.1) |
| `about.seaBody` | La carta depende de la pesca. Cada mañana publicamos la pizarra con el pescado que llegó y su puerto: corvina de Puntarenas, pargo rojo del Golfo de Nicoya, atún de Quepos. Cuando algo no llega, el plato aparece como «Agotado hoy». | The menu depends on the catch. Every morning we publish the board with the fish that arrived and its port: corvina from Puntarenas, red snapper from the Gulf of Nicoya, tuna from Quepos. When something doesn’t arrive, the dish shows as “Sold out today”. | §1.1; puertos de la semilla (M2); estado "Agotado hoy" (§3.6) |
| `about.craftTitle` | El oficio detrás de cada plato | The craft behind each dish | Aprobado |
| `about.craftBody` | Cortamos al momento del pedido y aliñamos al final, para que el plato llegue fresco aunque viaje. Los bowls están pensados para el delivery. | We cut when you order and dress at the end, so the dish arrives fresh even when it travels. The bowls are designed for delivery. | Descripciones aprobadas de Ceviches, Crudos y Bowls (M2) |
| `about.demoTitle` | Un restaurante de demostración | A demo restaurant | Aviso de demo (§3.6) |
| `about.demoBody` | Marea Baja no existe: es un proyecto de portafolio. Los pedidos y pagos son simulados y ningún plato se prepara de verdad. | Marea Baja doesn’t exist: it’s a portfolio project. Orders and payments are simulated and no dish is actually prepared. | Aviso de demo (§3.6, §7.4) |
| `visit.title` | Ubicación y horario | Location and hours | Aprobado |
| `visit.lead` | Estamos en Barrio Escalante. La propuesta contempla retiro en el local o delivery propio. En esta demostración podés registrar un pedido de ejemplo, sin pago ni compra real. | We’re in Barrio Escalante. The concept offers pickup at the restaurant or our own delivery. In this demo you can place a sample order, with no payment and no real purchase. | §1.1, D4; actualizado con M5 (22/11/2026) |
| `visit.pickup` | Retiro en el local | Pickup at the restaurant | D4 |
| `visit.delivery` | Delivery propio dentro de nuestras zonas | Our own delivery within our areas | D4 |
| `visit.dineIn` | El local funciona únicamente como punto de retiro de pedidos. No ofrecemos servicio de mesa ni reservas. | The restaurant operates exclusively as a pickup location. We do not offer dine-in service or reservations. | D4, C12; aprobado |
| `visit.contactBody` | Al ser un restaurante de demostración, no tiene teléfono ni correo de atención. | As a demo restaurant, it has no customer phone line or email. | Sin datos de contacto aprobados |
| `footer.fictional` | Dirección ficticia de demostración: el barrio existe, el local no. | Fictional demo address: the neighbourhood exists, the restaurant doesn’t. | §1.1, S7 |
| `footer.demo` | Marea Baja es un restaurante ficticio. Las fotos son de referencia (Unsplash) y no muestran exactamente los platos. | Marea Baja is a fictional restaurant. Photos are for reference (Unsplash) and don’t show the exact dishes. | §2.3 (limitación de las fotos de stock), R7 |
| `photos.catch` | Pescados enteros y mariscos sobre hielo, vistos desde arriba. | Whole fish and seafood on ice, seen from above. | Foto 18 |
| `photos.craft` | Cuchillos de cocina junto a un plato servido, sobre una barra de madera. | Kitchen knives next to a plated dish on a wooden counter. | Foto 19 (recorte 3:2) |
| `photos.ingredient` | Media cebolla morada cortada, sobre fondo blanco. | Half a red onion, cut open, on a white background. | Foto 20 |
| `photos.coast` | Playa con un acantilado rocoso y árboles junto al mar. | Beach with a rocky headland and trees by the sea. | Foto 22 (Oregón: no se dice que es Costa Rica) |

Los textos de interfaz (navegación, filtros, estados, etiquetas, pie de foto, avisos) están en el mismo archivo y siguen las convenciones de M1 y M3.

## Pendiente de tu decisión

1. **"Barra" en "Nosotros".** `about.lead` ("Una barra nikkei pensada como una carta impresa") y `about.originBody` ("Ese es el oficio de la barra") siguen diciendo "barra". Vienen de §2.1 y se refieren al oficio, no al servicio de mesa, pero la portada cambió "barra" por "cocina". No se cambiaron porque no estaban en los ajustes aprobados.
2. **La URL `/visitanos`** (`/en/visit`) se mantiene: cambiarla toca rutas, sitemap y canónicas, y queda fuera de esta instrucción.
3. **"La carta depende de la pesca."** La disponibilidad la marca el personal (admin, M8), no la pizarra. Es correcta como relato, no como mecanismo.
