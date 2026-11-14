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
| E2E del catálogo y SEO sobre el **build de producción** | `npm run test:e2e:catalog -w @marea-baja/web` | ✅ 19 / 19 |
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
| **Lighthouse** (evidencia de cierre de §12) | No se ejecutó: no está instalado y el proyecto no tiene Lighthouse CI configurado. Recomendación: medirlo sobre el build servido antes de cerrar M4, o con la URL pública en M10 (LCP y CLS de §11) |
| **Validadores externos** de datos estructurados (Rich Results Test, Schema Markup Validator) | Son servicios externos y requieren una URL pública (M10). Se validó que el JSON-LD se parsea y tiene los tipos y campos de schema.org |
| **Workflow de rebuild cada 30 min** | Pospuesto a M10 por decisión del propietario: necesita el despliegue en Cloudflare. `catalog-version` y `catalog-version.json` quedan listos |
| **Textos editoriales y plato de la casa** | Borrador pendiente de aprobación ([CONTENIDO_EDITORIAL.md](CONTENIDO_EDITORIAL.md)) |
| Finish gate con capturas a 4 anchos (§2.4) | Se revisaron 1280 y 375 px en el navegador y con axe. Las capturas a 768 y 1024 px quedan para la auditoría de M9 |
| WebKit móvil | Pendiente desde M1 |
| CI de GitHub para M4 | Requiere push (no autorizado) |
