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
| Formato, lint, tipos y unitarias | `npm run check` | ✅ 116 / 116 (105 anteriores + 11 de M4) |
| Integración con PostgreSQL real (M2, M3 y M4) | `npm run test:db` | ✅ 134 / 134 (123 anteriores + 11 de la API del catálogo) |
| Esquema y migraciones | `npm run db:drift -w @marea-baja/api` | ✅ Sin diferencias. **M4 no cambia el esquema** |
| E2E del catálogo y SEO sobre el **build de producción** | `npm run test:e2e:catalog -w @marea-baja/web` | ✅ 19 / 19 (dos corridas seguidas después de las correcciones) |
| Lighthouse sobre el build de producción (escritorio y móvil, 8 páginas, 3 corridas) | `npm run lighthouse -w @marea-baja/web` | ✅ Objetivos cumplidos en las 16 combinaciones. ⚠️ LCP móvil de la portada y el plato por encima de 2,5 s (ver abajo) |
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

**Resultados (mediana de 3 corridas):**

| Dispositivo | Página | Performance | Accessibility | Best Practices | SEO | LCP | CLS | TBT | Auditorías con peso por debajo de 0,9 |
|---|---|---|---|---|---|---|---|---|---|
13.6.0 http://127.0.0.1:4173 3 2026-11-14T02:07:13.293Z
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

**Problemas encontrados y corregidos:**
1. **Primera medición sin compresión.** El servidor del build no comprimía. Lighthouse midió unos 600 KB de JavaScript sin comprimir, que en producción no existen, y la portada y el plato daban 78 y 79 en móvil, con LCP de 6 s.
   - Se agregó compresión Brotli o gzip a `scripts/serve-build.ts`, como hace el hosting.
   - Solo cambia el entorno de medición y de prueba, no el producto.
2. **Brotli a calidad 11** (la que trae Node por defecto) retrasaba la hidratación al comprimir al vuelo, y las E2E hacían clic antes de que la página respondiera. Se bajó a calidad 5, la habitual para compresión dinámica.
3. **Las E2E del catálogo** ahora esperan la hidratación antes de interactuar.
4. **`CATALOG_API_URL`:** el servidor de desarrollo evalúa la lista de rutas del prerender y la pedía siempre a la API del puerto 3000. Las E2E de identidad (API en el 3100) pasaban solo si había otra API corriendo en el 3000, así que en CI habrían fallado. Ahora, si `CATALOG_API_URL` falta, se usa `API_PROXY_TARGET`.

**Propuestas para bajar el LCP móvil** (no implementadas; necesitan tu autorización porque tocan la i18n de M1 o el diseño):

| Propuesta | Efecto esperado | Qué toca |
|---|---|---|
| Cargar los textos por idioma y por espacio bajo demanda (solo `common` + `site` del idioma de la página en la portada) | Menos JavaScript compitiendo con la foto en la carga inicial | Configuración de i18n de M1 (`app/i18n/config.ts`) |
| Una variante `card` de 720 px y un `sizes` ajustado para el celular | La foto LCP pasa de unos 30 KB a unos 18 KB | Pipeline de imágenes de M4 (`build-images.ts`, `images.ts`) |
| `<link rel="preload">` de la foto LCP en la portada y el plato | Bajo: la imagen ya se descubre temprano con prioridad alta | Rutas de M4 |

Las cifras de Lighthouse en local con red simulada son una referencia. La medición definitiva es sobre la URL pública con el CDN (M10).

**Riesgo de experiencia detectado:** hasta que React hidrata el HTML prerenderizado, los botones (filtros, menú del celular) todavía no responden. En la medición local la hidratación termina en menos de un segundo. En una red lenta puede notarse. Se registra para la revisión de M9.

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
| **LCP móvil de la portada y del plato** (§11: < 2,5 s) | Medido: 3,25 s y 3,18 s. Las propuestas están en la sección Lighthouse y esperan autorización. La medición definitiva es con la URL pública (M10) |
| **Validadores externos** de datos estructurados (Rich Results Test, Schema Markup Validator) | Son servicios externos y requieren una URL pública (M10). Se validó que el JSON-LD se parsea y tiene los tipos y campos de schema.org |
| **Workflow de rebuild cada 30 min** | Pospuesto a M10 por decisión del propietario: necesita el despliegue en Cloudflare. `catalog-version` y `catalog-version.json` quedan listos |
| **Textos editoriales y plato de la casa** | Borrador pendiente de aprobación ([CONTENIDO_EDITORIAL.md](CONTENIDO_EDITORIAL.md)) |
| Finish gate con capturas a 4 anchos (§2.4) | Se revisaron 1280 y 375 px en el navegador y con axe. Las capturas a 768 y 1024 px quedan para la auditoría de M9 |
| WebKit móvil | Pendiente desde M1 |
| CI de GitHub para M4 | Requiere push (no autorizado) |
