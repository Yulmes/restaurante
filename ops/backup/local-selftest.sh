#!/usr/bin/env bash
# Prueba completa del backup y la restauración contra la base local de Docker Compose (CI y local):
# `npm run backup:selftest`.
#
# 1. En un contenedor postgres:17.11-alpine (el mismo pg_dump que el servidor, con age y node), en
#    la red de Compose: backup cifrado a un directorio temporal, verificación de que no se lee sin
#    la clave, rechazo de un volcado alterado y restauración con conteos (`selftest.sh`).
# 2. En el equipo, contra la base restaurada: `prisma migrate status` y el humo de la aplicación.
# 3. Borra la base restaurada.
#
# Nunca usa B2 ni producción. Lee las credenciales locales de .env sin imprimirlas.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
[ -f .env ] || {
  echo "Falta .env (copiá .env.example)."
  exit 1
}
U="$(grep -E '^POSTGRES_USER=' .env | cut -d= -f2-)"
P="$(grep -E '^POSTGRES_PASSWORD=' .env | cut -d= -f2-)"
D="$(grep -E '^POSTGRES_DB=' .env | cut -d= -f2-)"
PORT="$(grep -E '^POSTGRES_PORT=' .env | cut -d= -f2- || true)"

# En Windows (Git Bash) el volumen necesita la ruta nativa.
MOUNT="$ROOT/ops"
if command -v cygpath >/dev/null 2>&1; then MOUNT="$(cygpath -m "$ROOT/ops")"; fi

OUT="$(MSYS_NO_PATHCONV=1 docker run --rm --network marea-baja_default \
  -v "$MOUNT:/ops:ro" \
  -e SOURCE_DATABASE_URL="postgresql://$U:$P@postgres:5432/$D" \
  -e RESTORE_ADMIN_URL="postgresql://$U:$P@postgres:5432/postgres" \
  -e SKIP_APP_CHECKS=1 \
  -e KEEP_RESTORED_DB=1 \
  postgres:17.11-alpine sh -c 'apk add --no-cache -q bash age nodejs >/dev/null && bash /ops/backup/selftest.sh' 2>&1)" || {
  printf '%s\n' "$OUT"
  exit 1
}
printf '%s\n' "$OUT"
DB="$(printf '%s\n' "$OUT" | grep -o 'base conservada: restore_test_[0-9_]*' | tail -1 | cut -d' ' -f3)"
[ -n "$DB" ] || {
  echo "FAIL: no se encontró la base restaurada"
  exit 1
}

drop() {
  docker compose exec -T postgres psql -U "$U" -d postgres -q -c "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE)" >/dev/null || true
}
trap drop EXIT

URL="postgresql://$U:$P@127.0.0.1:${PORT:-5432}/$DB"
echo "Migraciones de la base restaurada:"
(cd apps/api && MIGRATION_DATABASE_URL="$URL" npx --no-install prisma migrate status | grep -q 'Database schema is up to date') || {
  echo "FAIL: la base restaurada no está al día con las migraciones"
  exit 1
}
echo "  al día"
echo "Humo de la aplicación:"
(cd apps/api && RESTORE_DATABASE_URL="$URL" node scripts/restore-smoke.ts)
echo "OK: backup y restauración verificados (base local)."
