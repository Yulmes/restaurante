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
trap 'rm -rf "$TMP"' EXIT
age-keygen -o "$TMP/key.txt" 2>/dev/null
RECIPIENT="$(age-keygen -y "$TMP/key.txt")"

export BACKUP_LOCATION="file://$TMP/bucket"

log "1/4 backup"
BACKUP_DATABASE_URL="$SOURCE_DATABASE_URL" AGE_RECIPIENT="$RECIPIENT" BACKUP_REASON=selftest "$HERE/backup.sh"

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

log "4/4 restauración completa"
AGE_IDENTITY="$(cat "$TMP/key.txt")" "$HERE/restore-test.sh"
log "OK: selftest de backup y restauración"
