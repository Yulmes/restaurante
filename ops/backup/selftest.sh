#!/usr/bin/env bash
# Prueba de punta a punta del backup y la restauración contra una base local aislada (CI y local).
# Nunca usa B2 ni producción: guarda en un directorio temporal (file://) con un par de claves age
# recién generado, que se borra al terminar.
#
#   SOURCE_DATABASE_URL  base con la semilla (en CI, la de desarrollo del runner)
#   RESTORE_ADMIN_URL    superusuario del mismo servidor, base `postgres`
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"
need SOURCE_DATABASE_URL RESTORE_ADMIN_URL
need_cmd age-keygen

TMP="$(mktemp -d)"
WRITER=""
cleanup() {
  [ -n "$WRITER" ] && kill "$WRITER" 2>/dev/null || true
  psql "$SOURCE_DATABASE_URL" -q -c "DROP TABLE IF EXISTS backup_selftest_writes" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT
age-keygen -o "$TMP/key.txt" 2>/dev/null
RECIPIENT="$(age-keygen -y "$TMP/key.txt")"

export BACKUP_LOCATION="file://$TMP/bucket"

# Escrituras durante el backup, como los pedidos en producción: el manifiesto tiene que describir
# exactamente el volcado (mismo snapshot), aunque la base cambie mientras se vuelca.
psql "$SOURCE_DATABASE_URL" -q -v ON_ERROR_STOP=1 -c "CREATE TABLE backup_selftest_writes (id serial PRIMARY KEY)" >/dev/null
(for _ in $(seq 1 4000); do
  printf '%s\n' "INSERT INTO backup_selftest_writes DEFAULT VALUES;" "SELECT pg_sleep(0.002);"
done) | psql "$SOURCE_DATABASE_URL" -q -o /dev/null >/dev/null 2>&1 &
WRITER=$!
sleep 0.5

log "1/4 backup (con escrituras simultáneas)"
BACKUP_DATABASE_URL="$SOURCE_DATABASE_URL" AGE_RECIPIENT="$RECIPIENT" BACKUP_REASON=selftest "$HERE/backup.sh"
kill "$WRITER" 2>/dev/null || true
wait "$WRITER" 2>/dev/null || true
WRITER=""
AFTER="$(psql "$SOURCE_DATABASE_URL" -At -c "SELECT count(*) FROM backup_selftest_writes")"
log "filas escritas durante la prueba: $AFTER"

log "2/4 el volcado está cifrado (no se puede leer sin la clave)"
LATEST="$(json_get "$TMP/bucket/latest.json" manifest)"
DUMP="$TMP/bucket/$(json_get "$TMP/bucket/$LATEST" file)"
if pg_restore --list "$DUMP" >/dev/null 2>&1; then fail "el volcado se lee sin descifrar"; fi

log "3/4 un volcado alterado no se restaura"
cp "$DUMP" "$TMP/original.age"
printf 'x' >>"$DUMP"
if AGE_IDENTITY="$(cat "$TMP/key.txt")" "$HERE/restore-test.sh" >/dev/null 2>&1; then
  fail "se restauró un volcado alterado"
fi
cp "$TMP/original.age" "$DUMP"

log "la restauración se niega a un servidor que no es local"
if RESTORE_ADMIN_URL="postgresql://x:y@db.example.com:5432/postgres" AGE_IDENTITY="$(cat "$TMP/key.txt")"   "$HERE/restore-test.sh" >"$TMP/remote.log" 2>&1; then
  fail "restauró contra un servidor remoto sin ALLOW_REMOTE_RESTORE"
fi
grep -q "no es local" "$TMP/remote.log" || fail "no rechazó el servidor remoto por el motivo esperado"

log "4/4 restauración completa"
AGE_IDENTITY="$(cat "$TMP/key.txt")" "$HERE/restore-test.sh"
log "OK: selftest de backup y restauración"
