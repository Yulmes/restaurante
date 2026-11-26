# Pruebas después del despliegue (M10-7)

> **Estado (26/11/2026):** **pendientes.** No hay URL pública. Estas pruebas cierran lo que no se puede probar en local (§11 "Post-deploy"; ADR 0010). Ninguna se da por hecha antes de correrla contra la URL real.
>
> Variables de las pruebas:
> - `SITE` = `https://<worker>.workers.dev`;
> - `RENDER` = `https://<servicio>.onrender.com`;
> - el secreto de origen, solo donde se indica y nunca en un log público.

## 1 · Proxy, secreto de origen e IP (D-M10-2)

| # | Prueba | Esperado |
|---|---|---|
| 1.1 | `curl -i $RENDER/api/auth/csrf` (directo, sin secreto) | 403 `ORIGIN_FORBIDDEN` |
| 1.2 | `curl -i $RENDER/api/auth/csrf -H 'X-Origin-Auth: falso' -H 'X-Client-IP: 1.2.3.4'` | 403 |
| 1.3 | `curl -i $SITE/api/auth/csrf` | 200 |
| 1.4 | **La limitación que M10-0 dejó abierta.** Desde un equipo con IP pública conocida, `curl $SITE/api/...` con `CF-Connecting-IP: 198.51.100.7`, `X-Client-IP: 198.51.100.8` y `X-Forwarded-For: 198.51.100.9` falsos, repetido hasta pasar un límite por IP (por ejemplo, 6 registros: §8.4, 5 por hora) | El 6.º responde 429. Desde **otra** red (datos del celular), un registro responde 202. O sea: el límite se aplicó a la IP real y no a la falsa |
| 1.5 | `$SITE/api/health` desde UptimeRobot | 200, sin despertar la base |
| 1.6 | `/api/health/ready` por `$RENDER` con el secreto | 200 `{"status":"ready"}` |

## 2 · Cookies, CSRF y sesión (§11, R-SEC-02, R-SEC-04)

| # | Prueba | Esperado |
|---|---|---|
| 2.1 | Iniciar sesión en `$SITE` y mirar la cookie | `__Host-mb_session`, con `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/` y sin `Domain` |
| 2.2 | `POST $SITE/api/auth/logout` con `Origin: https://otro.example` | 403 `CSRF_FAILED` |
| 2.3 | Cerrar sesión, recuperar la contraseña con la cuenta del propietario (llega el correo real) y entrar con la nueva | Funciona; las otras sesiones quedan cerradas |
| 2.4 | `curl -i -H 'Origin: https://otro.example' $SITE/api/public/catalog` | Sin `Access-Control-Allow-Origin` |

## 3 · Turnstile real (D-M10-10)

1. Con la cuenta admin, bajar `turnstileGlobalThreshold` a 2 en la configuración (queda en el AuditLog).
2. Con una cuenta de prueba, fallar el login 2 veces.
3. Comprobar:
   - **sin token** → 403 `CHALLENGE_REQUIRED`;
   - **token real** del widget → se evalúa la contraseña;
   - **token reusado o vencido** → 403 `CHALLENGE_FAILED`.
4. Restaurar el umbral (50).

## 4 · CSP en la URL pública (D-M10-5)

1. Correr la suite `e2e/produccion/csp.spec.ts` contra `$SITE`. Es la misma que corre en CI contra el build local; se apunta cambiando `WEB_URL` en una copia local de la configuración, sin levantar servidores. Esperado: 0 violaciones en las páginas del sitemap, las rutas de la SPA y los flujos.
2. Cabeceras: `curl -sI $SITE/ | grep -i -E 'content-security-policy|x-content-type|referrer|permissions'`. Esperado: las de `SECURITY_HEADERS`.
3. Una ruta de la SPA (`$SITE/cuenta/ingresar`) trae las mismas cabeceras: las pone el Worker.

## 5 · Demo (D-M10-P1, P2, P3)

1. **Recorrido de un visitante:** registrar una cuenta con un correo que **no** es el del propietario → la bandeja muestra el correo `DEMO_ONLY` con "Verificar (demo)" → verificar → pedir con la tarjeta demo, escenario "pendiente", y ver que se aprueba en unos 20 s.
2. **Fuera del horario del local:** el pedido se acepta (`ORDERS_ALLOW_OUTSIDE_HOURS`).
3. **Correo del propietario:** el correo de verificación llega de verdad (`SENT`) y la bandeja **no** ofrece "Verificar (demo)".

## 6 · Tareas, Neon y backups (D-M10-1, D-M10-8)

1. **Cron:** Cloudflare → Worker → *Cron Triggers* → *Past events*. Una ejecución cada 30 min, con 200 y conteos.
2. **Neon:** dejar el sitio sin visitas 15 min. La consola muestra el cómputo suspendido (con UptimeRobot activo).
3. **Backup:** correr el workflow **Backup** a mano. El job `restore-test` en verde es **la primera restauración real (criterio de cierre de M10)**.

## 7 · Criterios de M4 aplazados

LCP móvil < 2,5 s en la URL pública (Lighthouse, 3 corridas, mediana); validadores externos de JSON-LD y `hreflang`; que `VITE_SITE_URL` produce canónicas y sitemap con la URL pública.

## 8 · Validaciones humanas que conviene hacer aquí

- **Safari de iOS real:** los 9 escenarios de `docs/m9/PRUEBAS_HUMANAS_M9.md`, contra `$SITE`.
- **Revisión nativa de 引潮 (V2):** antes de anunciar el sitio.
