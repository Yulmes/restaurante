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

# Volcado y conteos sobre la MISMA foto de la base: una sesión abre una transacción REPEATABLE READ,
# exporta su snapshot, pg_dump lo usa (--snapshot) y los conteos se toman en esa misma transacción.
# Así, aunque haya pedidos entrando durante el backup, el manifiesto describe exactamente el volcado.
# (En Neon, BACKUP_DATABASE_URL tiene que ser la conexión directa, no la del pooler.)
log "foto consistente de la base"
coproc SNAP { psql "$BACKUP_DATABASE_URL" -X -q -At -v ON_ERROR_STOP=1; }
SNAP_IN="${SNAP[1]}"
SNAP_OUT="${SNAP[0]}"
printf '%s\n' "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;" "SELECT pg_export_snapshot();" >&"$SNAP_IN"
read -r -t 60 SNAPSHOT <&"$SNAP_OUT" || fail "no se pudo exportar el snapshot"
[[ "$SNAPSHOT" =~ ^[0-9A-F-]+$ ]] || fail "snapshot inválido"

log "volcado (pg_dump -Fc, sin dueños)"
pg_dump --format=custom --no-owner --snapshot="$SNAPSHOT" --dbname="$BACKUP_DATABASE_URL" --file="$WORK/dump.pgc"
printf '%s\n' "\\i $HERE/count-rows.sql" >&"$SNAP_IN"
read -r -t 120 COUNTS <&"$SNAP_OUT" || fail "no se pudieron contar las tablas"
printf '%s\n' "COMMIT;" '\q' >&"$SNAP_IN"
wait "$SNAP_PID" 2>/dev/null || true
[ -n "$COUNTS" ] || fail "no se pudieron contar las tablas"

pg_restore --list "$WORK/dump.pgc" >"$WORK/list.txt" || fail "pg_restore no puede leer el volcado"
ENTRIES="$(grep -cv '^;' "$WORK/list.txt" || true)"
[ "$ENTRIES" -gt 0 ] || fail "el volcado no tiene entradas"

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
