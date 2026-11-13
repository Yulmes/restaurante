# Prueba con lector de pantalla NVDA · M1

> **Estado (13/11/2026):** ✅ **Completa.** Hay dos partes:
> - **Parte A, verificación automática** del árbol de accesibilidad: 3 problemas encontrados y corregidos.
> - **Parte B, prueba con NVDA real:** 20 pasos; 20 pasan, 0 fallan, 0 no aplican, después de corregir 1 problema.
>
> La prueba real la ejecutó Claude con NVDA instalado en modo portátil (el propietario lo pidió el 12/11/2026). Lo que NVDA dijo se tomó de su registro de voz, no de oído. Ver "Límites de la prueba".

## Parte A · Verificación automática

Archivos: `apps/web/e2e/screen-reader.spec.ts`, más `a11y.spec.ts` y `keyboard.spec.ts`. Corre en las 4 páginas (`/`, `/en`, `/_design`, `/en/_design`) con Chromium.

| Qué se verificó | Resultado |
|---|---|
| Un único h1 y encabezados sin saltos de nivel | ✅ (después de corregir los problemas 1 y 2) |
| Regiones: cabecera, navegación "Idioma"/"Language", contenido principal | ✅ |
| Enlace "Saltar al contenido": primero en el orden de tabulación y lleva al contenido | ✅ |
| Todo botón, enlace, campo, radio, checkbox e imagen tiene nombre accesible | ✅ |
| Los SVG decorativos están ocultos (`aria-hidden`) | ✅ |
| Enlaces de idioma con `lang`, para que NVDA cambie de voz | ✅ |
| Campo con error: `invalid` y mensaje como descripción | ✅ |
| Resumen de errores con `role="alert"` y enlaces a cada campo | ✅ |
| Botón deshabilitado: anuncia el motivo como descripción | ✅ |
| Botón "procesando": nombre "Procesando…" y `aria-busy` | ✅ |
| Contador de extras: región en vivo descrita por el grupo, con el límite aplicado | ✅ |
| Cantidad: anuncio con contexto | ✅ (después de corregir el problema 3) |
| Plato agotado: se anuncia "Agotado hoy", separado del precio, no solo con el tachado | ✅ (después de corregir el problema 4) |
| Foco visible y no tapado en cada elemento enfocable | ✅ |
| axe-core WCAG 2.2 AA (contraste incluido) | ✅ 0 violaciones |

## Parte B · Prueba con NVDA

**Entorno:**
- NVDA 2026.3, portátil, en español, con el sintetizador "sin voz".
- El registro de voz estaba en nivel "entrada/salida".
- Microsoft Edge 157 con un perfil temporal, en Windows 10 Pro 22H2.
- Página: `http://127.0.0.1:5173/_design` y `/en/_design`, con el servidor de desarrollo.

**Método:**
- Las teclas se enviaron a la ventana de Edge como pulsaciones reales del sistema, de modo que NVDA las interpreta igual que si las presionara una persona.
- Algunos pasos parten de un elemento con el foco puesto directamente; en la tabla figuran como "foco en…".
- La transcripción completa de lo que dijo NVDA está en [`docs/evidencias/m1/nvda-transcripcion.txt`](../evidencias/m1/nvda-transcripcion.txt).

| # | Acción | NVDA dijo (resumen fiel del registro) | Resultado |
|---|---|---|---|
| 1 | Cargar la página | "Sistema de diseño · Marea Baja" (título); "Cargando página… Carga completa" y empieza a leer | ✅ Pasa (ver observación A) |
| 2 | Foco en el primer enlace | "Saltar al contenido, misma página, enlace" | ✅ Pasa (ver observación B) |
| 3 | `Enter` en "Saltar al contenido" | "principal región… Sistema de diseño, encabezado, nivel 1" y sigue leyendo el contenido principal | ✅ Pasa |
| 4 | `H` repetido (estructura de encabezados) | h1 "Sistema de diseño"; h2 por sección; h3 "Paleta aprobada", "Revisá 2 datos…", "Ceviches", "Cargando la carta"; h4 para cada plato; sin saltos de nivel | ✅ Pasa |
| 5 | `D` repetido (regiones) | "título región", "Idioma, navegación región", "principal región" y cada sección como región con su nombre (Marca, Color… Movimiento) | ✅ Pasa |
| 6 | Navegación de idioma | "ES · Español (Costa Rica), enlace, actual" y "EN · English, enlace", con cambio de idioma de voz | ✅ Pasa (ver observación C) |
| 7 | `G` (gráficos) en "Marca" | "Marea Baja, gráfico" y "Sello 引潮 (hikishio, marea baja), gráfico" | ✅ Pasa |
| 8 | `B` hasta el botón deshabilitado | "Agregar al pedido, botón, no disponible, Elegí una salsa para continuar." | ✅ Pasa |
| 9 | Botón "Procesando…" | "Procesando…, botón, procesando" | ✅ Pasa |
| 10 | Campo Teléfono; `E` hasta el campo deshabilitado | "Teléfono, edición, entrada inválida, Escribí los 8 dígitos, por ejemplo 8812-3456."; "Provincia · deshabilitado, edición, no disponible" | ✅ Pasa |
| 11 | Resumen de errores | "Revisá 2 datos para continuar, encabezado nivel 3", lista de 2 enlaces | ✅ Pasa |
| 12 | `Enter` en "Teléfono: faltan dígitos" | El foco pasa al campo: "Teléfono, edición, entrada inválida…" | ✅ Pasa |
| 13 | `Tab` hasta "Punto del picante" | "Punto del picante, agrupación, Suave incluido, botón de opción, marcado, 1 de 3" | ✅ Pasa |
| 14 | Flecha abajo dentro del grupo | "Con ají limo incluido, botón de opción, marcado, 2 de 3" | ✅ Pasa |
| 15 | Foco en "Camote glaseado" y `Espacio` | "Extras, agrupación, Camote glaseado + ₡500, casilla de verificación, sin marcar"; al marcar: "Elegí hasta 2 · elegiste 2 de 2", "marcado" | ✅ Pasa |
| 16 | "Salsa chalaca" con el límite alcanzado | Con `Tab` se salta (no recibe foco); con flechas: "casilla de verificación, no disponible, sin marcar, Salsa chalaca + ₡700" | ✅ Pasa |
| 17 | "Agregar uno" y `Enter` | "Agregar uno, botón"; luego "Cantidad: 26" | ✅ Pasa |
| 18 | `4` hasta "Ceviche de pulpo al olivo" y flecha abajo | Antes: "₡10 200Agotado hoy" (pegado). **Después de la corrección:** "₡10 200, Agotado hoy" | ✅ Pasa (después de corregir el problema 4) |
| 19 | Precio "₡8 900" | Se entrega a la voz como "₡8 900" (símbolo y cifra) | ✅ Pasa (ver límites) |
| 20 | `/en/_design` | "Design system, encabezado, nivel 1", "Brand"…; el contenido, en inglés y con el idioma de voz en inglés (los roles los dice NVDA en su propio idioma) | ✅ Pasa (ver observación C) |

**Total:** 20 pasan, 0 fallan, 0 no aplican.

### Problema encontrado con NVDA y corregido

4. **Precio y estado del plato agotado se leían pegados.** NVDA recibía "₡10 200Agotado hoy" sin separación, porque la etiqueta oculta para lectores iba justo después del precio.
   - **Corrección:** `MenuLine` antepone ", " a la etiqueta "Agotado hoy", solo para lectores de pantalla. No cambia nada visible.
   - **Verificación:** se volvió a probar con NVDA y ahora dice "₡10 200, Agotado hoy". `screen-reader.spec.ts` también comprueba la separación.

(Los problemas 1 a 3 se encontraron en la Parte A; están descritos en la sección siguiente.)

### Problemas de la Parte A (ya corregidos)

1. **Nombres de plato al mismo nivel que su categoría.** En `/_design`, "Ceviches" era h3 y los platos también. `MenuLine` acepta ahora `headingLevel`; en la página de diseño los platos son h4. En la carta real (M4) la categoría será h2 y los platos h3.
2. **Resumen de errores con h2 dentro de una sección h2.** `ErrorSummary` acepta ahora `headingLevel`; en la página de diseño usa h3.
3. **La cantidad se anunciaba solo como "26".** Ahora la región en vivo dice "Cantidad: 26"; el prefijo es visible solo para lectores de pantalla.

### Observaciones (no son fallas)

- **A. Alerta al cargar `/_design`.** El resumen de errores de ejemplo tiene `role="alert"` y ya está en la página, así que NVDA lo anuncia al cargarla. Es propio del escaparate, que muestra todos los estados a la vez. En los formularios reales (M5) el resumen aparece solo al enviar con errores, que es cuando debe anunciarse. No se cambió.
- **B. `Ctrl+Inicio` y luego `Tab` lleva al enlace "ES", no a "Saltar al contenido".** Con `Ctrl+Inicio` el cursor de NVDA ya queda sobre "Saltar al contenido", que es el primer elemento, y `Tab` avanza al siguiente. Es el comportamiento normal de NVDA. Un `Tab` desde la barra de direcciones llega primero a "Saltar al contenido", como verifica `keyboard.spec.ts`.
- **C. "Inglés (no soportado)" / "Español (no soportado)".** Este aviso lo produce el sintetizador "sin voz" usado en la prueba, que no tiene voces por idioma. Confirma que NVDA detecta el cambio de idioma marcado con `lang`. Con una voz real (eSpeak u OneCore) cambiaría de voz.
- **D. Aviso de traducción de Edge en `/en/_design`.** Es una notificación del navegador, no de la página.

### Límites de la prueba

- La salida se leyó del registro de voz de NVDA, no se escuchó. Verifica qué texto, roles y estados entrega NVDA; no evalúa la pronunciación del sintetizador, como la forma de leer "₡8 900".
- Se probó un solo navegador (Edge, Chromium). Firefox y JAWS no están en el alcance de M1.
- **No aplica en M1:** navegación entre páginas de la tienda, diálogos o paneles (la hoja de producto es de M5), checkout real y pie de página con datos de contacto (M4).

### Resultado general

| Fecha | Versión de NVDA | Navegador | Pasan | Fallan | N/A | Observaciones |
|---|---|---|---|---|---|---|
| 12-13/11/2026 | 2026.3 (portátil) | Edge 157 | 20 | 0 | 0 | 1 problema corregido (precio y "Agotado hoy" pegados); 4 observaciones sin cambios |

### Cómo repetirla a mano

1. Instalá NVDA desde <https://www.nvaccess.org/download/>.
2. Ejecutá `npm run dev -w @marea-baja/web` y abrí `http://127.0.0.1:5173/_design` en Chrome o Edge.
3. Iniciá NVDA (`Ctrl + Alt + N`) y abrí Herramientas → **Visor de voz**.
4. Recorré los 20 pasos de la tabla.

Teclas: `Tab`, `H`, `1`–`4`, `D`, `B`, `E`, `G`, `NVDA + F7`, `Espacio`, `Enter`, flechas y `Escape`.
