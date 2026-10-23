#!/usr/bin/env bash
# Sobe um Postgres 16 descartável (porta 54329), aplica a simulação do auth e as migrações.
# Uso: scripts/db-up.sh [reset]
set -euo pipefail
PGBIN=/usr/lib/postgresql/16/bin
DIR=${FIO_PG_DIR:-/tmp/fio-pg}
PORT=${FIO_PG_PORT:-54329}
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ "${1:-}" = "reset" ] && [ -d "$DIR" ]; then
  su postgres -c "$PGBIN/pg_ctl -D $DIR stop -m fast" >/dev/null 2>&1 || true
  rm -rf "$DIR"
fi
if [ ! -d "$DIR" ]; then
  mkdir -p "$DIR" && chown postgres "$DIR"
  su postgres -c "$PGBIN/initdb -D $DIR -A trust -E UTF8 --locale=C.UTF-8" >/dev/null
fi
if ! su postgres -c "$PGBIN/pg_isready -p $PORT -h 127.0.0.1" >/dev/null 2>&1; then
  su postgres -c "$PGBIN/pg_ctl -D $DIR -o '-p $PORT -k /tmp -c listen_addresses=127.0.0.1' -l $DIR/log -w start" >/dev/null
fi
PSQL="psql -h 127.0.0.1 -p $PORT -U postgres -v ON_ERROR_STOP=1 -q"
$PSQL -d postgres -c "drop database if exists fio_test" -c "create database fio_test" >/dev/null
$PSQL -d fio_test -f "$ROOT/tests/db/auth-shim.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do $PSQL -d fio_test -f "$f"; done
echo "fio_test pronto em 127.0.0.1:$PORT"
