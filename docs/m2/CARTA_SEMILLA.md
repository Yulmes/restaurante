# Carta semilla · M2 (para revisión del propietario)

> **Estado:** propuesta de contenido cargada en la semilla (`apps/api/prisma/seed-data.ts`), **pendiente de tu revisión** (riesgo R18: "revisión de los textos de la carta en M2"). Cambiar un plato, un precio o un texto es editar ese archivo: no requiere migración.

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
| Ceviches / Ceviches | Ceviche clásico de corvina | — | ₡8 900 | Sin gluten | 02 | Punto del picante · Extras |
| | Ceviche nikkei | — | ₡9 600 | — | 01 | Punto del picante · Extras |
| | Ceviche mixto con chicharrón de calamar | — | ₡10 400 | — | 05 | Punto del picante · Extras |
| | Ceviche de pargo | — | ₡8 400 | Sin gluten | 03 | Punto del picante · Extras |
| Tiraditos / Tiraditos | Tiradito de pescado blanco | — | ₡8 700 | Sin gluten | 07 | Punto del picante |
| | Tiradito nikkei de atún y salmón | — | ₡9 900 | — | 08 | Punto del picante |
| | Tiradito al rocoto | — | ₡9 200 | Picante · Sin gluten | 09 | — |
| Crudos / Raw bar | Tártara de atún nikkei | — | ₡9 800 | Picante | 06 | — |
| | Langostinos crudos al ají amarillo | Raw prawns with ají amarillo | ₡11 500 | Sin gluten | 11 | — |
| Makis / Maki rolls | Maki acevichado | — | ₡7 900 | — | 14 | Salsa extra |
| | Maki furai de langostino | — | ₡8 200 | — | 15 | Salsa extra |
| Bowls / Bowls | Bowl nikkei de atún | — | ₡8 600 | — | 12 | Base |
| Calientes / From the grill | Pulpo a la parrilla | — | ₡12 400 | Sin gluten | 16 | — |
| | Pulpo anticuchero (**agotado hoy**) | — | ₡12 900 | Picante | 17 | — |
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

## Qué revisar

1. ¿Los platos y precios te parecen adecuados para la demo?
2. ¿Los textos en inglés suenan naturales? (R18)
3. ¿Querés cambiar el plato marcado como agotado?

Cualquier cambio es un ajuste de datos dentro de M2. Pendiente de tu respuesta.
