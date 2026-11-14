# Auditoría completa · Restaurante Marea Baja

> **Tipo:** auditoría de planificación (previa a la implementación).
> **Fecha:** 9 de noviembre de 2026.
> **Estado del código:** no existe. El repositorio solo contiene `README.md`, `.gitignore` y documentos de planificación.
> **Estado de las decisiones:** las decisiones de planificación están aprobadas (D1–D14, 10/11/2026). Ver la propuesta v3, sección 15.
> **Nada de este documento está implementado.** Cuando el desarrollo avance, cada requisito pasará de "Planificado" a "Implementado" y luego a "Verificado", con su evidencia.
> Propuesta de referencia: [Propuesta Restaurante · Fase 1.md](Propuesta%20Restaurante%20·%20Fase%201.md)

---

## 1. Registro de decisiones

### 1.1 Decisiones aprobadas ✅

| ID | Decisión | Aprobada en | Condiciones |
|---|---|---|---|
| D01 | Marca **Marea Baja**, cevichería nikkei, eslogan «Lo que trajo el mar hoy» | Actualización Fase 1 | Conservar la paleta, las tipografías y el concepto ola→bowl. Hanko opcional si aporta. |
| D02 | Monolito modular con npm workspaces (`apps/web`, `apps/api`, `packages/shared`) | Actualización Fase 1 | `shared` sin dependencias innecesarias ni responsabilidades mezcladas. |
| D03 | React 19 + Vite + TypeScript + React Router | Actualización Fase 1 | Resolver el SEO: prerender, meta, OG, sitemap, robots. |
| D04 | Sesiones en PostgreSQL con hash del token y cookies HttpOnly | Actualización Fase 1 | Secure en producción, SameSite, expiración, revocación, rotación, CSRF, pruebas. Sin JWT. |
| D05 | Mailpit (desarrollo) + Resend (producción) con `EmailProvider` | Actualización Fase 1 | Distinguir lo real de lo demo; nunca afirmar envíos simulados. |
| D06 | Pino para logs | Actualización Fase 1 | requestId, niveles, JSON, redacción y configuración por entorno. |
| D07 | Proxy de mismo origen `/api/*` en Cloudflare | Actualización Fase 1 | Verificar en el entorno desplegado, no solo en localhost. |
| D08 | Mock Payment Gateway propio, sin pasarelas reales | Original + actualización | Selector de escenarios; no recopilar datos bancarios. |
| D09 | Moneda CRC por defecto, USD como alternativa, impuestos configurables | Actualización Fase 1 | Enteros por moneda, redondeo definido, detalle fiscal histórico, sin asumir 0 %. |
| D10 | Objetivo de $0/mes con Cloudflare + Render + Neon | Original + actualización | Sin garantía de disponibilidad de producción; alternativas documentadas. |
| D11 | Rate limiting persistente, `AuditLog`, `ImageStorageProvider`, backups completos | Actualización Fase 1 | Ver los requisitos R-SEC, R-AUD, R-IMG y R-BKP. |
| D12 | Fotografía real con licencia verificable; sin fotos de IA como definitivas | Actualización Fase 1 | `CREDITS.md`. |

### 1.2 Decisiones que estaban pendientes — ✅ todas resueltas el 10/11/2026

> **Actualización (10/11/2026):** las 14 decisiones de esta tabla fueron aprobadas como **D1–D14**. El registro vigente, con su alcance, condiciones, contradicciones (C1–C12) y validaciones técnicas (V1–V11), está en la [propuesta, sección 15](Propuesta%20Restaurante%20·%20Fase%201.md). La tabla se conserva como historial: P01→D1, P02→D2, … P14→D14. Donde lo aprobado difiere de la recomendación original, manda la propuesta. Por ejemplo: P02 se aprobó con inglés desde la v1, P07 con backups semanales y restauración automática, y P09 con monitoreo 24/7.

| ID | Decisión | Recomendación (historial) | Impacto si cambia |
|---|---|---|---|
| P01 | Dirección artística y sistema de diseño | Aprobar la v2 con 4 tokens derivados | Bloquea M1 y todo el frontend |
| P02 | Idioma | es-CR, con el sistema preparado para inglés | Bajo si se decide antes de M4 |
| P03 | Pago sin cuenta | Carrito sin cuenta, pago con cuenta verificada | Cambia el checkout y el E2E |
| P04 | Consumo en el local | Solo informativo; la app atiende retiro y delivery | Alcance |
| P05 | Valores fiscales semilla | IVA 13 % incluido; servicio 10 % inactivo | Solo datos semilla |
| P06 | Dominio y correo real | Escenario A ($0) ahora | Correo real a terceros |
| P07 | Restauración de prueba automática o manual | Automática semanal en un *environment* protegido | Superficie de secretos |
| P08 | Turnstile | Sí, solo en el umbral global de login | Requiere cuenta de Cloudflare |
| P09 | Monitor de UptimeRobot | Ventana horaria | Horas de Render |
| P10 | Frecuencia del rebuild del prerender | 30 min | Frescura para buscadores |
| P11 | Modo oscuro | No en la v1 | Bajo |
| P12 | Instalar el skill Web Design Guidelines | Sí | Ninguno en el código |
| P13 | Preselección de fotos | Se presenta en M1 | Bloquea las descargas |
| P14 | Creación de cuentas externas | La hacés vos en M10 | Bloquea el despliegue |

---

## 2. Requisitos técnicos y trazabilidad

Estado posible: **Planificado** → **Implementado** → **Verificado**. Al cierre de M2, R-AUD-01 y R-MONEY-01 están parcialmente implementados; el resto sigue en *Planificado*.

### 2.1 Producto

| ID | Requisito | Diseño (propuesta §) | Verificación prevista | Estado |
|---|---|---|---|---|
| R-PUB-01 | Página pública con header, hero, especialidades, destacados, categorías, promociones, historia, galería, horarios, ubicación, contacto y footer | §2.1, §3 | Finish gate + E2E de navegación | Planificado |
| R-MENU-01 | Catálogo desde la base de datos con búsqueda, filtros, orden, detalle, personalización y cantidades | §3.6, §6 | Integración + E2E | Planificado |
| R-CART-01 | Carrito con totales recalculados en el servidor; persistencia invitado→usuario | §6.2, §7.3 | Unitarios de pricing + E2E | Planificado |
| R-CHK-01 | Checkout de 3 pasos optimizado para celular, retiro o delivery, zonas configurables | §3.8 | E2E a 375 px | Planificado |
| R-AUTH-01 | Registro, verificación, login, logout, recuperación, perfil, direcciones | §8 | Integración + E2E | **Parcial (M3):** registro, verificación, login, logout, recuperación y perfil implementados y probados (integración + E2E). Direcciones: **M5**, con el checkout y el delivery (decisión del propietario, 13/11/2026) |
| R-ORD-01 | Estados validados en el backend, historial con actor y fecha, seguimiento | §7.1 | Matriz de transiciones | Planificado |
| R-PAY-01 | Mock gateway con escenarios, authorize/capture/void/refund, idempotencia y reconciliación | §7.2–7.4 | Matriz de escenarios + concurrencia | Planificado |
| R-ADM-01 | Dashboard con datos reales, Pase, carta, clientes, configuración, auditoría | §3.6, §8.6 | E2E escenarios 2 y 3 | Planificado |
| R-MAIL-01 | Plantillas de marca; outbox; estados SENT, DEMO_ONLY y FAILED | §8.5 | Integración + Mailpit | **Parcial (M3):** outbox transaccional, SENT y FAILED, plantillas de marca en es-CR y en, Mailpit. Resend preparado sin prueba real (requiere la cuenta del propietario, D14). DEMO_ONLY y bandeja demo: M7 |
| R-SEO-01 | Prerender, meta, OG, JSON-LD, sitemap, robots, URLs legibles | §4.2 | Lighthouse + validador de datos estructurados | Planificado |
| R-MONEY-01 | CRC/USD, enteros, impuestos en puntos básicos, redondeo una vez por tasa, OrderTaxLine | §6.2 | Tests de tabla | **Parcial (M2):** enteros, `rateBps`, `OrderTaxLine` y valores semilla de D5 en el esquema, con restricciones verificadas. Motor de precios y redondeo: M5 |

### 2.2 Seguridad

| ID | Requisito | Diseño | Verificación prevista | Estado |
|---|---|---|---|---|
| R-SEC-01 | Argon2id; política de contraseñas | §8.7 | Unitario | **Cumplido (M3):** Argon2id (OWASP) y lista de 10.000 comunes, con prueba unitaria |
| R-SEC-02 | Cookie `__Host-`, HttpOnly, Secure, SameSite=Lax | §8.2 | Integración + post-deploy | **Parcial (M3):** banderas verificadas en integración (también `__Host-` y `Secure` con configuración de producción). Post-deploy: M10 |
| R-SEC-03 | Expiración, rotación y revocación de sesiones | §8.2 | Integración | **Cumplido (M3):** expiración por rol, rotación y revocación con pruebas de integración y reloj simulado |
| R-SEC-04 | CSRF: Origin + token sincronizador | §8.3 | Integración + post-deploy | **Parcial (M3):** Origin/Sec-Fetch-Site y token sincronizador con pruebas de integración. Post-deploy: M10 |
| R-SEC-05 | Rate limiting persistente por IP, cuenta y cuenta+IP; bloqueos temporales no permanentes | §8.4 | Integración con relojes simulados | **Cumplido (M3):** límites por IP, cuenta y cuenta+IP; bloqueos temporales y escalados; integración con reloj simulado |
| R-SEC-06 | RBAC + propiedad (IDOR → 404) | §8.7 | Matriz de roles | **Parcial (M3):** RBAC con matriz de roles. Propiedad e IDOR → 404: con los pedidos (M5) |
| R-SEC-07 | Montos y estados decididos por el servidor | §7 | E2E escenario 3 | Planificado |
| R-SEC-08 | CSP, Helmet, sin `dangerouslySetInnerHTML` | §8.7 | Revisión + test de encabezados | **Parcial (M3):** Helmet en la API y prueba de encabezados. CSP de la web (con Turnstile en el login): M10 |
| R-SEC-09 | Secreto de origen entre el Worker y la API | §5 | Post-deploy (llamada directa → 403) | Planificado |
| R-SEC-10 | Logs sin datos sensibles | §8.7 | Test de redacción | **Cumplido (M3):** redacción probada (unitaria e integración) |
| R-SEC-11 | Secretos validados al arrancar; ninguno en el repo | §8.7 | CI con escaneo de secretos (gitleaks) | Planificado |
| R-AUD-01 | AuditLog de solo inserción con trigger, grants, lista blanca de campos y escritura transaccional | §8.6 | Integración: UPDATE/DELETE fallan | **Parcial (M2, M3):** trigger y grants (M2). Escritura transaccional, lista blanca y enmascarado implementados y probados con rollback (M3, cambio de roles). Resto de entidades: M7, M8 |

### 2.3 Infraestructura y operación

| ID | Requisito | Diseño | Verificación prevista | Estado |
|---|---|---|---|---|
| R-IMG-01 | `ImageStorageProvider` con implementaciones Static, Cloudinary y R2 | §9.4 | Tests con un proveedor falso | Planificado |
| R-BKP-01 | Backups cifrados, externos, con retención, integridad y restauración probada | §10 | Restauración semanal + runbook | Planificado |
| R-OBS-01 | Health checks sin tocar la base, logs estructurados, monitoreo | §9.5 | Post-deploy | Planificado |
| R-PROXY-01 | Mismo origen verificado en el entorno desplegado | §5 | Suite post-deploy | Planificado |
| R-CI-01 | CI: lint, typecheck, unitarios, integración, E2E, a11y | §11 | Actions en verde | Planificado |

### 2.4 Experiencia y accesibilidad

| ID | Requisito | Verificación prevista | Estado |
|---|---|---|---|
| R-UX-01 | Estados de carga, vacíos y de error en cada vista de datos | Revisión del finish gate | Planificado |
| R-A11Y-01 | WCAG 2.2 AA: contraste, teclado, lectores de pantalla, foco no tapado, resumen de errores | axe + pruebas manuales con teclado | Planificado |
| R-A11Y-02 | `prefers-reduced-motion` | Playwright con emulación | Planificado |
| R-RESP-01 | 375, 768, 1024, 1440 px | Capturas visuales | Planificado |
| R-DESIGN-01 | Sin apariencia de plantilla ni de IA (lista de prohibidos de la propuesta §2.1 y §2.4) | Finish gate PASS por pantalla | Planificado |

---

## 3. Riesgos

El registro completo está en la propuesta, §14 (R1–R16). Resumen de los que requieren atención temprana:

| Riesgo | Cuándo se mitiga |
|---|---|
| R7 Fotos de stock que no coinciden con la carta | M1, antes de escribir la carta definitiva |
| R9 Redondeo fiscal | M5, con tests de tabla antes de la UI |
| R10 Carreras en pagos | M6, con tests de concurrencia |
| R5 Bypass del proxy | M10, con la suite post-deploy |
| R2/R3 Cuotas de Neon y Render | M10, con alertas. P09 se resolvió como D9 (monitoreo 24/7). R3 tiene impacto alto: ≈744 h de 750 h en un mes de 31 días (ver la propuesta, §14) |
| Límites por ventanas: la aproximación deslizante puede contar de menos los intentos repartidos entre dos ventanas (M3, ver `SECURITY.md`) | Se conserva el algoritmo de §8.4; revisión en M9 |
| R21 Cantidades totales mayores que 20 (fusión o edición) | M5, con la regla definitiva de C5: límite de 20 solo por línea interna, edición del total sin tope de 20, reorganización automática y presentación como un único producto |

---

## 4. Suposiciones 📌

| ID | Suposición | Cómo se valida |
|---|---|---|
| S1 | El IVA general de Costa Rica es 13 % y los precios al consumidor se muestran con impuestos incluidos | Solo es configuración de demo; no es asesoramiento. Validar con un profesional si se usara en la realidad. |
| S2 | El cargo de servicio del 10 % aplica a consumo en el local | Ídem; queda inactivo por defecto. |
| S3 | Cobrar al colón entero es la práctica habitual | Configurable (`roundingIncrementMinor`). |
| S4 | 引潮 es una forma válida de escribir "marea baja / reflujo" | Revisión de un hablante nativo. |
| S5 | El tráfico de la demo es bajo (decenas de visitas diarias) | Monitoreo de cuotas. |
| S6 | Unas 60 fotos en 4 variantes ocupan menos de 1 crédito de Cloudinary en almacenamiento | Medición en M1. |
| S7 | Barrio Escalante existe; la dirección exacta del local es ficticia | Rótulo explícito en el sitio. |

---

## 5. Limitaciones de proveedores (verificadas el 9/11/2026)

| Proveedor | Limitación | Fuente |
|---|---|---|
| Render Free | Se duerme a los 15 min (≈1 min para despertar); 750 h/mes por workspace y suspensión al agotarlas; SMTP bloqueado; Postgres gratis expira a los 30 días; "no usar en producción" | https://render.com/docs/free |
| Neon Free | 1 GB por proyecto; 100 CU-h/mes; 5 GB de egreso; se duerme a los 5 min; 6 h de historial; suspensión del cómputo al agotar cuotas; bloqueo de escrituras al pasar 1 GB; no borra datos | https://neon.com/pricing |
| Resend Free | 3.000/mes, 100/día; `resend.dev` solo envía al correo de la cuenta | https://resend.com/pricing · https://resend.com/docs/knowledge-base/403-error-resend-dev-domain |
| Cloudflare Workers Free | 100.000 req/día del Worker (error 1027 o 429 al exceder); 10 ms de CPU; assets estáticos gratis e ilimitados | https://developers.cloudflare.com/workers/platform/limits/ · https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/ |
| Cloudflare Pages | 500 builds/mes, 20.000 archivos, 25 MiB (alternativa a Workers) | https://developers.cloudflare.com/pages/platform/limits/ |
| Cloudflare R2 | 10 GB-mes, 1 M de operaciones A, 10 M de operaciones B, egreso gratis; el excedente se factura | https://developers.cloudflare.com/r2/pricing/ |
| Backblaze B2 | 10 GB gratis; egreso gratis hasta 3× lo almacenado; el excedente se factura | https://www.backblaze.com/cloud-storage/pricing |
| Cloudinary Free | 25 créditos/mes; sin tarjeta; comportamiento al exceder no documentado | https://cloudinary.com/pricing · https://cloudinary.com/documentation/developer_onboarding_faq_free_plan |
| Supabase Free | 500 MB; se pausa tras 7 días de inactividad; 2 proyectos activos | https://supabase.com/pricing |
| UptimeRobot Free | 50 monitores cada 5 min; uso comercial permitido | https://uptimerobot.com/pricing/ |
| Turnstile Free | Desafíos ilimitados; 20 widgets; no requiere otros servicios de Cloudflare | https://developers.cloudflare.com/turnstile/plans/ |
| Unsplash / Pexels | Uso comercial permitido, atribución opcional; restricciones de reventa y de uso como marca; Unsplash+ excluido | https://unsplash.com/license · https://www.pexels.com/license/ |
| React Router | `prerender` + `ssr:false` genera HTML y `.data` por ruta y un fallback SPA | https://reactrouter.com/how-to/pre-rendering |

**No verificados ❓:** si piden tarjeta Cloudflare, Render, B2, R2 y Resend; los ToS de uso comercial de Render, Neon y Cloudinary; qué hace Cloudinary al exceder la cuota; minutos de GitHub Actions; ventanas de mantenimiento de UptimeRobot; Brevo y Sentry (sus páginas no devolvieron datos); precios de dominios. Se verifican antes de configurar cada servicio.

---

## 6. Herramientas y agentes usados en la planificación

Registro de lo que se ejecutó, sin exagerar.

| Herramienta | Uso real |
|---|---|
| UI/UX Pro Max | Ejecuté búsquedas de su base local: sistema de diseño de restaurante, tipografía, resumen de errores en formularios, foco no tapado. Tomé sus reglas de accesibilidad; descarté su paleta genérica. |
| `design-ui-finish-gate-reviewer` | Cargué el skill y apliqué su plantilla de **contrato de diseño** por pantalla (propuesta §2.4). Su *finish gate* se aplicará al implementar. |
| find-skills | Leí sus instrucciones. **No** ejecuté búsquedas ni instalé skills. |
| Agency Agents | Los identifiqué y asigné por hito. En la planificación **no** se lanzaron como subagentes; se usarán en la implementación. |
| Impeccable, Taste Skill, Web Design Guidelines, Apple Design Guidelines, Brand Guidelines, Awesome Design MD, SkillUI, ECC | **No instalados.** No se usaron. |
| Búsqueda y lectura web | Páginas oficiales listadas en §5. |

---

## 7. Lista de verificación para la auditoría final (al terminar el desarrollo)

- [ ] Todos los requisitos de §2 en estado *Verificado*, con su evidencia enlazada.
- [ ] Suite post-deploy en verde contra la URL pública.
- [ ] Restauración de backup probada y documentada.
- [ ] Finish gate PASS en todas las pantallas a 4 anchos.
- [ ] axe sin violaciones serias o críticas.
- [ ] Escaneo de secretos limpio; `.env.example` sin valores reales.
- [ ] `CREDITS.md` completo, con una licencia verificada por foto.
- [ ] Ningún documento declara implementado algo que no existe.
