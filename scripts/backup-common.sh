#!/usr/bin/env bash
# Shared settings for backup/restore scripts. Defaults target the development stack (docker-compose.yml);
# for the production stack use:  COMPOSE_FILE=docker-compose.prod.yml DB_SERVICE=db STORAGE_SERVICE=api ENV_FILE=.env.production
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT/docker-compose.yml}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-}"
ENV_FILE="${ENV_FILE:-}"
DB_SERVICE="${DB_SERVICE:-postgres}"
DB_USER="${DB_USER:-vcms}"
DB_NAME="${DB_NAME:-vcms}"
# Uploaded files: a container path inside STORAGE_SERVICE (production), or a local directory (development).
STORAGE_SERVICE="${STORAGE_SERVICE:-}"
STORAGE_PATH="${STORAGE_PATH:-}"
[ -z "$STORAGE_SERVICE" ] && [ -z "$STORAGE_PATH" ] && STORAGE_PATH="$ROOT/apps/api/storage"
[ -n "$STORAGE_SERVICE" ] && [ -z "$STORAGE_PATH" ] && STORAGE_PATH="/data/storage"
BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"

dc() {
  local args=(-f "$COMPOSE_FILE")
  [ -n "$COMPOSE_PROJECT" ] && args=(-p "$COMPOSE_PROJECT" "${args[@]}")
  [ -n "$ENV_FILE" ] && args+=(--env-file "$ENV_FILE")
  docker compose "${args[@]}" "$@"
}
psql_db() { dc exec -T "$DB_SERVICE" psql -U "$DB_USER" -d "${1:-$DB_NAME}" -v ON_ERROR_STOP=1 -At -F $'\t' "${@:2}"; }
sha() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

# Exact row count of every table (tab-separated: table, rows), sorted by table name.
row_counts() {
  psql_db "${1:-$DB_NAME}" -c "SELECT table_name, (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1"
}
