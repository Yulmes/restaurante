# Carta semilla · M2 (aprobada)

> **Estado:** **aprobada por el propietario el 13/11/2026** (riesgo R18 cerrado). Es el contenido cargado en la semilla (`apps/api/prisma/seed-data.ts`) e incluye los ajustes de la revisión: categorías en inglés, textos en inglés y auditoría de etiquetas. Cambiar un plato, un precio o un texto es editar ese archivo: no requiere migración, pero sí una nueva aprobación.

## Criterios

- **La carta se ajusta a las fotos aprobadas (R7).** Cada plato con foto describe lo que se ve en ella. De las 19 fotos aprobadas, 14 ilustran platos. Las otras 5 se reservan para las páginas públicas (M4):
  - 18 · pesca del día;
  - 19 · historia y oficio;
  - 20 · ingrediente;
  - 21 y 22 · marca y costa.
- **Nombres originales (D2, §4.5):** no se traducen. Solo llevan nombre en inglés los descriptivos (3 platos).
- **Precios:**
  - En colones, IVA 13 % incluido (D5) y redondeados al colón entero.
  - Rango de ₡7 900 a ₡12 900 en platos, coherente con una cevichería de barrio en San José.
  - Son **valores de demostración**: no salen de un estudio de mercado.
- **Origen del pescado:** puertos del Pacífico costarricense (Puntarenas, Golfo de Nicoya, Quepos). La identidad costarricense vive en los textos, porque ninguna foto es de Costa Rica.
- **Estado "Agotado hoy":** "Pulpo anticuchero" queda agotado, para mostrar ese estado con datos reales.
- **Fuera de la carta:** "Ceviche de pulpo al olivo" y "Tiradito nikkei de pulpo…", que aparecen en `/_design`, son solo ejemplos de componentes y no están en la carta.

## Platos

| Categoría (es / en) | Plato | Nombre en inglés | Precio | Etiquetas | Foto | Opciones |
|---|---|---|---|---|---|---|
| Ceviches / Ceviches | Ceviche clásico de corvina | — | ₡8 900 | — | 02 | Punto del picante · Extras |
| | Ceviche nikkei | — | ₡9 600 | — | 01 | Punto del picante · Extras |
| | Ceviche mixto con chicharrón de calamar | — | ₡10 400 | — | 05 | Punto del picante · Extras |
| | Ceviche de pargo | — | ₡8 400 | — | 03 | Punto del picante · Extras |
| Tiraditos / Tiraditos | Tiradito de pescado blanco | — | ₡8 700 | — | 07 | Punto del picante |
| | Tiradito nikkei de atún y salmón | — | ₡9 900 | — | 08 | Punto del picante |
| | Tiradito al rocoto | — | ₡9 200 | Picante | 09 | — |
| Crudos / Raw dishes | Tártara de atún nikkei | — | ₡9 800 | Picante | 06 | — |
| | Langostinos crudos al ají amarillo | Raw prawns with ají amarillo | ₡11 500 | — | 11 | — |
| Makis / Maki rolls | Maki acevichado | — | ₡7 900 | — | 14 | Salsa extra |
| | Maki furai de langostino | — | ₡8 200 | — | 15 | Salsa extra |
| Bowls / Bowls | Bowl nikkei de atún | — | ₡8 600 | — | 12 | Base |
| Calientes / Grilled dishes | Pulpo a la parrilla | — | ₡12 400 | — | 16 | — |
| | Pulpo anticuchero (**agotado hoy**) | — | ₡12 900 | — | 17 | — |
| Bebidas / Drinks | Chicha morada | — | ₡2 200 | Vegetariano · Sin gluten | — | — |
| | Limonada de hierbabuena | Mint lemonade | ₡2 000 | Vegetariano · Sin gluten | — | — |
| | Agua de pipa | Fresh coconut water | ₡1 800 | Vegetariano · Sin gluten | — | — |

Las descripciones completas en los dos idiomas y los textos alternativos de las fotos están en `seed-data.ts`.

## Grupos de opciones

| Grupo (es / en) | Regla | Opciones (precio adicional) |
|---|---|---|
| Punto del picante / Heat level | Elegir 1 (obligatorio) | Suave (por defecto) · Con ají limo · Rocoto, para valientes (+₡600) |
| Extras / Extras | Hasta 2 | Palta (+₡900) · Camote glaseado (+₡500) · Salsa chalaca (+₡700) |
| Salsa extra / Extra sauce | Hasta 2 | Acevichada (+₡400) · Anticuchera (+₡400) |
| Base / Base | Elegir 1 (obligatorio) | Arroz de sushi (por defecto) · Mezcla de hojas |

## Revisión del propietario (13/11/2026)

Sin cambios en los platos, precios, fotos, opciones, nombres originales, categorías en español, valores fiscales ni el plato agotado.

### Categorías en inglés

- Crudos: `Raw bar` → **`Raw dishes`**.
- Calientes: `From the grill` → **`Grilled dishes`**.

### Descripciones

Se revisaron las 17 en los dos idiomas. Cambios, solo donde hacía falta:

| Plato | Cambio | Motivo |
|---|---|---|
| Ceviche clásico de corvina | Se quitó "ají limo" de la descripción (es y en) | Contradecía el grupo "Punto del picante": el ají limo es una opción, y la opción por defecto es "Suave" |
| Ceviche mixto con chicharrón de calamar | en: "cancha corn" → "cancha (toasted corn kernels)" | Explica el ingrediente sin traducirlo |
| Tiradito de pescado blanco | en: "Slices of corvina" → "Thinly sliced corvina" | Más natural; describe la técnica del tiradito |
| Maki acevichado | en: "acevichada sauce" → "acevichada, a ceviche-style mayo" | Explica la salsa, como ya lo hace la opción "Acevichada (ceviche mayo)" |
| Maki furai de langostino | en: "Panko-fried roll … with" → "Panko-crusted fried roll … served with" | Más natural |
| Pulpo anticuchero | en: "ají panca anticuchera sauce" → "anticuchera sauce made from ají panca" | Evita encadenar tres modificadores |
| Limonada de hierbabuena | en: "tapa de dulce" → "tapa de dulce (unrefined cane sugar)" | Explica el ingrediente costarricense sin traducirlo |

Las otras 10 descripciones quedaron igual: son correctas y coinciden con sus fotos.

### Etiquetas

Regla aplicada: una etiqueta se mantiene solo si los ingredientes de la descripción y las opciones del plato la justifican. No se agregaron ingredientes ni garantías sobre contaminación cruzada.

| Plato | Antes | Ahora | Motivo |
|---|---|---|---|
| Ceviche clásico de corvina | Sin gluten | — | No se puede verificar: la receta de la leche de tigre y del glaseado del camote no está en los datos. La opción "Camote glaseado" tiene la misma duda |
| Ceviche de pargo | Sin gluten | — | No se puede verificar: falta la receta de la leche de tigre de ají amarillo y la del glaseado de la opción "Camote glaseado" |
| Tiradito de pescado blanco | Sin gluten | — | No se puede verificar: falta la receta de la leche de tigre |
| Tiradito al rocoto | Picante · Sin gluten | Picante | Picante se mantiene (rocoto, "picante de verdad"). Sin gluten no se puede verificar: falta la receta de la crema de rocoto, que en muchas recetas peruanas se espesa con galleta de soda |
| Langostinos crudos al ají amarillo | Sin gluten | — | No se puede verificar: falta la receta de la leche de tigre y del aceite de culantro |
| Pulpo a la parrilla | Sin gluten | — | No se puede verificar: falta la receta del puré de camote, del aceite de páprika y de la marinada de la parrilla |
| Pulpo anticuchero | Picante | — | El ají panca es suave y ahumado. Sin otro ají en la descripción, la etiqueta no corresponde |
| Tártara de atún nikkei | Picante | Picante | Se mantiene: jalapeño (visible en la foto) |
| Chicha morada, Limonada de hierbabuena, Agua de pipa | Vegetariano · Sin gluten | Vegetariano · Sin gluten | Se mantienen: todos sus ingredientes son simples y sin gluten |

Platos que ya no llevaban "Sin gluten" y siguen así, porque sus ingredientes lo impiden: Ceviche nikkei (soya), Ceviche mixto (chicharrón de calamar, normalmente enharinado), Tártara (ponzu, con soya), Maki acevichado (langostino empanizado), Maki furai (panko) y Bowl nikkei (shoyu).

Ningún plato es vegetariano: todos llevan pescado o mariscos.

**Dato que falta para recuperar "Sin gluten":** la ficha de receta de cada preparación base, con la marca de los productos procesados (salsas, caldos, glaseados). Con eso se puede volver a marcar, por ejemplo, el tiradito de pescado blanco o los langostinos si su leche de tigre no lleva soya ni caldo industrial con trigo.

**Nota para M4:** la interfaz de M1 usa el texto "Sin gluten a pedido" (`glutenFreeOnRequest`), mientras que la base guarda `GLUTEN_FREE`. Cómo se relacionan se decide en el hito de la carta pública.
