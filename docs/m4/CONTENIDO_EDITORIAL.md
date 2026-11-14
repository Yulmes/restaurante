# Contenido editorial · M4 (borrador para revisión del propietario)

> **Estado:** BORRADOR implementado y **pendiente de tu aprobación** (decisión del 13/11/2026: "Borrador para revisión"). Los textos viven en `apps/web/app/i18n/locales/{es-CR,en}/site.json`. Cambiar un texto es editar ese archivo; no toca código ni datos.

## Criterios

- **Solo hechos aprobados.** Se usan el concepto de §1.1 (cevichería nikkei, Perú × Japón, Barrio Escalante, especialidades, pizarra de pesca del día), el eslogan, D4 (solo retiro y delivery propio, sin reservas) y la carta y la semilla de M2 (puertos, descripciones de las categorías).
- **No se inventa nada:** ni personas, ni años de fundación, ni premios, ni teléfono o correo. La página "Visítanos" dice explícitamente que el restaurante de demostración no tiene contacto de atención.
- **Honestidad sobre las fotos (§2.3, R7):**
  - el pie de cada plato dice "Foto de referencia: no muestra exactamente este plato";
  - el pie del sitio dice que las fotos son de referencia;
  - la foto 22 es de Oregón: su texto alternativo no dice que sea Costa Rica.
- **Etiqueta "Sin gluten":** la etiqueta `GLUTEN_FREE` de la base se muestra como "Sin gluten" / "Gluten-free" (§3.6). Solo la tienen las bebidas, según la auditoría de la carta de M2. No se afirma nada sobre contaminación cruzada. El texto "Sin gluten a pedido" de M1 queda solo en los ejemplos de `/_design`.

## Plato de la casa (portada)

§2.4 pide que la portada muestre primero "la pesca del día y el plato estrella". La base no tiene una marca de destacado y el esquema no se cambia en M4, así que el plato se elige en una constante: `FEATURED_PRODUCT_SLUG` en `apps/web/app/catalog/data.ts`.

**Propuesta:** **Ceviche clásico de corvina** (₡8 900, foto 02). Es el ceviche base de la casa y su corvina viene de Puntarenas, el primer puerto de la pizarra semilla. Si preferís otro plato, es cambiar esa constante.

## Textos

| Clave | es-CR | en | Respaldo |
|---|---|---|---|
| `home.eyebrow` | Cevichería nikkei · Barrio Escalante | Nikkei cevichería · Barrio Escalante | §1.1 (concepto, barrio) |
| `home.lead` | Ceviches, tiraditos, makis y bowls con lo que entró esta mañana desde los puertos del Pacífico costarricense. | Ceviches, tiraditos, maki rolls and bowls made with what arrived this morning from Costa Rica’s Pacific ports. | §1.1 especialidades; puertos de la semilla (M2) |
| `home.aboutTitle` | Una barra nikkei en San José | A nikkei bar in San José | §1.1 |
| `home.aboutBody` | La cocina nikkei nace del encuentro entre Perú y Japón: la leche de tigre y el corte preciso. En Marea Baja la aplicamos a lo que trae el Pacífico costarricense cada mañana. | Nikkei cooking comes from Peru meeting Japan: leche de tigre and the precise cut. At Marea Baja we apply it to what Costa Rica’s Pacific brings in every morning. | §1.1 (Perú × Japón); carta de M2 |
| `home.visitTitle` | Retiro y delivery | Pickup and delivery | D4 |
| `home.visitBody` | Pedís en línea y lo retirás en el local o te lo llevamos dentro de nuestras zonas. El salón es para visitar la barra; no tomamos reservas. | Order online and pick it up at the restaurant, or we bring it to you within our delivery areas. The dining room is for visiting the bar; we don’t take reservations. | D4 (retiro, delivery propio; sin reservas) |
| `catch.intro` | Cada mañana anotamos qué pescado entró y de qué puerto viene. | Every morning we write down which fish came in and from which port. | §1.1 (pizarra de pesca del día) |
| `about.lead` | Una barra nikkei pensada como una carta impresa: pocos platos, bien cortados, con el pescado que entró hoy. | A nikkei bar designed like a printed menu: few dishes, cut well, with the fish that came in today. | §2.1 ("carta impresa de una barra nikkei") |
| `about.originTitle` | Perú y Japón en la misma tabla | Peru and Japan on the same board | §1.1 |
| `about.originBody` | La cocina nikkei nació del encuentro entre la cocina peruana y la japonesa: la leche de tigre, el ají y el corte al momento. Ese es el oficio de la barra: ceviches, tiraditos, crudos, makis y bowls, y algo de parrilla para quien prefiere un plato caliente. | Nikkei cooking was born where Peruvian and Japanese cooking met: leche de tigre, ají and the cut made to order. That’s the bar’s craft: ceviches, tiraditos, raw dishes, maki rolls and bowls, plus a little grill for those who prefer a warm dish. | §1.1; categorías de la carta aprobada (M2) |
| `about.seaTitle` | Lo que trajo el mar hoy | What the sea brought in today | Eslogan aprobado (§1.1) |
| `about.seaBody` | La carta depende de la pesca. Cada mañana publicamos la pizarra con el pescado que llegó y su puerto: corvina de Puntarenas, pargo rojo del Golfo de Nicoya, atún de Quepos. Cuando algo no llega, el plato aparece como «Agotado hoy». | The menu depends on the catch. Every morning we publish the board with the fish that arrived and its port: corvina from Puntarenas, red snapper from the Gulf of Nicoya, tuna from Quepos. When something doesn’t arrive, the dish shows as “Sold out today”. | §1.1; puertos de la semilla (M2); estado "Agotado hoy" (§3.6) |
| `about.craftTitle` | Oficio de barra | Bar craft | — |
| `about.craftBody` | Cortamos al momento del pedido y aliñamos al final, para que el plato llegue fresco aunque viaje. Los bowls están pensados para el delivery. | We cut when you order and dress at the end, so the dish arrives fresh even when it travels. The bowls are designed for delivery. | Descripciones aprobadas de Ceviches, Crudos y Bowls (M2) |
| `about.demoTitle` | Un restaurante de demostración | A demo restaurant | Aviso de demo (§3.6) |
| `about.demoBody` | Marea Baja no existe: es un proyecto de portafolio. Los pedidos y pagos son simulados y ningún plato se prepara de verdad. | Marea Baja doesn’t exist: it’s a portfolio project. Orders and payments are simulated and no dish is actually prepared. | Aviso de demo (§3.6, §7.4) |
| `visit.lead` | Estamos en Barrio Escalante. Pedís en línea para retirar o para que te lo llevemos. | We’re in Barrio Escalante. Order online for pickup or for us to bring it to you. | §1.1, D4 |
| `visit.pickup` | Retiro en el local | Pickup at the restaurant | D4 |
| `visit.delivery` | Delivery propio dentro de nuestras zonas | Our own delivery within our areas | D4 |
| `visit.dineIn` | El salón es para conocer la barra: no tomamos reservas ni pedidos para comer en el local desde la web. | The dining room is for getting to know the bar: we don’t take reservations or dine-in orders through the website. | D4, C12 |
| `visit.contactBody` | Al ser un restaurante de demostración, no tiene teléfono ni correo de atención. | As a demo restaurant, it has no customer phone line or email. | Sin datos de contacto aprobados |
| `footer.fictional` | Dirección ficticia de demostración: el barrio existe, el local no. | Fictional demo address: the neighbourhood exists, the restaurant doesn’t. | §1.1, S7 |
| `footer.demo` | Marea Baja es un restaurante ficticio. Las fotos son de referencia (Unsplash) y no muestran exactamente los platos. | Marea Baja is a fictional restaurant. Photos are for reference (Unsplash) and don’t show the exact dishes. | §2.3 (limitación de las fotos de stock), R7 |
| `photos.catch` | Pescados enteros y mariscos sobre hielo, vistos desde arriba. | Whole fish and seafood on ice, seen from above. | Foto 18 |
| `photos.craft` | Cuchillos de cocina junto a un plato servido, sobre una barra de madera. | Kitchen knives next to a plated dish on a wooden counter. | Foto 19 (recorte 3:2) |
| `photos.ingredient` | Media cebolla morada cortada, sobre fondo blanco. | Half a red onion, cut open, on a white background. | Foto 20 |
| `photos.coast` | Playa con un acantilado rocoso y árboles junto al mar. | Beach with a rocky headland and trees by the sea. | Foto 22 (Oregón: no se dice que es Costa Rica) |

Los textos de interfaz (navegación, filtros, estados, etiquetas, pie de foto, avisos) están en el mismo archivo y siguen las convenciones de M1 y M3.

## Qué revisar

1. ¿Los textos de "Nosotros", "Visítanos" y la portada representan bien a Marea Baja?
2. ¿Aprobás el Ceviche clásico de corvina como plato de la casa?
3. ¿Los textos en inglés suenan naturales?

Cualquier cambio es un ajuste de textos dentro de M4.
