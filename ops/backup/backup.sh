#!/usr/bin/env bash
# Backup cifrado de PostgreSQL (ADR 0010, D-M10-8; §10, D7).
#
#   BACKUP_DATABASE_URL  rol backup_reader (solo lectura); en Neon, con sslmode=require
#   AGE_RECIPIENT        clave PÚBLICA de age (la privada nunca está en el job del backup)
#   BACKUP_LOCATION      s3://bucket/prefijo (B2, clave de solo escritura) o file:///ruta (pruebas)
#   B2_S3_ENDPOINT, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY   solo con s3://
#   BACKUP_REASON        weekly | manual | pre-migration (queda en el manifiesto)
#
# Pasos: pg_dump -Fc → pg_restore --list (se puede leer) → conteos por tabla → age → SHA-256 →
# sube <ts>/dump.age y <ts>/manifest.json → actualiza latest.json. La retención es la regla de
# ciclo de vida del bucket (56 días ≈ 8 semanas): la clave del backup no puede borrar.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"

need BACKUP_DATABASE_URL AGE_RECIPIENT BACKUP_LOCATION
need_cmd pg_dump pg_restore psql age sha256sum node

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
TS="$(date -u +%Y%m%dT%H%M%SZ)"
REASON="${BACKUP_REASON:-manual}"

log "volcado (pg_dump -Fc, sin dueños)"
pg_dump --format=custom --no-owner --dbname="$BACKUP_DATABASE_URL" --file="$WORK/dump.pgc"
pg_restore --list "$WORK/dump.pgc" >"$WORK/list.txt" || fail "pg_restore no puede leer el volcado"
ENTRIES="$(grep -cv '^;' "$WORK/list.txt" || true)"
[ "$ENTRIES" -gt 0 ] || fail "el volcado no tiene entradas"
COUNTS="$(count_rows "$BACKUP_DATABASE_URL")"
[ -n "$COUNTS" ] || fail "no se pudieron contar las tablas"

log "cifrado (age) y SHA-256"
age --encrypt --recipient "$AGE_RECIPIENT" --output "$WORK/dump.age" "$WORK/dump.pgc"
rm -f "$WORK/dump.pgc"
SHA="$(sha256sum "$WORK/dump.age" | cut -d' ' -f1)"
BYTES="$(wc -c <"$WORK/dump.age" | tr -d ' ')"
PGV="$(pg_dump --version | awk '{print $3}')"
node "$HERE/manifest.js" write "$TS" "$REASON" "$SHA" "$BYTES" "$PGV" "$ENTRIES" "$COUNTS" >"$WORK/manifest.json"
printf '{"manifest":"%s/manifest.json"}\n' "$TS" >"$WORK/latest.json"

log "subida"
storage_put "$WORK/dump.age" "$TS/dump.age"
storage_put "$WORK/manifest.json" "$TS/manifest.json"
storage_put "$WORK/latest.json" "latest.json"

TABLES="$(printf '%s\n' "$COUNTS" | tr ',' '\n' | wc -l | tr -d ' ')"
log "OK: backup $TS ($REASON), $BYTES bytes cifrados, $ENTRIES entradas, $TABLES tablas"
