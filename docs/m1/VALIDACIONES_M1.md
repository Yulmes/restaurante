# Validaciones de M1 · Sistema de diseño

> Fecha: 10/11/2026, actualizado el 13/11/2026 al cerrar los pendientes. Resultados obtenidos al ejecutar las pruebas, no estimados. Comandos en [TESTING.md](../../TESTING.md).

## Resumen

| ID | Validación (propuesta §3.10 y §15.3) | Resultado |
|---|---|---|
| V1 | Contraste real de componentes y estados con axe-core | ✅ 0 violaciones WCAG 2.2 AA en `/`, `/en`, `/_design` y `/en/_design`, también después de interactuar. axe encontró 2 problemas en la primera pasada; se corrigieron (ver abajo) |
| V3 | Glifos latinoamericanos y ₡ en ambas fuentes y pesos | ✅ con decisión: todo presente salvo **₡**, que no existe en ninguna de las dos tipografías. Resuelto con fuente de respaldo exclusiva (ADR 0002, decisión del propietario) |
| V4 | Formato de precios es-CR con `Intl.NumberFormat` frente al tablero | ✅ con diferencia documentada: CLDR da **"₡8 900"** (sin espacio tras ₡, espacio no separable entre miles); el tablero mostraba "₡ 8.900". Se aplica CLDR porque §4.5 fija `Intl`. En inglés: "₡8,900" |
| V5 | Legibilidad de precios y etiquetas a 375 px, en ambos idiomas | ✅ precios de 17 px, en una línea, sin superponerse al nombre, incluido el más largo (₡125 000) |
| — | Foco visible y no tapado, errores anunciados, deshabilitados con motivo | ✅ automatizado (teclado y árbol de accesibilidad) y ✅ **prueba con NVDA 2026.3 en Edge: 20/20 pasos**, con 1 problema corregido: [PRUEBA_NVDA.md](PRUEBA_NVDA.md) |
| V2 | Revisión de 引潮 | ✅ revisión documental con fuentes lingüísticas (13/11/2026). ⏳ La revisión por un hablante nativo sigue pendiente (antes de M10): [REVISION_HANKO.md](REVISION_HANKO.md) |
| D13 | Fotografías aprobadas una por una | ✅ **19 aprobadas** por el propietario. La 13 se aprobó y luego se descartó definitivamente (13/11/2026), sin reemplazo. [PRESELECCION_FOTOS.md](PRESELECCION_FOTOS.md) y [CREDITS.md](../../CREDITS.md) |

## V1 · Contraste (valores exactos)

| Par (texto / fondo) | Contraste | Nivel | Uso permitido |
|---|---|---|---|
| Tinta / Espuma | 12,71:1 | AA | Texto |
| Roca / Espuma | 4,90:1 | AA | Texto |
| Coral profundo / Espuma | 4,80:1 | AA | Texto |
| Tinta / Sal | 13,69:1 | AA | Texto |
| Espuma / Tinta | 12,71:1 | AA | Texto |
| Ají / Tinta (y Tinta / Ají) | 7,68:1 | AA | Texto |
| Tinta / Lima | 8,96:1 | AA | Texto |
| Espuma / Tinta 800 | 10,09:1 | AA | Texto |
| Espuma / Coral (sello) | 3,46:1 | AA grande | Gráfico o texto ≥ 24 px |
| Coral / Espuma | 3,46:1 | AA grande | Gráfico o texto ≥ 24 px |
| Ají / Espuma | 1,65:1 | No cumple | Nunca como texto |

La propuesta redondeaba algunos valores (por ejemplo, Ají / Tinta "7,6:1"). Los valores exactos cumplen igual el uso declarado.

**Problemas que axe encontró y se corrigieron:**

1. **WCAG 2.5.3 (el nombre accesible incluye la etiqueta visible):** el selector de idioma mostraba "ES" pero se anunciaba solo como "Español (Costa Rica)". Ahora el nombre accesible es "ES · Español (Costa Rica)", con la expansión oculta solo visualmente.
2. **Contraste en `/_design`:** el código HEX escrito sobre la muestra Coral (3,67:1 a 12 px) y los pies de las muestras sobre Tinta (2,59:1). El HEX pasó debajo de la muestra, sobre Sal, y los pies usan el token de texto secundario sobre oscuro.

**Lo que axe no mide** (revisado a mano con capturas): el anillo de foco es de 2 px, de Tinta sobre claro y de Ají sobre oscuro, y es visible en todos los estados. Todavía no hay texto sobre fotografías.

## V3 · Glifos (lectura de la tabla `cmap`)

| Fuente · peso | Latino | Latino extendido | Resultado |
|---|---|---|---|
| Shippori Mincho B1 · 600 | 39/40 | 0/40 | Falta ₡ → respaldo |
| Shippori Mincho B1 · 800 | 39/40 | 0/40 | Falta ₡ → respaldo |
| Zen Kaku Gothic New · 400 | 39/40 | 1/40 | Falta ₡ → respaldo |
| Zen Kaku Gothic New · 500 | 39/40 | 1/40 | Falta ₡ → respaldo |
| Zen Kaku Gothic New · 700 | 39/40 | 1/40 | Falta ₡ → respaldo |
| Noto Sans latin-ext · 400 y 700 (respaldo) | — | ₡ presente | ✅ |

Caracteres verificados: á é í ó ú Á É Í Ó Ú ñ Ñ ü Ü ¿ ¡ « » “ ” ‘ ’ — – · … ₡ $ . , 0–9.

En el navegador, `document.fonts` confirma que "Marea Colon" se carga solo con `unicode-range: U+20A1`, y que no se descarga ningún archivo japonés.

## Responsive (V5 y §3.8)

En 375, 768, 1024 y 1440 px, en es-CR y en: sin desborde horizontal, sin títulos, etiquetas, botones, enlaces ni precios cortados fuera de la pantalla. Capturas de página completa en `docs/evidencias/m1/` (8 archivos).

## Auditoría *finish gate* (design-ui-finish-gate-reviewer)

**Decisión: PASS** para el alcance de M1 (sistema y componentes base).

- **HOLD corregido:** el botón en estado "procesando" se angostaba, contra la regla §3.3 de mantener el ancho. Ahora conserva el ancho, y hay una prueba que lo verifica.
- **Se mantiene:** carta en lista editorial (no tarjetas), precio alineado con cifras tabulares, etiquetas con texto, bandas Tinta solo para marca, radios de 2 px, sin sombras ni gradientes decorativos.
- Las pantallas reales (inicio, carta, checkout, Pase) tienen su propio *finish gate* en sus hitos (M4, M5, M7 y M8).

## Auditoría con la skill Web Design Guidelines (D12)

Pautas descargadas el 10/11/2026 desde `vercel-labs/web-interface-guidelines`.

| Hallazgo | Archivo | Resolución |
|---|---|---|
| Falta `touch-action: manipulation` | `app/styles/app.css` | ✅ aplicado a enlaces, botones y campos |
| Falta un color de resaltado al tocar definido | `app/styles/app.css` | ✅ transparente (el foco visible marca la interacción) |
| Falta `meta theme-color` | `app/root.tsx` | ✅ `#EEF2EF` (Espuma) |
| Marca y nombres de platos sin `translate="no"` | `Logo.tsx`, `MenuLine.tsx` | ✅ aplicado (coherente con D2) |
| Apóstrofos rectos en inglés | `locales/en/*.json` | ✅ apóstrofos tipográficos |
| Falta espacio no separable entre número y unidad | `locales/*/design.json` | ✅ aplicado |
| Title Case en títulos y botones | — | ❌ no aplicado: contradice la ortografía española y la dirección editorial aprobada (D1) |
| Detectar el idioma desde el navegador | — | ❌ no aplicado: el idioma va por URL para el SEO por idioma (§4.2, D2) |
| Precargar fuentes críticas | — | ⏭ pospuesto a M9 (rendimiento) |
| `name` y `spellcheck` en campos | `TextField.tsx` | ⏭ lo define cada formulario real (M3 y M5); el componente ya los acepta |

## Pendientes que no bloquean el cierre técnico de M1

- **Revisión nativa de 引潮:** pendiente de un hablante nativo antes de M10. El sello no se cambió.
- **NVDA en M9:** el plan repite la prueba sobre las pantallas reales.
- **Peso de la fuente de respaldo:** unos 54 KB por peso solo para ₡. Recortarla a ~2 KB en M9.
- **Primera carga en blanco en desarrollo:** en modo SPA (`ssr: false` sin prerender) la página aparece cuando carga el JavaScript. El prerender de M4 entrega HTML completo a los visitantes.
