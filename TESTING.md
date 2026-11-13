# Pruebas

Este documento crece con cada hito. Solo describe pruebas que ya existen.

## Comandos

| Comando | Qué corre |
|---|---|
| `npm run check` | Formato, lint (con la regla de textos i18n), tipos y pruebas unitarias |
| `npm run test` | Vitest: pruebas unitarias de todos los paquetes |
| `npm run test:e2e -w @marea-baja/web` | Playwright: navegador real contra el servidor de desarrollo |
| `npm run capturas -w @marea-baja/web` (con `CAPTURAS=1`) | Regenera las capturas de evidencia en `docs/evidencias/m1/` |
| `npm run glyphs -w @marea-baja/web` | Informe de glifos por fuente, peso y subconjunto (V3) |

Primera vez con Playwright: `npx playwright install chromium` dentro de `apps/web`.

## Qué cubre M1

| Prueba | Archivo | Validación |
|---|---|---|
| Contraste WCAG de los pares de la paleta | `apps/web/app/design/contrast.test.ts` | D1 / V1 |
| Glifos de las tipografías aprobadas y ₡ por respaldo (lectura de `cmap`) | `apps/web/scripts/check-glyphs.test.ts` | V3 |
| Formato de precios CRC/USD por idioma | `packages/shared/src/money/format.test.ts` | V4 |
| Paridad de mensajes es-CR / en | `apps/web/app/i18n/messages.test.ts` | D2 |
| Rutas por idioma | `apps/web/app/i18n/locale.test.ts` | D2 |
| axe-core WCAG 2.2 AA en todas las páginas, también después de interactuar | `apps/web/e2e/a11y.spec.ts` | V1 |
| Teclado: saltar al contenido, foco visible y no tapado, error y deshabilitado accesibles, cantidad sin tope (C5), botón de ancho estable | `apps/web/e2e/keyboard.spec.ts` | §3.10, C5 |
| Idiomas: `lang`, título, selector con `hreflang` y `aria-current`, formato de precios, `noindex` | `apps/web/e2e/i18n.spec.ts` | D2 |
| Responsive en 375, 768, 1024 y 1440 px por idioma; legibilidad de precios; ₡ con fuente de respaldo; movimiento reducido | `apps/web/e2e/responsive.spec.ts` | V5, D1 |

**Límites conocidos:** axe no mide el contraste de texto sobre fotografías ni la calidad del anillo de foco. Eso se revisa a mano con capturas. La prueba con lector de pantalla (NVDA) es manual (ver `docs/m1/VALIDACIONES_M1.md`).

## Skill de auditoría *Web Design Guidelines* (D12)

- **Qué es:** skill de Claude Code publicada por Vercel (`vercel-labs/agent-skills`, skill `web-design-guidelines`, metadato `version: 1.0.0`). Revisa archivos de interfaz contra las [Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines) y descarga las reglas vigentes en cada revisión.
- **Instalación (hecha al inicio de M1, 10/11/2026), a nivel de usuario y solo para Claude Code:**

  ```bash
  npx skills@1.7.6 add vercel-labs/agent-skills --skill web-design-guidelines --agent claude-code --global --yes
  ```

  Queda en `~/.claude/skills/web-design-guidelines/` (fuera del repositorio). Se instaló solo esta skill de las 8 del paquete, con la telemetría del CLI desactivada (`DO_NOT_TRACK=1`, `DISABLE_TELEMETRY=1`).
- **Cuándo se usa:** al cerrar M1 (sistema de diseño) y en M9 (auditoría final de pantallas), siempre sobre los archivos de componentes y rutas.
- **Cómo se evalúan sus hallazgos:** es un **apoyo**. Cada hallazgo se contrasta con el sistema de diseño aprobado (D1) y la propuesta. Si contradice una decisión aprobada (por ejemplo, Title Case frente a la ortografía española), no se aplica y se deja registrado. **Nunca modifica por sí sola la identidad visual.** Los hallazgos de M1 y su resolución están en `docs/m1/VALIDACIONES_M1.md`.
