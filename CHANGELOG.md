# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).

## [Sin publicar]

### Agregado — M1 · Sistema de diseño

- `apps/web`: React 19.3, React Router 7.18 (modo framework, `ssr: false`), Vite 8, Tailwind CSS 4.
- Tokens de marca y tokens semánticos de tema único (D1, D11). Escala tipográfica, movimiento y foco.
- Fuentes autoalojadas: Shippori Mincho B1 y Zen Kaku Gothic New (subconjuntos latinos) y Noto Sans solo para ₡ (ADR 0002, decisión del propietario).
- Sello 引潮 como SVG puro, extraído de los contornos de la fuente (sin cargar la fuente japonesa).
- Componentes base: botón, campo, resumen de errores, grupo de opciones, selector de cantidad (sin tope de 20, regla C5), precio, línea de carta, etiqueta, esqueleto, selector de idioma, aviso de demo y enlace para saltar al contenido.
- Página interna `/_design` (es-CR y en, `noindex`) con todos los estados.
- i18n con i18next (ADR 0001): mensajes es-CR y en, claves tipadas, prueba de paridad y regla de lint contra textos literales.
- `formatMoney` en `@marea-baja/shared` (CLDR por idioma).
- Pruebas: Vitest (contraste, glifos por `cmap`, formato, mensajes y rutas) y Playwright con axe-core (WCAG 2.2 AA, teclado, idiomas, 4 anchos, movimiento reducido).
- Skill Web Design Guidelines instalada (D12) y documentada en `TESTING.md`.
- 19 fotografías con licencia verificada, aprobadas una por una por el propietario (D13); la 13 se descartó y no tiene reemplazo.
- Prueba con NVDA 2026.3 en Edge: 20 de 20 pasos aprobados. Se corrigió la lectura del plato agotado, cuyo precio y estado se leían pegados.
- Documentos: `TESTING.md`, `CREDITS.md`, `docs/I18N.md`, ADR 0001 y 0002, validaciones de M1, prueba con NVDA y revisión documental del sello (la revisión nativa sigue pendiente).

### Agregado — M0 · Fundaciones

- Monorepo con npm workspaces: `apps/api` y `packages/shared`.
- TypeScript 6 en modo estricto (`tsconfig.base.json`).
- ESLint 10 con `typescript-eslint` (reglas estrictas con información de tipos), Prettier y Vitest.
- Validación de variables de entorno de la API con Zod (`NODE_ENV`, `DATABASE_URL`) y comando `env:check`.
- Lista de idiomas soportados en `@marea-baja/shared`: `es-CR` (predeterminado) y `en` (decisión D2).
- Docker Compose con PostgreSQL 17.11 y Mailpit 1.32.0, solo en 127.0.0.1.
- Workflow de CI base en GitHub Actions.
- Documentación de planificación (Fase 1, v3), README y variables de entorno.
