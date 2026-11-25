# Portfolio Master Plan

> Registro de los cuatro proyectos del portafolio profesional para Upwork.
> **Actualizado:** 22 de noviembre de 2026.
> Este archivo vive en el repositorio del restaurante mientras ese es el proyecto activo. 💡 Cuando empiece el segundo proyecto, conviene moverlo a un repositorio propio de portafolio.

## Estado general

| # | Proyecto | Stack previsto | Estado |
|---|---|---|---|
| 1 | **Marea Baja** — restaurante con pedidos, pagos simulados y administración | React 19, TypeScript, Vite, React Router, Tailwind, Node 24, Express 5, PostgreSQL, Prisma, Zod | **En implementación.** Planificación (D1–D14) aprobada el 10/11/2026. **M0–M6 integrados en `main`; M6 cerrado (PR #7, merge `5ed236f`, 24/11/2026). M7 en integración por el PR #9, pendiente de merge. M8–M11 no iniciados.** |
| 2 | E-commerce de ropa y accesorios | React, TypeScript, Java, Spring Boot, PostgreSQL | Futuro. No iniciado. |
| 3 | Peluquería: reservas y gestión de citas | React, TypeScript, C#, ASP.NET Core, SQL Server | Futuro. No iniciado. |
| 4 | SaaS multiusuario de gestión de proyectos | Next.js, TypeScript, NestJS, PostgreSQL, Redis | Futuro. No iniciado. |

## 1 · Marea Baja (activo)

- **Repositorio:** `Yulmes/restaurante`.
- **Arquitectura:** monolito modular. Frontend React prerenderizado en Cloudflare, con un proxy `/api/*` de mismo origen hacia la API Express en Render y PostgreSQL en Neon.
- **Puntos fuertes para Upwork:**
  - Checkout con impuestos en CRC/USD.
  - Pasarela simulada con authorize/capture/void/refund e idempotencia.
  - Sesiones seguras sin JWT.
  - Rate limiting persistente.
  - Auditoría de solo inserción.
  - SEO con prerender.
  - Backups cifrados con restauración probada.
- **Documentos:** `docs/planificacion/Propuesta Restaurante · Fase 1.md` y `docs/planificacion/AUDITORIA_COMPLETA_RESTAURANTE.md`.
- **Estado de los hitos (22/11/2026):**

  | Hito | Estado |
  |---|---|
  | M0 · Fundaciones, M1 · Sistema de diseño, M2 · Datos, M3 · Identidad | Integrados en `main` (PR #1 a #4) |
  | **M4 · Catálogo y SEO** | **Integrado en `main` y cerrado** (PR #5, merge `a710dba`, 18/11/2026; CI posterior al merge: 6/6 jobs aprobados). Incluye la API pública del catálogo, 56 páginas prerenderizadas en es-CR y en, SEO (meta, Open Graph, `hreflang`, JSON-LD, sitemap y robots), precios y disponibilidad en vivo, textos editoriales aprobados y la medición con Lighthouse (HTTP/1.1 y HTTP/2). También integra la corrección de M3 del idioma del documento (`m3-lang-documento`), con su suite E2E sobre el build, que corre en CI |
  | **M5 · Pedido** | **Integrado en `main` y cerrado** (PR #6, merge `bcebdcb`, 23/11/2026, con autorización de Nivel 3 del propietario). CI previo al merge: 7/7 jobs aprobados. CI posterior al merge en `main`: 7/7 jobs aprobados, sin reintentos. Nota final: 90/100, con los defectos D1–D4 corregidos y dos riesgos heredados aceptados temporalmente, no resueltos (ver abajo). Sin despliegue. Carrito de invitado y de cuenta con fusión idempotente, motor de precios, checkout de 3 pasos, direcciones y pedido en `PENDING_PAYMENT` sin cobro. Detalle en `docs/m5/VALIDACIONES_M5.md` |
  | **M6 · Pagos** | **Integrado en `main` y cerrado** (PR #7, merge commit `5ed236f`, 24/11/2026, con autorización de Nivel 3 del propietario). CI previo al merge: 7/7 jobs aprobados. CI posterior al merge en `main`: 7/7, sin reintentos. Nota final: 91/100, integración aprobada, con la revisión de aceptación técnica (4 defectos corregidos) y D-M6-4 resuelta (contra entrega en retiro y delivery). Sin despliegue y sin activar `DEMO_PAYMENTS_ENABLED` en ningún entorno remoto. Riesgos aceptados R-M6-1 a R-M6-3 (ver abajo). Interfaz `PaymentGateway` con procesador simulado, escenarios de la tarjeta demo, idempotencia, reconciliación, contra entrega (D-M6-1), capturar, anular y reembolsar por API para staff y admin (D-M6-2). Detalle en `docs/m6/VALIDACIONES_M6.md` y ADR 0007 |
  | **M7 · Operación** | **En integración por el PR #9 (`m7-operacion` → `main`), con CI 7/7 en el PR; pendiente de la autorización de merge del propietario.** No integrado ni cerrado; sin despliegue. Implementado con autorización de Nivel 2 e integración autorizada en Nivel 3 (24/11/2026). Puntaje propuesto: 92/100. Incluye máquina de estados del pedido, Pase, seguimiento e historial (D3), cancelaciones, barridos, correos de estado en es-CR y en, `DEMO_ONLY` y bandeja de demostración. Cierra R-M6-1 y R-M6-2. Detalle en `docs/m7/VALIDACIONES_M7.md` y ADR 0008 |
  | M8 a M11 | No iniciados |

- **Criterios de M4 aplazados con aceptación del propietario (17/11/2026):** siguen pendientes; no se dan por cumplidos.
  - LCP móvil < 2,5 s en producción: M10. En local solo se cumple con HTTP/2.
  - Validación externa de JSON-LD y `hreflang`: M10.
  - Workflow de rebuild cada 30 min: M10.
  - Capturas a 768 y 1024 px: M9.
  - WebKit móvil: pendiente desde M1, sin hito asignado.
  - En seguimiento: el error React #418, que no se pudo reproducir, y el riesgo de publicar URLs locales si falta `VITE_SITE_URL` (M10).
  - Detalle en `docs/m4/VALIDACIONES_M4.md`.
- **Riesgos heredados aceptados temporalmente para integrar M5 (23/11/2026):** siguen pendientes; no se dan por resueltos.
  - `npm audit`: GHSA-7589-6fvf-x4pw en `effect` 3.20.0, transitiva de Prisma 7.10.1. Se espera una Prisma 7.x que lo corrija.
  - Fallas heredadas de M1–M4 en WebKit (Playwright, perfil de iPhone): M9.
  - Detalle en `docs/m5/REVISION_ACEPTACION_M5.md` §7.
- **Riesgos aceptados al cerrar M6 (24/11/2026):** siguen pendientes; no se dan por resueltos. R-M5-1 y R-M5-2 también siguen abiertos.
  - R-M6-1: capturar y anular no cambian el estado del pedido hasta M7. **Resuelto en la implementación local de M7** (pendiente de integrar).
  - R-M6-2: la reconciliación puede confirmar el pago de un pedido vencido si el pago se inició antes del vencimiento. **Resuelto en la implementación local de M7** con el barrido que lo anula (pendiente de integrar).
  - R-M6-3: la reconciliación no tiene tope de reintentos ni espera creciente.
  - Detalle en `docs/m6/VALIDACIONES_M6.md`.
- **Próximo paso:** autorización de merge del PR #9 por el propietario y registro del cierre de M7. M8 empieza solo con autorización expresa.

## 2 · E-commerce (futuro)

- **Lo que debería mostrar:** catálogo con variantes (talle y color), inventario por SKU, carrito, cupones, órdenes y panel de inventario.
- **Diferencia con el restaurante:** el foco está en inventario y variantes, no en estados de cocina. El backend es Java/Spring (JPA, Bean Validation, Spring Security).

## 3 · Peluquería (futuro)

- **Lo que debería mostrar:** agenda por profesional, disponibilidad, reservas sin solapamiento (restricciones de exclusión o bloqueo transaccional), recordatorios y cancelaciones con política.
- **Diferencia:** el problema central es el tiempo y la concurrencia sobre franjas horarias. Stack .NET con EF Core y SQL Server.

## 4 · SaaS (futuro)

- **Lo que debería mostrar:** multiusuario y multi-organización (*multi-tenant*), invitaciones, roles por organización, tableros, colaboración en tiempo real, Redis para caché, colas y presencia.
- **Diferencia:** es el único proyecto con SSR (Next.js) y con arquitectura de servicios en NestJS.

## Reglas de independencia entre proyectos

1. Cada proyecto tiene **su propio repositorio**, sus dependencias, su infraestructura y su documentación.
2. **No hay paquetes de código compartidos** entre proyectos. Los stacks son distintos a propósito: el portafolio demuestra versatilidad.
3. **Se reutilizan solo prácticas y plantillas de documentos:**
   - estructura de README y ADR;
   - checklist de seguridad;
   - patrón de backups cifrados;
   - plantilla de CI;
   - formato de la guía de aprendizaje y del informe de cierre.
4. Cada proyecto tiene **identidad visual propia**. El sistema de diseño de Marea Baja no se recicla.
5. El restaurante no se generaliza para que "sirva para los demás". Si un patrón resulta útil (por ejemplo, la máquina de estados o la idempotencia), se reimplementa en el otro stack con sus herramientas propias.

## Convenciones comunes del portafolio

- Documentos: `README`, `ARCHITECTURE`, `DATABASE`, `API_DOCUMENTATION`, `DEPLOYMENT`, `SECURITY`, `TESTING`, `ENVIRONMENT_VARIABLES`, `COST_ESTIMATION`, `CHANGELOG` y `GUIA_TECNICA_Y_APRENDIZAJE`.
- Objetivo de costo: $0/mes de inicio, con limitaciones documentadas.
- Calidad mínima: tests unitarios, de integración y E2E, WCAG 2.2 AA, auditoría final y despliegue público verificado.
- Ningún secreto en repositorios; ninguna cuenta ni cargo sin aprobación explícita.
