# Operación y monitoreo (M10, ADR 0010 D-M10-9)

> **Estado (26/11/2026):** preparado, **sin monitores ni cuentas**. UptimeRobot lo configura el propietario cuando la URL pública responda ([DEPLOYMENT.md](../../DEPLOYMENT.md), sección 1).

## UptimeRobot (D9) — Propietario

| Monitor | Tipo | URL | Intervalo | Esperado |
|---|---|---|---|---|
| API por el Worker | Keyword | `https://<worker>.workers.dev/api/health` | 5 min | La palabra `ok` |
| Sitio (assets) | Keyword | `https://<worker>.workers.dev/` | 5 min | La palabra `Marea Baja` |

- **Avisos:** caída y recuperación, por correo al propietario, después de **2 fallos seguidos**. El canal exacto depende de lo que incluya el plan gratuito (V8: confirmarlo al crear la cuenta).
- **Tiempo de respuesta mayor que 10 s:** degradado. El despertar en frío de Render tarda ≈ 1 min y no debería pasar con el monitor activo.
- **No se monitorea `/api/health/ready`:** despertaría la base cada 5 min (R-M10-1). Lo usan el despliegue y la suite post-deploy.

## Avisos de GitHub Actions

Los workflows **Backup**, **Web y Worker** y **Migraciones de producción** avisan por correo cuando fallan (notificaciones de Actions del propietario: *Settings → Notifications → Actions → "Only notify for failed workflows"*).

## Revisión semanal durante el primer mes; después, mensual

| Qué | Dónde | Umbral de alerta |
|---|---|---|
| CU-h de Neon | Consola de Neon → *Usage* | Más del 80 % de 100 CU-h en el mes (proyección). La estimación de diseño es ≈ 50 CU-h (D-M10-1) |
| Egreso y almacenamiento de Neon | Consola de Neon | Más del 80 % de 5 GB / 1 GB |
| Horas de Render | Panel de Render → *Usage* | Proyección > 740 h (R3, C8: margen ≈ 6 h) |
| Invocaciones del Worker | Cloudflare → Workers → *Metrics* | Más de 50.000 por día (límite: 100.000) |
| Cron de tareas | Cloudflare → Worker → *Cron Triggers* | Algún 4xx o 5xx, o sin ejecuciones |
| Último backup válido | Actions → **Backup** | Más de 8 días sin un `restore-test` en verde |
| Workflows programados activos | Actions → cada workflow | Alguno "disabled" (D-M10-P9: GitHub los apaga después de 60 días sin actividad en un repositorio público). Se reactivan con *Enable workflow* |
| Correos | Resend → *Logs* | Rebotes o más de 80 al día (límite: 100) |

## Registro de incidentes

| Fecha | Qué pasó | Causa | Datos afectados | Tiempo hasta recuperar | Cambios |
|---|---|---|---|---|---|
| — | — | — | — | — | — |
