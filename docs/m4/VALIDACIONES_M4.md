# Validaciones de M4 · Catálogo y SEO

> Fecha: 13/11/2026. Son resultados de ejecutar los comandos, no estimaciones. Entorno: PostgreSQL 17.11 y Mailpit 1.32 en Docker, Node 24.15, Windows 10, Chromium de Playwright 1.64. Comandos en [TESTING.md](../../TESTING.md).

## Alcance vigente (propuesta §12)

> **M4 · Catálogo y SEO:** API pública, páginas prerenderizadas en ambos idiomas, meta, OG, `hreflang`, JSON-LD, sitemap con alternativas, robots (D2). Precios y disponibilidad en tiempo real al hidratar (D10). Workflow de rebuild cada 30 min, configurable y sin ejecuciones innecesarias (D10). Evidencia de cierre: Lighthouse + validación de datos estructurados + validación de `hreflang`.

**Decisiones del propietario para este hito (13/11/2026):**
- textos editoriales y plato de la casa como borrador para revisión;
- página del plato informativa;
- `catalog-version` ahora y el workflow de rebuild en M10;
- filtros por etiqueta y búsqueda, sin orden.

Detalle en el [ADR 0005](../adr/0005-catalogo-prerender-e-imagenes.md).

## Evidencia ejecutada

| Comprobación | Comando | Resultado |
|---|---|---|
| Formato, lint, tipos y unitarias | `npm run check` | ✅ 118 / 118 (105 anteriores + 11 de M4 + 2 del recorte del ₡) |
| Integración con PostgreSQL real (M2, M3 y M4) | `npm run test:db` | ✅ 134 / 134 (123 anteriores + 11 de la API del catálogo) |
| Esquema y migraciones | `npm run db:drift -w @marea-baja/api` | ✅ Sin diferencias. **M4 no cambia el esquema** |
| E2E del catálogo y SEO sobre el **build de producción** | `npm run test:e2e:catalog -w @marea-baja/web` | ✅ 19 / 19 (también después de la optimización final y los textos aprobados) |
| Lighthouse sobre el build de producción (escritorio y móvil, 8 páginas, 3 corridas) | `npm run lighthouse -w @marea-baja/web` | ✅ Objetivos de categoría cumplidos en las 16 combinaciones, con los dos protocolos. **HTTP/1.1** (referencia histórica): ❌ LCP móvil de portada 3,10 s y plato 2,71 s. **HTTP/2** (`npm run lighthouse:h2`, referencia local de entrega): portada 1,65–1,66 s y plato 1,50–2,10 s, con las 12 corridas por debajo de 2,5 s. No es la validación definitiva (M10) |
| Hidratación sin errores y textos del idioma correcto | Script de Playwright sobre el build (14 páginas, escritorio y móvil) | ✅ Sin errores ni avisos en la consola y sin claves sin traducir. Cada página pública pide 2 fragmentos de textos; las de la cuenta, 3 |
| Build de producción con prerender | `npm run build -w @marea-baja/web` (con la API levantada) | ✅ 56 páginas (28 por idioma), sitemap con 56 URL, robots, `catalog-version.json` |
| Regresión de M1 | `npm run test:e2e -w @marea-baja/web` | ✅ 41 pasan y 1 se omite (capturas), igual que antes |
| Regresión de M3 | `npm run test:e2e:auth -w @marea-baja/web` | ✅ 14 / 14 |
| Dependencias de producción | `npm audit --omit=dev` | ✅ 0 vulnerabilidades. `sharp` es solo de desarrollo y no suma avisos |

### Qué prueban las E2E del catálogo

- **HTML crudo de 12 páginas** (6 por idioma):
  - `lang`, una sola canónica propia, `hreflang` es-CR / en / x-default;
  - Open Graph 1200×630, descripción y `h1` presentes antes de hidratar;
  - sin `noindex`.
- **JSON-LD que se puede parsear:**
  - `Restaurant` en la portada;
  - `Menu` en inglés con precios en CRC;
  - `MenuItem` del pulpo anticuchero con `SoldOut`.
- **Archivos de SEO:**
  - sitemap con 56 URL, cada una con su `x-default`, sin rutas de cuenta;
  - robots con el sitemap;
  - `catalog-version.json` igual a `GET /api/public/catalog-version`;
  - `noindex` en el HTML del fallback SPA.
- **Datos en vivo (D10):** un cambio de precio y disponibilidad en la base no cambia el HTML publicado (sigue ₡9 600), pero la página del plato y la carta muestran ₡9 950 y "Agotado hoy" al hidratar.
- **Pizarra de pesca del día** en vivo, con el hanko.
- **Carta:**
  - el filtro "Sin gluten" deja solo las 3 bebidas, se anuncia y el índice solo lista las categorías visibles;
  - la búsqueda ignora tildes y mayúsculas en los dos idiomas;
  - el estado vacío funciona;
  - a 375 px el primer plato se ve sin desplazarse, los filtros quedan plegados y no hay scroll horizontal.
- **Navegación:**
  - el selector de idioma conserva la página del plato;
  - el menú del celular es modal, se cierra con Escape y navega;
  - funcionan "Saltar al contenido" y el foco en `main`;
  - una ruta inexistente muestra la página de error.
- **axe:** 0 violaciones serias o críticas en las 12 páginas públicas, a 1280 y a 375 px, sin scroll horizontal.

## Lighthouse (13/11/2026)

**Herramienta:**
- `lighthouse` 13.6.0, como dependencia de desarrollo de `@marea-baja/web`. No cambia las dependencias de producción (`npm audit --omit=dev`: 0) ni suma avisos de desarrollo.
- Se descartó Lighthouse CI (`@lhci/cli`): agrega un servidor de resultados y aserciones que este proyecto no necesita.
- Navegador: el Chromium de Playwright que ya usan las E2E; no se descarga otro.

**Cómo reproducirlo:**
1. API levantada sobre la base de desarrollo con la semilla: `npm run start -w @marea-baja/api`.
2. Build con el mismo origen que se mide, para que las canónicas sean coherentes: `VITE_SITE_URL=http://127.0.0.1:4173 npm run build -w @marea-baja/web`.
3. Build servido como el hosting estático: `npm run preview -w @marea-baja/web`. Comprime con Brotli o gzip, como Cloudflare.
4. Medición: `npm run lighthouse -w @marea-baja/web`. Variables: `LH_BASE_URL`, `LH_RUNS`.
5. Salida: `apps/web/lighthouse-report/` (ignorado por git). Contiene `summary.json` y el informe HTML de la corrida mediana de cada página.

**Condiciones:**
- Windows 10, Node 24.15, Chromium de Playwright 1.64 (sin interfaz), todo en local.
- **Escritorio:** el preset `desktop` de Lighthouse (sin limitación de CPU ni de red simulada).
- **Móvil:** la configuración por defecto (emulación de un Moto G Power, CPU 4× y "slow 4G" simulados).
- **3 corridas** por página y dispositivo. Se informa la **mediana**, con el rango entre paréntesis cuando varía.
- Páginas: portada, carta, una categoría (Ceviches) y un plato (Ceviche clásico de corvina), en es-CR y en.

**Línea base, antes de la optimización final (mediana de 3 corridas):**

| Dispositivo | Página | Performance | Accessibility | Best Practices | SEO | LCP | CLS | TBT | Auditorías con peso por debajo de 0,9 |
|---|---|---|---|---|---|---|---|---|---|
| Escritorio | `/` | 100 | 100 | 100 | 100 | 0.70 s | 0.001 | 0 ms | — |
| Escritorio | `/en` | 100 | 100 | 100 | 100 | 0.69 s | 0.001 | 0 ms | — |
| Escritorio | `/carta` | 100 | 100 | 100 | 100 | 0.25 s | 0.006 | 0 ms | — |
| Escritorio | `/en/menu` | 100 | 100 | 100 | 100 | 0.25 s | 0.011 | 0 ms | — |
| Escritorio | `/carta/ceviches` | 100 | 100 | 100 | 100 | 0.25 s | 0.005 | 0 ms | — |
| Escritorio | `/en/menu/ceviches` | 100 | 100 | 100 | 100 | 0.25 s | 0.009 | 0 ms | — |
| Escritorio | `/carta/ceviches/ceviche-clasico` | 100 | 100 | 100 | 100 | 0.74 s | 0.001 | 0 ms | — |
| Escritorio | `/en/menu/ceviches/ceviche-clasico` | 100 | 100 | 100 | 100 | 0.74 s | 0.001 | 0 ms | — |
| Móvil | `/` | 93 | 100 | 100 | 100 | 3.25 s | 0.003 | 0 ms | largest-contentful-paint (0.71) |
| Móvil | `/en` | 93 | 100 | 100 | 100 | 3.25 s | 0.001 | 0 ms | largest-contentful-paint (0.71) |
| Móvil | `/carta` | 100 | 100 | 100 | 100 | 0.91 s | 0.002 | 0 ms | — |
| Móvil | `/en/menu` | 100 | 100 | 100 | 100 | 0.91 s | 0.001 | 0 ms | — |
| Móvil | `/carta/ceviches` | 100 | 100 | 100 | 100 | 0.91 s | 0.003 | 0 ms | — |
| Móvil | `/en/menu/ceviches` | 100 | 100 | 100 | 100 | 0.91 s | 0.001 | 0 ms | — |
| Móvil | `/carta/ceviches/ceviche-clasico` | 93 (90–93) | 100 | 100 | 100 | 3.18 s | 0.001 | 0 ms | largest-contentful-paint (0.73) |
| Móvil | `/en/menu/ceviches/ceviche-clasico` | 93 (90–93) | 100 | 100 | 100 | 3.18 s | 0.001 | 0 ms | largest-contentful-paint (0.73) |

**Contra los objetivos** (Performance ≥ 90, Accessibility, Best Practices y SEO ≥ 95):
- se cumplen en las **16** combinaciones;
- Accessibility, Best Practices y SEO dan 100 en todas;
- el mínimo de Performance es 93 (corridas entre 90 y 93), en la portada y el plato en móvil.

**Criterio de §11** ("LCP < 2,5 s en celular simulado, CLS < 0,1"):
- **CLS** se cumple en todas las páginas (≤ 0,011).
- **LCP en la carta** (0,91 s) se cumple.
- **LCP de la portada en móvil no se cumple:** 3,25 s, por encima de 2,5 s. Tampoco en la página del plato (3,18 s).
- En los dos casos el LCP es la foto 4:5 del plato.
- Lo que no es la causa (diagnóstico de Lighthouse):
  - la imagen se descubre en el HTML inicial;
  - tiene `fetchpriority=high`;
  - no usa carga diferida;
  - pesa 30 KB en AVIF.
- **Causa:** en la red simulada compite con unos 180 KB comprimidos de JavaScript que se precargan con prioridad alta. El más pesado es el paquete de i18n con los textos de todos los espacios y de los dos idiomas.
  - **Corrección posterior:** ese paquete pesaba unos 12 KB comprimidos. Lo más pesado eran React DOM y React Router con i18next, unos 140 KB, y las fuentes, unos 154 KB. Se ve en "Optimización final".

**Problemas encontrados y corregidos:**
1. **Primera medición sin compresión.** El servidor del build no comprimía. Lighthouse midió unos 600 KB de JavaScript sin comprimir, que en producción no existen, y la portada y el plato daban 78 y 79 en móvil, con LCP de 6 s.
   - Se agregó compresión Brotli o gzip a `scripts/serve-build.ts`, como hace el hosting.
   - Solo cambia el entorno de medición y de prueba, no el producto.
2. **Brotli a calidad 11** (la que trae Node por defecto) retrasaba la hidratación al comprimir al vuelo, y las E2E hacían clic antes de que la página respondiera. Se bajó a calidad 5, la habitual para compresión dinámica.
3. **Las E2E del catálogo** ahora esperan la hidratación antes de interactuar.
4. **`CATALOG_API_URL`:** el servidor de desarrollo evalúa la lista de rutas del prerender y la pedía siempre a la API del puerto 3000. Las E2E de identidad (API en el 3100) pasaban solo si había otra API corriendo en el 3000, así que en CI habrían fallado. Ahora, si `CATALOG_API_URL` falta, se usa `API_PROXY_TARGET`.

**Propuestas de esa medición:** el propietario autorizó las dos primeras (carga de textos por idioma y espacio; variante `card` de 720 px con `sizes` ajustado) y **no** el `preload`. El resultado está en la sección siguiente.

Las cifras de Lighthouse en local con red simulada son una referencia. La medición definitiva es sobre la URL pública con el CDN (M10).

**Riesgo de experiencia detectado:** hasta que React hidrata el HTML prerenderizado, los botones (filtros, menú del celular) todavía no responden. En la medición local la hidratación termina en menos de un segundo. En una red lenta puede notarse. Se registra para la revisión de M9.

## Optimización final (13/11/2026)

El propietario autorizó tres cambios: la carga de textos por idioma y espacio, una variante `card` de 720 px con `sizes` ajustado y los textos editoriales aprobados. **No autorizó el `preload`.**

**Qué cambió:**
- **i18n:**
  - el navegador ya no recibe los textos de los dos idiomas en el paquete inicial;
  - cada idioma y espacio (`common`, `site`, `account`, `design`) es un fragmento propio, de 0,7 a 2,6 KB comprimido;
  - el prerender sigue usando todos los textos, de forma síncrona (ADR 0005, §6).
- **Imágenes:**
  - `card` suma un ancho de 720 px;
  - la foto 4:5 de media columna usa un `sizes` con las medidas reales de la grilla;
  - en el celular emulado (412 px, densidad 1,75) el navegador elige `card-720.avif` (20,8 KB) en lugar de `card-960.avif` (30,2 KB).

**Resultado** (mediana de 3 corridas, en las mismas condiciones que la línea base; la flecha compara con ella):

| Dispositivo | Página | Performance | A11y | BP | SEO | LCP | LCP por corrida | CLS | TBT |
|---|---|---|---|---|---|---|---|---|---|
| Escritorio | `/` | 100 → **100** | 100 | 100 | 100 | 0,70 s → **0,63 s** | 0,63 / 0,63 / 0,66 | 0,001 | 0 ms |
| Escritorio | `/en` | 100 → **100** | 100 | 100 | 100 | 0,69 s → **0,63 s** | 0,71 / 0,63 / 0,63 | 0,001 | 0 ms |
| Escritorio | `/carta` | 100 → **100** | 100 | 100 | 100 | 0,25 s → **0,25 s** | 0,25 / 0,25 / 0,25 | 0,006 | 0 ms |
| Escritorio | `/en/menu` | 100 → **100** | 100 | 100 | 100 | 0,25 s → **0,25 s** | 0,25 / 0,25 / 0,25 | 0,011 | 0 ms |
| Escritorio | `/carta/ceviches` | 100 → **100** | 100 | 100 | 100 | 0,25 s → **0,25 s** | 0,25 / 0,25 / 0,25 | 0,005 | 0 ms |
| Escritorio | `/en/menu/ceviches` | 100 → **100** | 100 | 100 | 100 | 0,25 s → **0,25 s** | 0,25 / 0,25 / 0,25 | 0,010 | 0 ms |
| Escritorio | `/carta/ceviches/ceviche-clasico` | 100 → **100** | 100 | 100 | 100 | 0,74 s → **0,70 s** | 0,74 / 0,61 / 0,70 | 0,001 | 0 ms |
| Escritorio | `/en/menu/ceviches/ceviche-clasico` | 100 → **100** | 100 | 100 | 100 | 0,74 s → **0,61 s** | 0,61 / 0,61 / 0,61 | 0,001 | 0 ms |
| Móvil | `/` | 93 → **95** | 100 | 100 | 100 | 3,25 s → **2,94 s** | 2,94 / 2,94 / 2,94 | 0,000 | 0 ms |
| Móvil | `/en` | 93 → **95 (95–96)** | 100 | 100 | 100 | 3,25 s → **2,93 s** | 2,71 / 2,93 / 2,94 | 0,000 | 0 ms |
| Móvil | `/carta` | 100 → **100** | 100 | 100 | 100 | 0,91 s → **0,91 s** | 0,91 / 0,91 / 0,91 | 0,002 | 0 ms |
| Móvil | `/en/menu` | 100 → **100** | 100 | 100 | 100 | 0,91 s → **0,91 s** | 0,91 / 0,91 / 0,91 | 0,001 | 0 ms |
| Móvil | `/carta/ceviches` | 100 → **100** | 100 | 100 | 100 | 0,91 s → **0,91 s** | 0,91 / 0,91 / 0,91 | 0,003 | 0 ms |
| Móvil | `/en/menu/ceviches` | 100 → **100** | 100 | 100 | 100 | 0,91 s → **0,91 s** | 0,91 / 0,91 / 0,91 | 0,001 | 0 ms |
| Móvil | `/carta/ceviches/ceviche-clasico` | 93 (90–93) → **96 (95–96)** | 100 | 100 | 100 | 3,18 s → **2,71 s** | 2,71 / 2,71 / 3,01 | 0,000 | 0 ms |
| Móvil | `/en/menu/ceviches/ceviche-clasico` | 93 (90–93) → **96 (96–97)** | 100 | 100 | 100 | 3,18 s → **2,71 s** | 2,71 / 2,71 / 2,56 | 0,000 | 0 ms |

Una primera medición completa con el mismo código dio medianas en móvil muy parecidas: portada 2,94 s; plato 3,01 s en es y 2,71 s en en.

**Contra los objetivos:**
- **Performance ≥ 90; Accessibility, Best Practices y SEO ≥ 95:** se cumplen en las 16 combinaciones. El mínimo de Performance sube de 93 a 95.
- **CLS < 0,1:** se cumple en todas las páginas (≤ 0,011).
- **LCP < 2,5 s en móvil: sigue sin cumplirse** en la portada (2,94 s) ni en el plato (2,71 s).
  - Bajó 0,31 s en la portada y 0,47 s en el plato.
  - Ninguna de las 12 corridas de esas páginas quedó por debajo de 2,5 s. La mejor fue 2,56 s.

**Diagnóstico del LCP restante** (corrida mediana de la portada en móvil):

1. **Elemento LCP:** la foto 4:5 del Ceviche clásico (`card-720.avif`, 20,8 KB).
   - Se descubre en el HTML inicial y tiene `fetchpriority=high`.
   - Se pide a los 30 ms, junto con el JavaScript.
2. **Desglose observado** (sin limitación de red): TTFB 5 ms, retraso de carga 10 ms, carga 31 ms y retraso de render 88 ms.
   - Los 2,94 s del LCP salen de la **simulación** de "slow 4G", de unos 1,6 Mbit/s.
   - Esa simulación reparte el ancho de banda entre todo lo que se pide antes de la foto.
3. **Bytes que compiten con la foto** (comprimidos, con prioridad alta o máxima):

   | Recurso | KB | Detalle |
   |---|---|---|
   | JavaScript precargado | ≈ 170 | React DOM (`entry.client`, 64 KB) y React Router con i18next (`jsx-runtime`, 79 KB). El resto son rutas y componentes |
   | Fuentes | ≈ 154 | Noto Sans latin-ext 700: **59 KB solo para el símbolo ₡**. Shippori Mincho 600 y 800: 65 KB. Zen Kaku Gothic 400, 500 y 700: 30 KB |
   | CSS | 25 | |
   | Foto LCP | 21 | |
   | Fotos 19 y 22 (más abajo en la portada) | 54 | Tienen carga diferida, pero quedan dentro de la distancia en la que Chrome ya las pide |

4. **JavaScript antes de la imagen:** ningún script retrasa el descubrimiento de la foto, pero 170 KB se descargan en paralelo con ella. Los textos de i18n ya son solo 3,4 KB y se piden después.
5. **Diferencias entre corridas:**
   - La portada repite 2,94 s en casi todas las corridas.
   - El plato alterna entre 2,71 y 3,01 s, según cómo la simulación reparte las fuentes.
   - La portada tarda unos 0,2 s más que el plato por las dos fotos de más abajo.

**Propuesta** (no implementada; necesita autorización porque toca M1):

| Propuesta | Efecto estimado | Qué toca |
|---|---|---|
| **Recortar la fuente del ₡ a ese único glifo:** unos 2 KB en lugar de 59 KB. M1 ya la registró como mejora pendiente para M9 (`app/styles/fonts.ts`) | 57 KB menos en la ruta crítica, unos 0,3 s menos en la simulación. Por cálculo, el plato quedaría cerca de 2,4 s y la portada cerca de 2,65 s | Fuentes de M1. Sin cambio visual: es el mismo glifo |
| **Solo en la portada:** una variante `hero` de 720 px con `sizes` ajustado para las fotos 19 y 22, o retrasar su carga hasta que estén cerca de la pantalla | Entre 20 y 54 KB menos que compiten con la foto | Imágenes de M4 y portada |
| **Revisar los pesos de Shippori Mincho** (600 y 800) | Hasta 32 KB menos | Decisión de diseño de M1 |

Las estimaciones salen del ancho de banda simulado y no están medidas. El `preload` no ayudaría: la foto ya se pide a los 30 ms, con prioridad alta.

## Recorte de la fuente del ₡ (17/11/2026)

El propietario autorizó solo este cambio sobre M1, para intentar bajar el LCP móvil. No autorizó tocar fotos, Shippori Mincho ni el `preload`. El detalle técnico está en el ADR 0002 ("Actualización M4").

**Implementación:**
- **Recorte:** Noto Sans latin-ext (400 y 700) recortada con HarfBuzz (`subset-font` 2.9.0, dependencia de desarrollo; `npm run fonts:colon -w @marea-baja/web`).
  - Contiene solo `.notdef` y ₡ (U+20A1).
  - Conserva las tablas de copyright y licencia.
- **Peso:** 400: 55 640 → 848 B. 700: 59 144 → 852 B.
- **Integración:** `app/styles/fonts.ts`, con las mismas `@font-face`, la misma familia `Marea Colon` y el mismo `unicode-range`.
  - Vite incrusta los recortes como `data:` en el `<style>` del documento, así que ya no hay ninguna petición de Noto.
  - El HTML de cada página pesa unos 2,3 KB más, unos 1,7 KB comprimidos.

**Validación visual:**
- **Glifo:** en Chromium, el original y el recorte se dibujaron en 400 y 700, a 6 tamaños entre 14 y 200 px. Dieron **0 píxeles distintos**, con el mismo avance y las mismas métricas.
- **Páginas:** 11 páginas × escritorio (1350 px) y celular (412 px):
  - portada, carta, categoría y plato en es y en;
  - Nosotros, "Location and hours" y la cuenta.
- **Precios con ₡ revisados:** 1 en la portada, 17 en la carta, 4 en la categoría y 5 en el plato. Formatos "₡8 900" (es) y "₡8,900" (en).
- **Carga:** `Marea Colon` 700 queda `loaded` en las páginas con precios y `unloaded` en las que no tienen.
- **Errores:** 0 peticiones fallidas y 0 errores o avisos en la consola.

**Fuentes pedidas por página en móvil:**

| Página | Antes | Ahora |
|---|---|---|
| Con precios (portada, carta, categoría, plato) | Shippori 600 y 800, Zen Kaku 400, 500 y 700, Noto latin-ext 700: unos 154 KB | Las mismas 5, sin Noto: unos 95 KB. El ₡ va incrustado, unos 1,1 KB |
| Sin precios (Nosotros, Ubicación y horario) | 4–5 archivos, sin Noto | Igual |

**Resultado** (mediana de 3 corridas, mismas condiciones; la flecha compara con la medición anterior, de b1d8f81):

| Dispositivo | Página | Performance | A11y | BP | SEO | LCP | LCP por corrida | CLS | TBT | < 2,5 s |
|---|---|---|---|---|---|---|---|---|---|---|
| Escritorio | `/` | 100 → **100** | 100 | 100 | 100 | 0,63 → **0,67 s** | 0,65 / 0,67 / 0,67 | 0,001 | 0 ms | ✅ |
| Escritorio | `/en` | 100 → **100** | 100 | 100 | 100 | 0,63 → **0,67 s** | 0,67 / 0,67 / 0,67 | 0,001 | 0 ms | ✅ |
| Escritorio | `/carta` | 100 → **100** | 100 | 100 | 100 | 0,25 → **0,25 s** | 0,25 / 0,25 / 0,25 | 0,005 | 0 ms | ✅ |
| Escritorio | `/en/menu` | 100 → **100** | 100 | 100 | 100 | 0,25 → **0,25 s** | 0,25 / 0,25 / 0,25 | 0,011 | 0 ms | ✅ |
| Escritorio | `/carta/ceviches` | 100 → **100** | 100 | 100 | 100 | 0,25 → **0,25 s** | 0,25 / 0,25 / 0,25 | 0,005 | 0 ms | ✅ |
| Escritorio | `/en/menu/ceviches` | 100 → **100** | 100 | 100 | 100 | 0,25 → **0,25 s** | 0,26 / 0,25 / 0,25 | 0,010 | 0 ms | ✅ |
| Escritorio | `/carta/ceviches/ceviche-clasico` | 100 → **100** | 100 | 100 | 100 | 0,70 → **0,61 s** | 0,61 / 0,65 / 0,61 | 0,001 | 0 ms | ✅ |
| Escritorio | `/en/menu/ceviches/ceviche-clasico` | 100 → **100** | 100 | 100 | 100 | 0,61 → **0,61 s** | 0,61 / 0,61 / 0,61 | 0,001 | 0 ms | ✅ |
| Móvil | `/` | 95 → **94** | 100 | 100 | 100 | 2,94 → **3,09 s** | 2,98 / 3,09 / 3,10 | 0,000 | 30 ms | ❌ |
| Móvil | `/en` | 95 (95–96) → **94 (94–96)** | 100 | 100 | 100 | 2,93 → **3,08 s** | 3,08 / 2,78 / 3,10 | 0,001 | 0 ms | ❌ |
| Móvil | `/carta` | 100 → **100** | 100 | 100 | 100 | 0,91 → **0,91 s** | 0,91 / 0,91 / 0,91 | 0,002 | 0 ms | ✅ |
| Móvil | `/en/menu` | 100 → **100** | 100 | 100 | 100 | 0,91 → **0,91 s** | 0,91 / 0,91 / 0,91 | 0,001 | 0 ms | ✅ |
| Móvil | `/carta/ceviches` | 100 → **100** | 100 | 100 | 100 | 0,91 → **0,91 s** | 0,91 / 0,92 / 0,91 | 0,003 | 0 ms | ✅ |
| Móvil | `/en/menu/ceviches` | 100 → **100** | 100 | 100 | 100 | 0,91 → **0,91 s** | 0,91 / 0,91 / 0,91 | 0,001 | 0 ms | ✅ |
| Móvil | `/carta/ceviches/ceviche-clasico` | 96 (95–96) → **96** | 100 | 100 | 100 | 2,71 → **2,71 s** | 2,71 / 2,71 / 2,71 | 0,002 | 0 ms | ❌ |
| Móvil | `/en/menu/ceviches/ceviche-clasico` | 96 (96–97) → **96** | 100 | 100 | 100 | 2,71 → **2,71 s** | 2,71 / 2,71 / 2,71 | 0,001 | 0 ms | ❌ |

**¿Se cumple el LCP < 2,5 s en móvil?**

| Página | Antes | Ahora | Corridas | ¿Cumple? |
|---|---|---|---|---|
| Portada es | 2,94 s | 3,09 s | 2,98 / 3,09 / 3,10 | ❌ |
| Portada en | 2,93 s | 3,08 s | 3,08 / 2,78 / 3,10 | ❌ |
| Plato es | 2,71 s | 2,71 s | 2,71 / 2,71 / 2,71 | ❌ |
| Plato en | 2,71 s | 2,71 s | 2,71 / 2,71 / 2,71 | ❌ |
| Carta y categorías (es y en) | 0,91 s | 0,91 s | 0,91–0,92 | ✅ |

**Conclusión:** el recorte quita unos 58 KB por página con precios y deja el ₡ idéntico, pero **no bajó el LCP simulado**.
- **Plato:** igual mediana, ahora estable en las 3 corridas; antes alternaba 2,71 y 3,01 s.
- **Portada:** quedó unos 0,15 s peor.
  - El trabajo del hilo principal observado en esa corrida fue un 25 % mayor (`bootup` 542 ms contra 431 ms; estilo y layout 398 ms contra 304 ms), y la simulación lo multiplica por 4.
  - No se puede separar del ruido de la máquina: en esta corrida Docker Desktop estaba recién iniciado.
- **La estimación anterior** (cerca de 0,3 s menos) partía de un reparto de ancho de banda que no es el que domina, como muestra el diagnóstico siguiente.

**Diagnóstico actualizado:**
1. **El LCP simulado coincide con el TTI simulado.** Portada: LCP 2935 ms y TTI 2943 ms. Plato: los dos dan 2711 ms.
   - En la carga real sin limitación, la foto se pinta a los 134–195 ms, después de que se ejecuta el JavaScript.
   - Por eso la simulación pone en el camino del LCP toda la descarga del JS y su ejecución (con la CPU 4× más lenta), no solo la foto.
   - Las fuentes, que se piden en paralelo y más tarde, casi no cuentan.
2. **Medición de diagnóstico con limitación aplicada** (`throttlingMethod: devtools`, misma red y CPU, medida real en lugar de simulada; 3 corridas):
   - portada: LCP 3,86–3,90 s;
   - plato: 3,26–3,76 s;
   - carta: 2,06–2,59 s.
   - En la cascada, la foto (21 KB) se pide a los 690 ms, junto con 17 scripts (unos 175 KB) y el CSS (25 KB), todos con prioridad alta. Tarda **2,57 s en llegar**: es de lo último en terminar.
   - Las fuentes ya no compiten: se piden a los 2,7 s, después de procesar el CSS.
3. **El servidor local usa HTTP/1.1** (31 de 31 peticiones). La simulación de Lighthouse modela HTTP/1.1 con **6 conexiones TCP por origen**, cada una con su propio arranque lento. HTTP/2 lo modela con una sola conexión multiplexada.
   - En los primeros 100 ms se piden 20 recursos (232 KB) por esas 6 conexiones, y la foto queda en la cola detrás del JavaScript.
   - El hosting previsto (Cloudflare, M10) sirve con HTTP/2 o HTTP/3.
   - Es la misma clase de diferencia de entorno que la compresión que ya se corrigió en `serve-build`.

**Propuestas** (no implementadas; cada una necesita autorización):

| # | Propuesta | Qué se espera | Qué toca | Riesgo |
|---|---|---|---|---|
| 1 | **Servir el build local con HTTP/2 y TLS** (certificado local solo para medir), como el CDN. Medir otra vez las 16 combinaciones | Una medición representativa del hosting real. No cambia el producto. El efecto en el LCP no está medido | `scripts/serve-build.ts` y `scripts/lighthouse.ts` (entorno de medición) | Bajo. Hay que generar un certificado local y lanzar Chromium aceptándolo |
| 2 | **Fotos 19 y 22 de la portada:** variante `hero` de 720 px y `sizes` ajustado. Hoy son unos 54 KB que se piden antes del LCP en la simulación | Solo la portada, que está unos 0,2–0,4 s por encima del plato | Imágenes de M4 y portada | Bajo. Sin cambio visual a ese tamaño |
| 3 | **Menos JavaScript en la ruta crítica.** Por ejemplo, revisar qué se precarga en la portada y el plato (`useQuery` y `Tag` llegan antes de hacer falta) | Menos bytes que compiten con la foto y menos ejecución antes de pintarla | Arquitectura de la web | Medio. Necesita análisis antes de proponer cambios concretos |

Mi recomendación es empezar por la 1. Sin ella no se sabe cuánto del incumplimiento es del producto y cuánto del entorno local. El criterio de §11 se define sobre el celular simulado, y la medición definitiva es con la URL pública (M10).

## Sistema de medición: HTTP/1.1 y HTTP/2 (18/11/2026)

El propietario autorizó incorporar al proyecto el modo HTTP/2, después de la medición experimental del 17/11 (fuera del repositorio). Es infraestructura local de medición: **no cambia el producto**.

**Por qué:**
- `serve-build` servía solo HTTP/1.1, y Lighthouse modela HTTP/1.1 con 6 conexiones TCP por origen, cada una con su propio arranque lento.
- Cloudflare (M10) servirá con HTTP/2 o HTTP/3: una conexión multiplexada.
- Con el mismo build, la diferencia de LCP móvil es de más de 1 s. Es la misma clase de diferencia de entorno que la compresión que ya se corrigió.

**Los dos modos:**

| | HTTP/1.1 (referencia histórica) | HTTP/2 (referencia local de entrega) |
|---|---|---|
| Servir el build | `npm run preview -w @marea-baja/web` | `npm run preview:h2 -w @marea-baja/web` |
| Medir | `npm run lighthouse -w @marea-baja/web` | `npm run lighthouse:h2 -w @marea-baja/web` |
| Origen | `http://127.0.0.1:4173` | `https://127.0.0.1:4173` (TLS local) |
| Resultados | `apps/web/lighthouse-report/h1/` | `apps/web/lighthouse-report/h2/` |
| Protocolo exigido | `http/1.1` | `h2`, sin respaldo a HTTP/1.1 (`allowHTTP1: false`) |

**Lo que comparten los dos modos:**
- los mismos archivos de `build/client` y el `index.html` de cada ruta;
- el mismo fallback SPA y el mismo proxy de `/api`;
- la misma compresión (Brotli calidad 5 o gzip) y los mismos encabezados de contenido.

**Lo que cambia, solo en HTTP/2:** el proxy no reenvía los encabezados propios de la conexión (`connection`, `transfer-encoding`, …), porque HTTP/2 los prohíbe, y convierte `:authority` en `host`.

**Certificado local** (`apps/web/scripts/dev-cert.ts`, `npm run cert:dev -w @marea-baja/web`; `-- --renew` lo renueva a la fuerza):
- **Qué es:** autofirmado para `localhost` y `127.0.0.1`, clave EC P-256, SHA-256, `CA:FALSE` y uso exclusivo `serverAuth`. Se genera con `selfsigned` 5.5.0 (WebCrypto), dependencia de desarrollo.
- **Dónde vive:** `%LOCALAPPDATA%\marea-baja\dev-certs` en Windows, `~/.cache/marea-baja/dev-certs` en otros sistemas, o `DEV_CERT_DIR`. Está fuera del repositorio; `.gitignore` excluye además `*.pem` por si `DEV_CERT_DIR` apuntara adentro.
- **Clave privada:** queda en la carpeta del perfil del usuario y se escribe con permisos 0600.
- **Vigencia y renovación:** vale 30 días. Se regenera solo si falta, si vence en menos de 3 días, si no cubre los nombres o si la clave no coincide.
- **Quién lo acepta:**
  - no se instala en el almacén de confianza de Windows;
  - Chromium lo acepta solo por la huella de su clave pública (`--ignore-certificate-errors-spki-list`). Comprobado: sin la huella o con una ajena, Chromium lo rechaza con `ERR_CERT_AUTHORITY_INVALID`;
  - las comprobaciones de Node confían solo en ese certificado (`ca`). No se desactiva la validación TLS en ningún lado.

**Lighthouse** (`apps/web/scripts/lighthouse.ts`):
- **Condiciones de siempre:** Lighthouse 13.6.0, las 8 páginas, escritorio y móvil, 3 corridas y mediana.
- **Por corrida registra:**
  - el protocolo de cada respuesta y las conexiones, del registro de DevTools;
  - las cuatro categorías, el LCP, el FCP, el TTI, el CLS y el TBT;
  - los tiempos observados del documento, el CSS, la foto LCP (y su posición) y el JavaScript inicial.
- **Corridas inválidas:** si alguna respuesta del sitio no llegó con el protocolo del modo, la corrida queda marcada como inválida, no entra en la mediana y el comando termina con error. Los dos protocolos nunca se mezclan.
- **Comprobaciones previas:** si el build no responde, si la API no responde o si la API no llega a PostgreSQL, el comando lo dice y sugiere iniciar Docker Desktop. No inicia servicios por su cuenta.

**Validación del entorno (mismo build):**
- **Huella del build:** los 417 archivos de `build/client` tienen el mismo SHA-256 antes y después de las dos mediciones.
- **Respuestas iguales en los dos modos:** se comparó el estado, el tipo, la compresión y el contenido descomprimido de 24 rutas, con `br`, `gzip` y sin compresión: 72 respuestas.
  - Las rutas: las 8 páginas medidas, Nosotros, Ubicación y horario, `sitemap.xml`, `robots.txt`, `catalog-version.json`, la foto LCP, el favicon, 3 rutas de la cuenta, un 404 y 5 llamadas a la API.
  - 71 son idénticas, con los mismos bytes comprimidos.
  - La única diferencia es el error 400 de un idioma inválido: el cuerpo trae un `requestId` distinto en cada petición, también llamando a la API directo.
- **Proxy de `/api`:** carta en es y en, pizarra, horario y error 400 iguales en los dos modos.
- **Protocolo en Chromium** (portada, `/en`, carta, plato, "Location and hours" y cuenta):
  - modo HTTP/1.1: todas las respuestas `http/1.1`, por 6 conexiones;
  - modo HTTP/2: todas `h2`, por 1 conexión.
  - En los dos: 0 peticiones fallidas y 0 errores en la consola.
- **Sin respaldo a HTTP/1.1:** un cliente que solo ofrece HTTP/1.1 es rechazado en la negociación TLS (alerta `no_application_protocol`).
- **Lighthouse:** 0 corridas inválidas en los dos modos. Cada corrida HTTP/2 registró `h2` en 27–31 de 27–31 respuestas, por 1 conexión.

**Resultados** (mediana de 3 corridas; la flecha va de HTTP/1.1 a HTTP/2; ✅ significa que las 3 corridas quedan por debajo de 2,5 s):

| Dispositivo | Página | Performance | A11y·BP·SEO | LCP (mediana) | LCP por corrida | CLS | TBT | Conexiones |
|---|---|---|---|---|---|---|---|---|
| Escritorio | `/` | 100 → **100** | 100·100·100 → 100·100·100 | 0,67 ✅ → **0,44 s** ✅ | 0,67 / 0,67 / 0,67 → 0,44 / 0,44 / 0,44 | 0,001 → 0,001 | 0 → 0 ms | 6/6/6 → 1/1/1 |
| Escritorio | `/en` | 100 → **100** | 100·100·100 → 100·100·100 | 0,67 ✅ → **0,44 s** ✅ | 0,67 / 0,70 / 0,67 → 0,44 / 0,44 / 0,44 | 0,001 → 0,001 | 0 → 0 ms | 6/6/6 → 1/1/1 |
| Escritorio | `/carta` | 100 → **100** | 100·100·100 → 100·100·100 | 0,25 ✅ → **0,25 s** ✅ | 0,25 / 0,25 / 0,25 → 0,24 / 0,25 / 0,26 | 0,006 → 0,006 | 0 → 0 ms | 6/6/6 → 1/1/1 |
| Escritorio | `/en/menu` | 100 → **100** | 100·100·100 → 100·100·100 | 0,25 ✅ → **0,24 s** ✅ | 0,25 / 0,25 / 0,25 → 0,24 / 0,24 / 0,24 | 0,011 → 0,011 | 0 → 0 ms | 6/6/6 → 1/1/1 |
| Escritorio | `/carta/ceviches` | 100 → **100** | 100·100·100 → 100·100·100 | 0,25 ✅ → **0,24 s** ✅ | 0,25 / 0,25 / 0,25 → 0,24 / 0,24 / 0,24 | 0,005 → 0,005 | 0 → 0 ms | 6/6/6 → 1/1/1 |
| Escritorio | `/en/menu/ceviches` | 100 → **100** | 100·100·100 → 100·100·100 | 0,25 ✅ → **0,24 s** ✅ | 0,25 / 0,25 / 0,25 → 0,24 / 0,24 / 0,24 | 0,010 → 0,010 | 0 → 0 ms | 6/6/6 → 1/1/1 |
| Escritorio | `/carta/ceviches/ceviche-clasico` | 100 → **100** | 100·100·100 → 100·100·100 | 0,65 ✅ → **0,44 s** ✅ | 0,61 / 0,65 / 0,65 → 0,44 / 0,44 / 0,44 | 0,000 → 0,001 | 0 → 0 ms | 6/6/6 → 1/1/1 |
| Escritorio | `/en/menu/ceviches/ceviche-clasico` | 100 → **100** | 100·100·100 → 100·100·100 | 0,65 ✅ → **0,44 s** ✅ | 0,65 / 0,65 / 0,61 → 0,44 / 0,44 / 0,44 | 0,000 → 0,001 | 0 → 0 ms | 6/6/6 → 1/1/1 |
| Móvil | `/` | 94 → **99** | 100·100·100 → 100·100·100 | 3,10 ❌ → **1,66 s** ✅ | 3,10 / 3,08 / 3,10 → 1,66 / 2,10 / 1,65 | 0,003 → 0,003 | 0 → 89 ms | 6/6/6 → 1/1/1 |
| Móvil | `/en` | 94 (92–94) → **99** | 100·100·100 → 100·100·100 | 3,10 ❌ → **1,65 s** ✅ | 3,10 / 3,09 / 3,39 → 1,80 / 1,65 / 1,65 | 0,000 → 0,001 | 0 → 91 ms | 6/6/6 → 1/1/1 |
| Móvil | `/carta` | 100 → **100 (98–100)** | 100·100·100 → 100·100·100 | 0,91 ✅ → **0,90 s** ✅ | 0,91 / 0,91 / 0,91 → 0,90 / 0,90 / 0,91 | 0,002 → 0,002 | 0 → 14 ms | 6/6/6 → 1/1/1 |
| Móvil | `/en/menu` | 100 → **100** | 100·100·100 → 100·100·100 | 0,91 ✅ → **0,90 s** ✅ | 0,91 / 0,91 / 0,91 → 0,90 / 0,90 / 0,90 | 0,001 → 0,001 | 0 → 0 ms | 6/6/6 → 1/1/1 |
| Móvil | `/carta/ceviches` | 100 → **100** | 100·100·100 → 100·100·100 | 0,91 ✅ → **0,90 s** ✅ | 0,91 / 0,91 / 0,91 → 0,90 / 0,91 / 0,90 | 0,002 → 0,003 | 0 → 1 ms | 6/6/6 → 1/1/1 |
| Móvil | `/en/menu/ceviches` | 100 → **100** | 100·100·100 → 100·100·100 | 0,91 ✅ → **0,90 s** ✅ | 0,91 / 0,91 / 0,91 → 0,90 / 0,90 / 0,90 | 0,001 → 0,001 | 0 → 1 ms | 6/6/6 → 1/1/1 |
| Móvil | `/carta/ceviches/ceviche-clasico` | 96 → **100 (99–100)** | 100·100·100 → 100·100·100 | 2,71 ❌ → **1,50 s** ✅ | 2,71 / 2,71 / 2,71 → 1,50 / 1,50 / 2,10 | 0,002 → 0,002 | 0 → 5 ms | 6/6/6 → 1/1/1 |
| Móvil | `/en/menu/ceviches/ceviche-clasico` | 96 → **99 (99–100)** | 100·100·100 → 100·100·100 | 2,71 ❌ → **2,10 s** ✅ | 2,71 / 2,71 / 2,71 → 2,10 / 1,50 / 2,10 | 0,001 → 0,001 | 0 → 7 ms | 6/6/6 → 1/1/1 |

**Tiempos de solicitud en móvil** (observados sin limitación; el LCP y el TTI son los simulados):

| Modo | Página | Corrida | Posición de la foto | Foto (observado) | JS inicial (observado) | LCP simulado | TTI simulado |
|---|---|---|---|---|---|---|---|
| HTTP/1.1 | `/` | 1 | 20 de 31 | 22 → 65 ms | 17 · 172 KB · fin 62 ms | 3,10 s | 3,11 s |
| HTTP/1.1 | `/` | 2 | 20 de 31 | 20 → 50 ms | 17 · 172 KB · fin 45 ms | 3,08 s | 3,09 s |
| HTTP/1.1 | `/` | 3 | 20 de 31 | 19 → 53 ms | 17 · 172 KB · fin 47 ms | 3,10 s | 3,10 s |
| HTTP/1.1 | `/carta/ceviches/ceviche-clasico` | 1 | 19 de 27 | 49 → 74 ms | 16 · 171 KB · fin 74 ms | 2,71 s | 2,71 s |
| HTTP/1.1 | `/carta/ceviches/ceviche-clasico` | 2 | 19 de 27 | 64 → 120 ms | 16 · 171 KB · fin 113 ms | 2,71 s | 2,71 s |
| HTTP/1.1 | `/carta/ceviches/ceviche-clasico` | 3 | 19 de 27 | 14 → 41 ms | 16 · 171 KB · fin 40 ms | 2,71 s | 2,71 s |
| HTTP/2 | `/` | 1 | 20 de 31 | 17 → 26 ms | 17 · 169 KB · fin 43 ms | 1,66 s | 1,66 s |
| HTTP/2 | `/` | 2 | 20 de 31 | 18 → 73 ms | 17 · 169 KB · fin 84 ms | 2,10 s | 2,10 s |
| HTTP/2 | `/` | 3 | 20 de 31 | 19 → 29 ms | 17 · 169 KB · fin 44 ms | 1,65 s | 1,65 s |
| HTTP/2 | `/carta/ceviches/ceviche-clasico` | 1 | 19 de 27 | 31 → 39 ms | 16 · 168 KB · fin 54 ms | 1,50 s | 1,50 s |
| HTTP/2 | `/carta/ceviches/ceviche-clasico` | 2 | 19 de 27 | 38 → 51 ms | 16 · 168 KB · fin 62 ms | 1,50 s | 2,17 s |
| HTTP/2 | `/carta/ceviches/ceviche-clasico` | 3 | 19 de 27 | 32 → 42 ms | 16 · 168 KB · fin 53 ms | 2,10 s | 2,10 s |

**Lectura:**
- **HTTP/1.1:** igual que las mediciones anteriores (portada 3,10 s, plato 2,71 s). La foto espera una conexión libre detrás de 19 recursos.
- **HTTP/2:** portada 1,65–1,66 s y plato 1,50–2,10 s.
  - **Las 12 corridas de portada y plato quedan por debajo de 2,5 s.** La peor es 2,10 s.
  - El experimento del 17/11 dio 2,10 s en las cuatro medianas, con los mismos valores posibles (1,50–1,65 o 2,10).
- **Bimodalidad:**
  - Si la foto termina de llegar antes que el JavaScript inicial, el LCP queda en 1,50–1,65 s. En una corrida del plato llegó a separarse del TTI: 1,50 s contra 2,17 s.
  - Si termina casi junto con el último script, la simulación la pone después del JavaScript y el LCP queda en 2,10 s.
  - El margen que hay que considerar es el del peor caso: **0,4 s**.
- **El JavaScript sigue definiendo el LCP** en la mayoría de las corridas (LCP = TTI). Con HTTP/2 baja porque el JavaScript termina antes, no porque la foto se independice de él.
- **La portada y el plato** quedan iguales con HTTP/2: las fotos 19 y 22 se piden después del LCP.
- **Escritorio:** LCP de 0,67 a 0,44 s en la portada y de 0,65 a 0,44 s en el plato. Todo en 100.

**Qué representa cada medición:**
- **HTTP/2 es la referencia local de entrega:** es el protocolo con el que servirá Cloudflare.
- **HTTP/1.1 se conserva como referencia histórica.** Todas las cifras anteriores de este documento están medidas con HTTP/1.1.
- **El criterio de §11 no se declara cumplido** con una medición local.

**Limitaciones de la medición local:**
- La red y la CPU son simuladas a partir de una carga en `127.0.0.1`, sin latencia real.
- El servidor comprime al vuelo con Brotli de calidad 5; Cloudflare puede usar otro nivel.
- Hay TLS con un certificado local, sin el 0-RTT ni la reanudación de sesión que puede tener el CDN.
- No se mide HTTP/3.
- La simulación es bimodal en esta página: 1,50–1,65 o 2,10 s según el orden de llegada.

**Validación prevista en Cloudflare (M10):**
1. Desplegar el build en Cloudflare Pages con Workers y la URL pública definitiva. `VITE_SITE_URL` apunta a esa URL.
2. Confirmar en DevTools que la entrega es `h2` o `h3`, con Brotli. Confirmar también que no hay funciones de Cloudflare que inyecten scripts, como Rocket Loader o la analítica automática.
3. Correr PageSpeed Insights, que usa Lighthouse en móvil con slow 4G simulado, 3 o más veces sobre la portada y un plato, y registrar cada corrida. Si se quiere comparar con estas cifras, correr también `LH_BASE_URL=https://<sitio> npm run lighthouse:h2` contra la URL pública.
4. El criterio de §11 se da por cumplido solo si el LCP móvil queda por debajo de 2,5 s en todas las corridas de la portada y el plato.

## Verificación manual en el navegador (13/11/2026)

Con la API y la web en desarrollo, y después con el build servido como en producción:

- **Portada:**
  - eslogan, plato de la casa con foto 4:5, pizarra de pesca del día (banda Tinta con hanko) y lista de la carta por técnica;
  - el `article` del plato termina en 943 px y la pizarra empieza en 999 px: no hay huecos.
- **Carta:** con el filtro "Sin gluten" quedan las 3 bebidas y se anuncia "3 platos coinciden.".
- **Pulpo anticuchero:** "Agotado hoy", precio tachado y nota.
- **Ceviche clásico en inglés:** opciones con su precio adicional, pie de foto honesto y precio "₡8,900" (formato de M1 en inglés).
- **A 375 px:**
  - en la carta, el primer plato estaba en 886 px (por debajo de la pantalla). **Se corrigió** plegando búsqueda y filtros; ahora está en 705 px, con el precio visible;
  - el menú del celular abre como hoja modal con el foco adentro.
- **Build de producción en inglés:** hidrata sin errores en la consola.
- **Problemas encontrados y corregidos:**
  - un botón dentro de un enlace en la portada;
  - el índice de categorías enlazaba secciones ocultas por los filtros;
  - el fallback SPA no tenía `noindex` en el HTML crudo;
  - tres textos alternativos no describían el recorte real (fotos 19, 20 y 22).

## Requisitos y dónde se verifican

| Requisito | Implementación | Verificación |
|---|---|---|
| API pública (§4.2) | `/api/public/catalog`, `catalog-version`, `catch-of-the-day`, `opening-hours` | Integración (`catalogo.db.test.ts`): orden y precios de la semilla, traducciones, respaldo es-CR marcado, sin inactivos ni datos internos, idioma inválido → 400 |
| Precios en vivo (D10) | La carta se lee en cada petición; la web la superpone al hidratar | Integración y E2E |
| `catalog-version` en memoria (R20) | Hash de los datos publicados | Integración: no cambia sin una lectura de la carta; no depende del idioma |
| Prerender bilingüe | `react-router.config.ts` + `loader` | Build (56 páginas) y E2E del HTML crudo |
| Meta, OG, `hreflang`, canónicas | `app/site/seo.ts` | Unitarias y E2E |
| JSON-LD | Restaurant, Menu, MenuItem | Unitarias y E2E (parseo) |
| Sitemap y robots | `scripts/seo-files.ts` | Unitarias y E2E |
| Imágenes AVIF/WebP (§9.4) | `scripts/build-images.ts`, `StaticProvider` | Build; E2E de carga; revisión visual |
| Navegación (§3.5) y contratos de pantalla (§2.4) | `SiteLayout`, portada, carta, plato | E2E y revisión en el navegador |
| Accesibilidad (D1) | Componentes de M1 | axe a 2 anchos y en los 2 idiomas |

## Lo que no se verificó o queda pendiente

| Tema | Motivo |
|---|---|
| **LCP móvil de la portada y del plato** (§11: < 2,5 s) | **Pendiente de validar en Cloudflare (M10).** Con HTTP/1.1 local no se cumple: línea base 3,25 s y 3,18 s; después de i18n e imágenes, 2,94 s y 2,71 s; después del recorte del ₡, 3,10 s y 2,71 s. Con HTTP/2 local, como servirá el CDN, se cumple en las 12 corridas (portada 1,65–1,66 s, plato 1,50–2,10 s), con un margen de 0,4 s en el peor caso. El procedimiento de M10 está en "Sistema de medición" |
| **Validadores externos** de datos estructurados (Rich Results Test, Schema Markup Validator) | Son servicios externos y requieren una URL pública (M10). Se validó que el JSON-LD se parsea y tiene los tipos y campos de schema.org |
| **Workflow de rebuild cada 30 min** | Pospuesto a M10 por decisión del propietario: necesita el despliegue en Cloudflare. `catalog-version` y `catalog-version.json` quedan listos |
| Textos editoriales y plato de la casa | ✅ Aprobados el 13/11/2026 y aplicados ([CONTENIDO_EDITORIAL.md](CONTENIDO_EDITORIAL.md)). Quedan tres observaciones menores para tu decisión |
| `lang` en inglés fuera del prerender (M3) | **Diagnosticado, sin corregir** (corregir M3 no estaba autorizado).
- **Síntoma:** al entrar directo a una ruta en inglés que no se prerenderiza (`/en/account/*`, `/en/_design`, un 404 bajo `/en`), `<html>` queda con `lang="es-CR"`. Sigue así al navegar en inglés, incluso a `/en`, hasta pasar a español y volver.
- **Causa:** el hosting sirve `__spa-fallback.html`, que React Router genera una sola vez renderizando `/`, con `lang="es-CR"`. Al hidratar, el `Layout` raíz calcula `en` desde la URL, pero React 19 en producción no corrige atributos distintos en la hidratación. Después cree que el valor ya es `en` y no vuelve a escribirlo.
- **Por qué ninguna prueba lo detectó:** las E2E de M3 corren contra el servidor de desarrollo, que genera el HTML de cada URL. Las del catálogo usan el build, pero no abren páginas de la cuenta en inglés.
- **Corrección propuesta:** en `entry.client.tsx`, asignar `document.documentElement.lang = localeFromPathname(pathname)` antes de `hydrateRoot`. Agregar una E2E sobre el build que abra `/en/account/sign-in`, compruebe `lang="en"` y lo mantenga al navegar a `/en`. |
| Finish gate con capturas a 4 anchos (§2.4) | Se revisaron 1280 y 375 px en el navegador y con axe. Las capturas a 768 y 1024 px quedan para la auditoría de M9 |
| WebKit móvil | Pendiente desde M1 |
| CI de GitHub para M4 | Requiere push (no autorizado) |
