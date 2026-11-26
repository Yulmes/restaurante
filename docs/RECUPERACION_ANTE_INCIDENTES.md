# Recuperación ante incidentes

> **Estado (26/11/2026):** procedimiento preparado en M10-1 (ADR 0010, D-M10-8; §10, D7). **Todavía no se probó contra producción:** la primera restauración real es el criterio de cierre de M10. El circuito completo (backup cifrado → restauración → conteos → migraciones → humo de la API) se prueba en cada CI contra una base local (`npm run backup:selftest`).

## Objetivos

- **RPO:**
  - casi 0 si el incidente se detecta dentro de las **6 h** (restauración instantánea de Neon Free, verificada el 26/11/2026);
  - si no, hasta **7 días** (backup semanal en B2).
- **RTO: 1 h.**

## Qué existe

| Copia | Dónde | Cifrado | Retención |
|---|---|---|---|
| Historial de Neon | Neon (restauración instantánea, rama) | Neon | 6 h / 1 GB de cambios |
| Snapshot manual | Neon (1 en Free) | Neon | Hasta reemplazarlo |
| Backup semanal y previo a migraciones | B2, bucket privado: `<ts>/dump.age` + `<ts>/manifest.json`, y `latest.json` | `age` (clave pública en el job; la privada, del propietario) | 56 días (≈ 8 semanas) |
| Copia mensual local | Disco del propietario | `age` | La que decida el propietario |

El manifiesto tiene el SHA-256 del archivo cifrado, la versión de `pg_dump` y el conteo de filas de cada tabla. **Nunca** tiene datos.

## Escenario A · Error de datos detectado dentro de las 6 h

1. **Detener las escrituras dañinas:** Render → *Suspend* del servicio. La web sigue publicada y `/api/*` responde 502.
2. **Restaurar:** Neon → *Restore* (o *Branches → Create branch* en el instante anterior al incidente).
3. **Verificar la rama restaurada**, apuntando la verificación a la URL de esa rama:
   - `prisma migrate status`, con `MIGRATION_DATABASE_URL` de esa rama;
   - `node apps/api/scripts/restore-smoke.ts`, con `RESTORE_DATABASE_URL` de esa rama.
4. **Pasar la rama a producción:** promoverla a principal, o cambiar `DATABASE_URL` en Render al endpoint de la rama, y reanudar el servicio.
5. **Comprobar:** `/api/health/ready` (con el secreto de origen) y la suite post-deploy reducida ([POST_DEPLOY.md](m10/POST_DEPLOY.md)).

## Escenario B · Pasaron más de 6 h, o se perdió el proyecto de Neon

1. **Backup:** elegir uno en B2 (`latest.json` o un `<ts>/manifest.json` concreto).
2. **Base destino:**
   - un proyecto o una rama de Neon nueva y vacía;
   - el grupo de la aplicación creado antes de restaurar ([`ops/backup/app-role.sql`](../ops/backup/app-role.sql)).
3. **Restaurar desde la máquina del propietario**, con la clave privada que guarda él, como hace la prueba automática:
   ```bash
   BACKUP_LOCATION=s3://<bucket>/marea-baja B2_S3_ENDPOINT=<endpoint> \
   AWS_ACCESS_KEY_ID=<lectura> AWS_SECRET_ACCESS_KEY=<lectura> \
   AGE_IDENTITY="$(cat marea-baja-backup.key)" \
   RESTORE_ADMIN_URL=<url del propietario de la base nueva, base postgres> KEEP_RESTORED_DB=1 \
   bash ops/backup/restore-test.sh
   ```
   - El script verifica el SHA-256, descifra, restaura con `--exit-on-error`, compara los conteos con el manifiesto, corre `prisma migrate status` y el humo de la API.
   - Con `KEEP_RESTORED_DB=1` deja la base restaurada (la imprime).
4. **Usuarios:** crear `marea_app` y `backup_reader` ([DEPLOYMENT.md](../DEPLOYMENT.md), sección 2).
5. **Pasar a producción:** apuntar `DATABASE_URL` de Render a la base nueva, desplegar y comprobar como en A.5.
6. **Datos perdidos:** se pierde lo posterior al backup (hasta 7 días). Los pedidos de la demo son ficticios; se avisa en el registro del incidente.

## Escenario C · Secreto expuesto

| Secreto | Rotación |
|---|---|
| Secreto de origen | Render: `ORIGIN_SECRETS=viejo,nuevo` → Worker y GitHub (`ORIGIN_SECRET`) con el nuevo → Render: `ORIGIN_SECRETS=nuevo` |
| Secreto de tareas | Igual, con `TASKS_SECRETS` / `TASKS_SECRET` |
| `APP_SECRET` | Cambiarlo en Render. Invalida los tokens CSRF de invitados y reinicia los contadores por IP (usan hash con ese secreto) |
| URL de la base | Neon → nueva contraseña del rol → Render (`DATABASE_URL`) o GitHub (`MIGRATION_DATABASE_URL`, `BACKUP_DATABASE_URL`) |
| Claves de B2 | Crear la clave nueva → actualizar el environment → borrar la vieja |
| Clave privada de `age` | Generar un par nuevo. Los backups viejos siguen necesitando la clave vieja: guardarla hasta que venzan (56 días) |
| Resend, Turnstile, token de Cloudflare | Regenerarlos en su panel y actualizar el lugar correspondiente |

## Escenario D · Neon suspendido por consumo (CU-h o egreso)

- **Síntomas:**
  - las conexiones fallan con SQLSTATE 53000;
  - `/api/health/ready` da 503;
  - el backup falla.
- **Acción:**
  1. Confirmarlo en la consola de Neon.
  2. Con aprobación del propietario: esperar al mes siguiente, subir de plan (costo) o mover la base (escenario B).
  3. Revisar por qué el consumo superó la estimación (D-M10-1): tráfico real o tareas.

## Después de cada incidente

Registrar fecha, causa, datos afectados, tiempo hasta recuperar y cambios. El registro va en `docs/m10/OPERACION.md` mientras no haya otro lugar.
