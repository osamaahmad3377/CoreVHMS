#!/usr/bin/env bash
# Creates a consistent backup: PostgreSQL dump (custom format), uploaded files, and a manifest with checksums
# and row counts. Old backups beyond RETENTION_DAYS are removed (the newest KEEP_MIN are always kept).
#   scripts/backup.sh                      # development stack
#   COMPOSE_FILE=docker-compose.prod.yml DB_SERVICE=db STORAGE_SERVICE=api ENV_FILE=.env.production scripts/backup.sh
source "$(dirname "$0")/backup-common.sh"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
KEEP_MIN="${KEEP_MIN:-7}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$BACKUP_DIR/vcms-$STAMP"
mkdir -p "$OUT"
umask 077

echo "→ Backing up database '$DB_NAME' to $OUT"
row_counts > "$OUT/counts-before.tsv"
dc exec -T "$DB_SERVICE" pg_dump -U "$DB_USER" -d "$DB_NAME" --format=custom --compress=6 --no-owner > "$OUT/database.dump"
row_counts > "$OUT/counts-after.tsv"
psql_db "$DB_NAME" -c "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name" > "$OUT/migrations.txt"

echo "→ Backing up uploaded files from $STORAGE_PATH"
if [ -n "$STORAGE_SERVICE" ]; then
  dc exec -T "$STORAGE_SERVICE" tar -C "$STORAGE_PATH" -czf - . > "$OUT/storage.tar.gz"
elif [ -d "$STORAGE_PATH" ]; then
  tar -C "$STORAGE_PATH" -czf "$OUT/storage.tar.gz" .
else
  tar -czf "$OUT/storage.tar.gz" -T /dev/null
fi

# Sanity checks before declaring success.
dc exec -T "$DB_SERVICE" pg_restore --list < "$OUT/database.dump" > /dev/null
tar -tzf "$OUT/storage.tar.gz" > /dev/null
cat > "$OUT/manifest.json" <<JSON
{
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "database": "$DB_NAME",
  "tables": $(wc -l < "$OUT/counts-after.tsv" | tr -d ' '),
  "migrations": $(wc -l < "$OUT/migrations.txt" | tr -d ' '),
  "files": {
    "database.dump": { "bytes": $(wc -c < "$OUT/database.dump" | tr -d ' '), "sha256": "$(sha "$OUT/database.dump")" },
    "storage.tar.gz": { "bytes": $(wc -c < "$OUT/storage.tar.gz" | tr -d ' '), "sha256": "$(sha "$OUT/storage.tar.gz")" }
  }
}
JSON
echo "✓ Backup complete: $OUT ($(du -sh "$OUT" | cut -f1))"

# Retention: delete backups older than RETENTION_DAYS, always keeping the newest KEEP_MIN.
ls -1d "$BACKUP_DIR"/vcms-* 2>/dev/null | sort -r | tail -n +"$((KEEP_MIN + 1))" | while read -r old; do
  if [ -n "$(find "$old" -maxdepth 0 -mtime +"$RETENTION_DAYS")" ]; then rm -rf "$old"; echo "  removed old backup $(basename "$old")"; fi
done
