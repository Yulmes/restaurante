# Portfolio Master Plan

> Registro de los cuatro proyectos del portafolio profesional para Upwork.
> **Actualizado:** 9 de noviembre de 2026.
> Este archivo vive en el repositorio del restaurante mientras ese es el proyecto activo. 💡 Cuando empiece el segundo proyecto, conviene moverlo a un repositorio propio de portafolio.

## Estado general

| # | Proyecto | Stack previsto | Estado |
|---|---|---|---|
| 1 | **Marea Baja** — restaurante con pedidos, pagos simulados y administración | React 19, TypeScript, Vite, React Router, Tailwind, Node 24, Express 5, PostgreSQL, Prisma, Zod | **Fase 1: planificación cerrada.** Marca, arquitectura, sistema de diseño y las 14 decisiones de planificación (D1–D14) aprobados el 10/11/2026. **Sin código; implementación no iniciada.** |
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
- **Próximo paso:** autorización del propietario para iniciar M0. No quedan decisiones de planificación pendientes: C5 se resolvió el 10/11/2026 con la regla de división interna de cantidades.

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
