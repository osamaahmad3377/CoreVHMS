#!/usr/bin/env bash
# Restores a backup over the live database and file storage. DESTRUCTIVE: the current data is replaced.
# Stops the API during the restore. Run verify-backup.sh first.
#   CONFIRM=restore scripts/restore.sh backups/vcms-20261015T120000Z
source "$(dirname "$0")/backup-common.sh"
SRC="${1:?usage: CONFIRM=restore restore.sh <backup directory>}"
API_SERVICE="${API_SERVICE:-${STORAGE_SERVICE:-}}"
has_storage() { grep -q '"storage.tar.gz"' "$SRC/manifest.json"; }
if [ "${CONFIRM:-}" != "restore" ]; then
  echo "This replaces database '$DB_NAME'$(has_storage && echo ' and all uploaded files') with the backup in $SRC."
  echo "Re-run with CONFIRM=restore to proceed."; exit 2
fi
for f in database.dump storage.tar.gz; do
  [ "$f" = storage.tar.gz ] && ! has_storage && continue
  want="$(grep "\"$f\"" "$SRC/manifest.json" | grep -o '"sha256": "[0-9a-f]*"' | cut -d'"' -f4)"
  [ "$(sha "$SRC/$f")" = "$want" ] || { echo "✗ checksum mismatch for $f — aborting"; exit 1; }
done
[ -n "$API_SERVICE" ] && { echo "→ Stopping $API_SERVICE"; dc stop "$API_SERVICE"; }
echo "→ Restoring database"
dc exec -T "$DB_SERVICE" psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DB_NAME' AND pid <> pg_backend_pid()" >/dev/null
dc exec -T "$DB_SERVICE" dropdb -U "$DB_USER" "$DB_NAME"
dc exec -T "$DB_SERVICE" createdb -U "$DB_USER" "$DB_NAME"
dc exec -T "$DB_SERVICE" pg_restore -U "$DB_USER" -d "$DB_NAME" --no-owner --exit-on-error < "$SRC/database.dump"
if ! has_storage; then
  echo "→ Database-only backup: uploaded files left as they are"
elif [ -n "$STORAGE_SERVICE" ]; then
  echo "→ Restoring uploaded files"
  dc run --rm --no-deps -T --entrypoint sh "$STORAGE_SERVICE" -c "find '$STORAGE_PATH' -mindepth 1 -delete && tar -C '$STORAGE_PATH' -xzf -" < "$SRC/storage.tar.gz"
else
  echo "→ Restoring uploaded files"
  mkdir -p "$STORAGE_PATH" && find "$STORAGE_PATH" -mindepth 1 -delete && tar -C "$STORAGE_PATH" -xzf "$SRC/storage.tar.gz"
fi
[ -n "$API_SERVICE" ] && { echo "→ Starting $API_SERVICE"; dc start "$API_SERVICE"; }
echo "✓ Restore complete from $SRC"
