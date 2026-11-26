# Portfolio Master Plan

> Registro de los cuatro proyectos del portafolio profesional para Upwork.
> **Actualizado:** 22 de noviembre de 2026.
> Este archivo vive en el repositorio del restaurante mientras ese es el proyecto activo. 💡 Cuando empiece el segundo proyecto, conviene moverlo a un repositorio propio de portafolio.

## Estado general

| # | Proyecto | Stack previsto | Estado |
|---|---|---|---|
| 1 | **Marea Baja** — restaurante con pedidos, pagos simulados y administración | React 19, TypeScript, Vite, React Router, Tailwind, Node 24, Express 5, PostgreSQL, Prisma, Zod | **En implementación.** Planificación (D1–D14) aprobada el 10/11/2026. **M0–M9 integrados en `main`; M9 cerrado con riesgos aceptados y pendientes humanos (PR #13, merge `adb772f`, 26/11/2026). M10 y M11 no iniciados.** |
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
  | **M7 · Operación** | **Integrado en `main` y cerrado** (PR #9, merge commit `991ddba`, 24/11/2026, con autorización de Nivel 4 del propietario). CI previo al merge: 7/7 jobs aprobados. CI posterior al merge en `main`: 7/7, sin reintentos. Nota final: 92/100, integración aprobada. Sin despliegue. Incluye máquina de estados del pedido, Pase, seguimiento e historial (D3), cancelaciones, barridos, correos de estado en es-CR y en, `DEMO_ONLY` y bandeja de demostración. Cierra R-M6-1 y R-M6-2. Detalle en `docs/m7/VALIDACIONES_M7.md` y ADR 0008 |
  | **M8 · Admin** | **Integrado en `main` y cerrado** (PR #11, merge commit `ca21fcb`, 24/11/2026, con autorización de Nivel 4 del propietario). CI previo al merge: 7/7 jobs aprobados en dos corridas. CI posterior al merge en `main`: 7/7, sin reintentos. Nota final: 91/100, integración aprobada, con tres defectos corregidos en la revisión previa al push. Sin despliegue. Dashboard con datos reales, carta con traducciones y editor con vista previa, pesca del día, clientes (bloqueo y roles), configuración, impuestos, zonas, umbral de Turnstile, asistente de moneda, auditoría con filtros y pedidos con reembolsos, en es-CR y en. Decisiones D-M8-1 a D-M8-4 del propietario (promociones fuera, fotos solo con texto alternativo, todo solo ADMIN, moneda por tipo de cambio). Detalle en `docs/m8/VALIDACIONES_M8.md` y ADR 0009 |
  | **M9 · Calidad** | **Integrado en `main` y cerrado con riesgos aceptados y pendientes humanos** (PR #13, merge commit `adb772f`, 26/11/2026, con autorización de Nivel 4 del propietario). CI previo al merge: 7/7 jobs aprobados en dos corridas. CI posterior al merge en `main`: 7/7, sin reintentos ([run](https://github.com/Yulmes/restaurante/actions/runs/45843124734)). Nota final: 88/100. Sin despliegue. Auditoría de 31 pantallas reales × 2 idiomas × 4 anchos (axe WCAG 2.2 AA, foco, movimiento reducido, desbordamiento) que corre en CI, *finish gate*, Lighthouse, revisión de seguridad y de los límites de §8.4; 9 defectos corregidos, entre ellos M9-07 y M9-08 (R-M9-1, alternativas 1 y 2). **NVDA y Safari de iOS real siguen pendientes del propietario.** Detalle en `docs/m9/AUDITORIA_M9.md` |
  | M10 y M11 | No iniciados |

- **Criterios de M4 aplazados con aceptación del propietario (17/11/2026):** siguen pendientes; no se dan por cumplidos.
  - LCP móvil < 2,5 s en producción: M10. En local solo se cumple con HTTP/2.
  - Validación externa de JSON-LD y `hreflang`: M10.
  - Workflow de rebuild cada 30 min: M10.
  - Capturas a 768 y 1024 px: **hechas en M9** (`docs/evidencias/m9/`).
  - WebKit móvil: pendiente desde M1, sin hito asignado.
  - En seguimiento: el error React #418, que no se pudo reproducir, y el riesgo de publicar URLs locales si falta `VITE_SITE_URL` (M10).
  - Detalle en `docs/m4/VALIDACIONES_M4.md`.
- **Riesgos heredados aceptados temporalmente para integrar M5 (23/11/2026):** siguen pendientes; no se dan por resueltos.
  - `npm audit`: GHSA-7589-6fvf-x4pw en `effect` 3.20.0, transitiva de Prisma 7.10.1. Se espera una Prisma 7.x que lo corrija.
  - Fallas heredadas de M1–M4 en WebKit (Playwright, perfil de iPhone): revisadas en M9. El defecto real de la app se corrigió; lo que queda (supuestos de las pruebas y comportamiento de la plataforma) se **acepta como riesgo abierto** al cerrar M9 (R-M5-2).
  - Detalle en `docs/m5/REVISION_ACEPTACION_M5.md` §7.
- **Riesgos aceptados al cerrar M6 (24/11/2026):** siguen pendientes; no se dan por resueltos. R-M5-1 y R-M5-2 también siguen abiertos.
  - R-M6-1: capturar y anular no cambian el estado del pedido hasta M7. **Resuelto con M7, integrado en `main`** (PR #9, merge `991ddba`).
  - R-M6-2: la reconciliación puede confirmar el pago de un pedido vencido si el pago se inició antes del vencimiento. **Resuelto con M7, integrado en `main`** (PR #9, merge `991ddba`), con el barrido que lo anula.
  - R-M6-3: la reconciliación no tiene tope de reintentos ni espera creciente.
  - Detalle en `docs/m6/VALIDACIONES_M6.md`.
- **Riesgos abiertos al cerrar M7 (24/11/2026):** siguen pendientes; no se dan por resueltos.
  - R-M7-1: los barridos y la reconciliación solo corren con la API despierta, hasta el endpoint interno y el cron de M10.
  - R-M7-2: el límite de staff/admin (30 / 10 min por usuario, §8.4) puede quedar corto con mucho movimiento; cambiarlo requiere aprobación.
  - R-M7-3: la verificación del correo de los visitantes en la demo pública depende de una decisión de M10.
  - R-M7-4: dos transiciones en el mismo milisegundo no tienen un orden garantizado en el seguimiento.
  - Detalle en `docs/m7/VALIDACIONES_M7.md`.
- **B0 posterior a M7:** completado el 24/11/2026 (worktree principal en `main` en `4b483c9`, sin cambios en ramas ni worktrees).
- **Riesgos abiertos al cerrar M8 (24/11/2026):** siguen pendientes; no se dan por resueltos. R-M7-2 amplía su alcance (D-M8-5). R-M8-1 (el límite de §8.4 también rige la edición de la carta), R-M8-2 (pedido creado en el mismo instante que un cambio de moneda), R-M8-3 (precios del HTML prerenderizado hasta el rebuild de M10) y R-M8-4 (sin *finish gate* externo). Detalle en `docs/m8/VALIDACIONES_M8.md`.
- **B0 posterior a M8:** completado el 25/11/2026 (worktree principal en `main` en `d3d1a27`, sin cambios en ramas ni worktrees).
- **Riesgos al cerrar M9 (26/11/2026), aceptados por el propietario para el cierre; siguen pendientes y no se dan por resueltos:**
  - R-M9-1: **mitigado en parte.** M9-07 y M9-08 corregidos; la cota teórica de la aproximación deslizante (hasta ~2 × N en un intervalo más corto que la ventana) sigue abierta. Cerrarla requiere una ventana deslizante exacta (alternativa 3), con autorización aparte.
  - R-M9-2: la CSP estricta necesita hashes para los scripts en línea del prerender. Transferido a M10.
  - R-M5-1 (`npm audit`) y R-M5-2 (WebKit heredado): abiertos y aceptados.
  - Validaciones humanas pendientes: NVDA (18 pasos) y Safari de iOS real (9 escenarios), en `docs/m9/PRUEBAS_HUMANAS_M9.md`.
  - R-M8-4 (sin *finish gate*): mitigado con el *finish gate* de M9; queda la revisión externa de una persona.
  - Detalle en `docs/m9/AUDITORIA_M9.md`.
- **Próximo paso:** revisión del entorno posterior a M9 (B0), con autorización propia. M10 empieza solo con autorización expresa del propietario.

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
