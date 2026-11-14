# ADR 0005 · Catálogo público: prerender desde la API, datos en vivo e imágenes estáticas

- **Estado:** aceptado (decisiones técnicas dentro del alcance aprobado de M4: §4.2, §9.4, D10).
- **Hito:** M4 · Catálogo y SEO
- **Relacionado:** propuesta §2.3, §2.4, §3.5, §3.6, §4.2, §4.5, §9.4; D2, D10; R13, R20.

## Decisiones del propietario para este hito (13/11/2026)

| Tema | Decisión |
|---|---|
| Textos de "Nosotros", "Visítanos" y el plato de la casa | Borrador para revisión: `docs/m4/CONTENIDO_EDITORIAL.md` |
| Página del plato | **Informativa:** opciones con su precio adicional, sin elegirlas ni agregar. La interacción llega con el carrito (M5) |
| Rebuild cada 30 min (D10) | `catalog-version` ahora. El workflow programado se crea y activa en **M10**, junto con el despliegue en Cloudflare |
| Búsqueda y filtros | Índice de categorías, filtros por etiqueta en línea y búsqueda por texto. Se conserva el orden de la carta impresa, sin control de orden |

## 1. API pública del catálogo

- `GET /api/public/catalog?locale=es-CR|en`:
  - categorías y platos activos, con traducciones resueltas;
  - si falta una traducción, el texto llega en es-CR con `lang: 'es-CR'` (§4.5);
  - los nombres originales de los platos no se traducen (D2);
  - **lee la base en cada petición**, con `Cache-Control: no-store`: precios y disponibilidad siempre en vivo (D10).
- `GET /api/public/catalog-version`:
  - es un hash de los datos publicados en todos los idiomas;
  - se guarda **en memoria** y se recalcula con cada lectura de la carta, así la consulta del rebuild no despierta la base (R20);
  - `CatalogService.invalidateVersion()` queda para los cambios del admin (M8).
- `GET /api/public/catch-of-the-day`:
  - devuelve la última pizarra publicada con fecha de hoy o anterior, con la hora de llegada en la zona del restaurante;
  - `isToday` evita presentar como "de hoy" una pizarra vieja.
- `GET /api/public/opening-hours`: horario semanal y modalidades habilitadas.
- **Contratos:** los esquemas Zod están en `@marea-baja/shared` (`catalog/schemas.ts`).
- **Sin datos internos:** las respuestas no exponen ids de base de los platos, impuestos ni fechas.
- **Sin cambios de esquema ni migraciones.**

## 2. Prerender desde la API (§4.2)

- **Rutas:** `react-router.config.ts` las pide a la API en el build (`CATALOG_API_URL`) y prerenderiza en los dos idiomas: `/`, `/carta`, cada categoría, cada plato, `/nosotros` y `/visitanos`, más sus versiones `/en/...` con los segmentos traducidos (`carta → menu`, `nosotros → about`, `visitanos → visit`). Hoy son 56 páginas.
- **Datos de cada página:** los `loader` corren solo en el build. Si la API no responde, se reintenta durante unos 50 s y después el build falla con un mensaje claro. Nunca se publica una carta vacía.
- **Al hidratar** (TanStack Query) se vuelven a pedir en vivo precio, disponibilidad, opciones y la pizarra (D10). Si un plato dejó de publicarse, se muestra como no disponible.
- **Metadatos por ruta e idioma** (`app/site/seo.ts`):
  - título, descripción, canónica propia por idioma y `hreflang` es-CR / en / x-default;
  - Open Graph 1200×630 y Twitter card;
  - JSON-LD `Restaurant`, `Menu`/`MenuSection`/`MenuItem` (precio en CRC, IVA incluido, disponibilidad, dietas).
  - El JSON-LD sale del descriptor `script:ld+json` de React Router, **sin `dangerouslySetInnerHTML`** (§8.7).
- **Archivos de SEO** (`scripts/seo-files.ts`, después del build):
  - `sitemap.xml` con alternativas `xhtml:link`;
  - `robots.txt`, que bloquea cuenta, pedido, admin y `/_design` en los dos idiomas;
  - `catalog-version.json`, la versión publicada que comparará el rebuild de M10;
  - `noindex` inyectado en el HTML crudo del fallback SPA, porque el `meta` de esas rutas solo se aplica al hidratar.
- **Origen público:** `VITE_SITE_URL` (se configura en M10). En local se usa el del servidor de Vite.

## 3. Imágenes: `StaticProvider` (§2.3, §9.4)

- **Variantes:** `scripts/build-images.ts` (con `sharp`, solo de desarrollo) genera de cada foto aprobada:
  - `card` 4:5 (480 y 960 px);
  - `hero` 3:2 (1000 y 2000 px);
  - `thumb` 1:1 (480 px);
  - `og` 1200×630.
  - Formatos: AVIF y WebP, más JPEG para Open Graph.
- **Dónde quedan:** las salidas van a `public/images/`, ignorado por git. Se regeneran solo si cambian la foto o el script. La primera vez tarda unos 80 s.
- **Un único ajuste de color**, apenas más frío y con las sombras levantadas hacia Tinta (§2.3). Es sutil a propósito: no cambia el contenido de la foto aprobada.
- **Encuadres:** recorte automático por atención, salvo en las fotos 19 y 21, que se encuadran abajo por las notas de licencia de M1 (tatuajes con texto y residuos en la arena).
- **URLs:** la web las arma con `provider` + `storageKey` (`app/catalog/images.ts`). Cloudinary y R2 (subidas del admin) llegan en M8 y M10.
- **Fotos de las páginas:** las 18 a 22, reservadas en M1, ilustran la portada, "Nosotros" y "Visítanos" con textos alternativos que describen lo visible.

## 4. Interfaz

- **Marco común** (`SiteLayout`, §3.5):
  - barra con Carta · Pesca del día · Nosotros · Visítanos, Cuenta y ES · EN;
  - en el celular, una hoja a pantalla completa con `<dialog>` (foco atrapado y Escape);
  - las páginas de la cuenta (M3) usan la misma barra y el mismo pie;
  - el selector de idioma del pie se quitó para no duplicar enlaces idénticos.
- **Carta:**
  - usa la `MenuLine` de M1, con tres props opcionales nuevas y sin cambios visuales previos: enlace del nombre, nombre traducido e idioma de la descripción;
  - filtros y búsqueda en línea. En el celular se pliegan detrás de "Buscar y filtrar", para que el primer plato y su precio se vean sin desplazarse (§2.4).
- **Botón y enlace:** `buttonClassName` (M1) permite enlaces con aspecto de botón sin anidar un botón dentro de un enlace.
- **Sin carrito:** no hay botón "Pedido · ₡X" ni "Agregar". Llegan en M5.

## 5. Pruebas y CI

- **Servidor del build:** `scripts/serve-build.ts` sirve el build como el hosting estático (archivos, `index.html` por ruta, fallback SPA y `/api` en el mismo origen) y no sale de `build/client`.
- **E2E del catálogo:** `playwright.catalog.config.ts` prueba el **build de producción**, no el servidor de desarrollo. Recrea `<base>_e2e`, levanta la API (puerto 3200), hace el build con prerender y lo sirve (puerto 5175).
- **CI:**
  - job nuevo **Catálogo y SEO**;
  - el job **Sistema de diseño** ahora levanta PostgreSQL y la API, porque la portada lee el catálogo;
  - el build de producción se prueba en el job de catálogo, porque necesita la API.

## Consecuencias

- El build depende de que la API esté accesible (§4.2, implicación 3). En M10, el workflow de build apunta a la API desplegada.
- Una categoría o un plato nuevos aparecen en el HTML publicado recién con el siguiente build. Al navegar en el cliente, una ruta sin prerender responde 404 hasta el rebuild (D10, R13).
- `catalog-version` cambia con cualquier dato publicado, incluidos precios y disponibilidad. Que esos cambios disparen un rebuild es intencional: el HTML de los buscadores también muestra precios.
