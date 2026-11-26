#!/usr/bin/env bash
# Prueba de restauración (ADR 0010, D-M10-8; §10, D7). Nunca toca producción.
#
#   BACKUP_LOCATION      s3://… (B2, clave de SOLO LECTURA, distinta de la de escritura) o file:///…
#   AGE_IDENTITY         clave PRIVADA de age (environment `restore-test`)
#   RESTORE_ADMIN_URL    PostgreSQL efímero (superusuario), base `postgres`
#   MAX_AGE_DAYS         antigüedad máxima aceptada del backup (8 por defecto)
#   BACKUP_KEY           opcional: un <ts>/manifest.json concreto (si no, latest.json)
#   SKIP_APP_CHECKS      opcional (1): omite `prisma migrate status` y el humo (solo en pruebas sin repo)
#   KEEP_RESTORED_DB     opcional (1): no borra la base restaurada (solo pruebas locales)
#   ALLOW_REMOTE_RESTORE opcional (1): permite un servidor que no es local (incidentes; nunca en CI)
#
# Pasos: manifiesto → antigüedad → descarga → SHA-256 → descifra → pg_restore --list → base nueva →
# restaura con --exit-on-error → conteos iguales al manifiesto → `prisma migrate status` sin
# pendientes → humo de la aplicación (apps/api/scripts/restore-smoke.ts) → borra base y archivos.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"

need BACKUP_LOCATION AGE_IDENTITY RESTORE_ADMIN_URL
need_cmd node

# Aislamiento: por defecto solo restaura en un PostgreSQL local o del runner (localhost, 127.0.0.1,
# ::1, o el servicio `postgres` de Docker Compose). Restaurar en otro servidor (por ejemplo, una base
# nueva de Neon durante un incidente) exige ALLOW_REMOTE_RESTORE=1 explícito (RECUPERACION_ANTE_INCIDENTES.md).
RESTORE_HOST="$(node -e 'console.log(new URL(process.argv[1]).hostname)' "$RESTORE_ADMIN_URL")"
case "$RESTORE_HOST" in
  localhost | 127.0.0.1 | '[::1]' | ::1 | postgres) ;;
  *) [ "${ALLOW_REMOTE_RESTORE:-0}" = "1" ] || fail "RESTORE_ADMIN_URL no es local; para restaurar en otro servidor, ALLOW_REMOTE_RESTORE=1" ;;
esac
need_cmd pg_restore psql age sha256sum

WORK="$(mktemp -d)"
DB="restore_test_$(date -u +%Y%m%d%H%M%S)_$$"
cleanup() {
  # KEEP_RESTORED_DB=1 (solo pruebas locales) deja la base para revisarla; si no, se borra siempre.
  if [ "${KEEP_RESTORED_DB:-0}" = "1" ]; then
    log "base conservada: $DB"
  else
    psql "$RESTORE_ADMIN_URL" -q -c "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE)" >/dev/null 2>&1 || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

if [ -n "${BACKUP_KEY:-}" ]; then
  MANIFEST_KEY="$BACKUP_KEY"
else
  storage_get "latest.json" "$WORK/latest.json"
  MANIFEST_KEY="$(json_get "$WORK/latest.json" manifest)"
fi
storage_get "$MANIFEST_KEY" "$WORK/manifest.json"
FILE="$(json_get "$WORK/manifest.json" file)"
EXPECTED_SHA="$(json_get "$WORK/manifest.json" sha256)"
CREATED="$(json_get "$WORK/manifest.json" createdAt)"
log "manifiesto $CREATED"
node "$HERE/manifest.js" age "$WORK/manifest.json" "${MAX_AGE_DAYS:-8}" || fail "backup demasiado viejo"

storage_get "$FILE" "$WORK/dump.age"
ACTUAL_SHA="$(sha256sum "$WORK/dump.age" | cut -d' ' -f1)"
[ "$ACTUAL_SHA" = "$EXPECTED_SHA" ] || fail "el SHA-256 no coincide con el manifiesto"
log "SHA-256 verificado"

umask 077
printf '%s\n' "$AGE_IDENTITY" >"$WORK/identity.txt"
age --decrypt --identity "$WORK/identity.txt" --output "$WORK/dump.pgc" "$WORK/dump.age"
rm -f "$WORK/identity.txt" "$WORK/dump.age"
pg_restore --list "$WORK/dump.pgc" >/dev/null || fail "el volcado descifrado no es válido"

log "restauración en una base efímera"
psql "$RESTORE_ADMIN_URL" -q -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$DB\"" >/dev/null
TARGET_URL="$(node -e 'const u = new URL(process.argv[1]); u.pathname = "/" + process.argv[2]; console.log(u.toString());' "$RESTORE_ADMIN_URL" "$DB")"
# Los permisos del volcado nombran el grupo de la aplicación (ADR 0003): tiene que existir.
psql "$TARGET_URL" -q -v ON_ERROR_STOP=1 -f "$HERE/app-role.sql" >/dev/null
pg_restore --no-owner --exit-on-error --dbname="$TARGET_URL" "$WORK/dump.pgc"
rm -f "$WORK/dump.pgc"

log "conteos contra el manifiesto"
COUNTS="$(count_rows "$TARGET_URL")"
node "$HERE/manifest.js" compare "$WORK/manifest.json" "$COUNTS" || fail "los conteos no coinciden"

if [ "${SKIP_APP_CHECKS:-0}" != "1" ]; then
  log "migraciones (prisma migrate status)"
  (cd "$ROOT/apps/api" && MIGRATION_DATABASE_URL="$TARGET_URL" npx --no-install prisma migrate status >/dev/null) ||
    fail "la base restaurada tiene migraciones pendientes o distintas"
  log "humo de la aplicación"
  (cd "$ROOT/apps/api" && RESTORE_DATABASE_URL="$TARGET_URL" node scripts/restore-smoke.ts) ||
    fail "la aplicación no funciona sobre la base restaurada"
fi

log "OK: restauración de $CREATED verificada"
