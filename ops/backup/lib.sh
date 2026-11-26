#!/usr/bin/env bash
# Funciones comunes de backup y restauración (ADR 0010, D-M10-8; §10).
# Nunca imprimen URLs, claves ni datos: solo pasos, tamaños y conteos.
set -euo pipefail

log() { printf '[%s] %s\n' "$(date -u +%H:%M:%SZ)" "$*"; }
fail() {
  log "FAIL: $*"
  exit 1
}
need() { for v in "$@"; do [ -n "${!v:-}" ] || fail "falta la variable $v"; done; }
need_cmd() { for c in "$@"; do command -v "$c" >/dev/null 2>&1 || fail "falta el comando $c"; done; }

# Conteo de filas por tabla del esquema public, como `tabla=n,tabla=n` (sin datos).
count_rows() {
  psql "$1" -At -v ON_ERROR_STOP=1 -f "$(dirname "${BASH_SOURCE[0]}")/count-rows.sql"
}

# Destino o fuente: file:///ruta o s3://bucket/prefijo (B2 por su API compatible con S3).
storage_put() { # archivo_local clave
  case "$BACKUP_LOCATION" in
    file://*)
      local dir="${BACKUP_LOCATION#file://}"
      mkdir -p "$dir/$(dirname "$2")"
      cp "$1" "$dir/$2"
      ;;
    s3://*)
      need B2_S3_ENDPOINT
      aws s3 cp --only-show-errors --endpoint-url "$B2_S3_ENDPOINT" "$1" "$BACKUP_LOCATION/$2"
      ;;
    *) fail "BACKUP_LOCATION debe empezar con file:// o s3://" ;;
  esac
}

storage_get() { # clave archivo_local
  case "$BACKUP_LOCATION" in
    file://*) cp "${BACKUP_LOCATION#file://}/$1" "$2" ;;
    s3://*)
      need B2_S3_ENDPOINT
      aws s3 cp --only-show-errors --endpoint-url "$B2_S3_ENDPOINT" "$BACKUP_LOCATION/$1" "$2"
      ;;
    *) fail "BACKUP_LOCATION debe empezar con file:// o s3://" ;;
  esac
}

# Lee un campo de un JSON (con node, que ya está en el runner).
json_get() { # archivo campo
  node "$(dirname "${BASH_SOURCE[0]}")/json-get.js" "$1" "$2"
}
