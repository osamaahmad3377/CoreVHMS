#!/usr/bin/env bash
# Proves a backup can be restored: checks checksums, restores into a temporary database on the same server,
# compares every table's row count with the counts taken at backup time, checks the file archive, then
# drops the temporary database. Does not touch the live database.
#   scripts/verify-backup.sh backups/vcms-20261015T120000Z
source "$(dirname "$0")/backup-common.sh"
SRC="${1:?usage: verify-backup.sh <backup directory>}"
CHECK_DB="vcms_restore_check_$$"
fail() { echo "✗ $*"; dc exec -T "$DB_SERVICE" dropdb -U "$DB_USER" --if-exists "$CHECK_DB" >/dev/null 2>&1 || true; exit 1; }

has_storage() { grep -q '"storage.tar.gz"' "$SRC/manifest.json"; }
for f in database.dump storage.tar.gz; do
  [ "$f" = storage.tar.gz ] && ! has_storage && continue  # database-only backup (backup-all.sh, one clinic)
  want="$(grep "\"$f\"" "$SRC/manifest.json" | grep -o '"sha256": "[0-9a-f]*"' | cut -d'"' -f4)"
  [ "$(sha "$SRC/$f")" = "$want" ] || fail "checksum mismatch for $f"
done
echo "✓ Checksums match the manifest"
if has_storage; then
  tar -tzf "$SRC/storage.tar.gz" > /dev/null || fail "file archive is unreadable"
  echo "✓ File archive readable ($(tar -tzf "$SRC/storage.tar.gz" | grep -vc '/$' || true) entries)"
fi

dc exec -T "$DB_SERVICE" createdb -U "$DB_USER" "$CHECK_DB"
dc exec -T "$DB_SERVICE" pg_restore -U "$DB_USER" -d "$CHECK_DB" --no-owner --exit-on-error < "$SRC/database.dump" || fail "pg_restore failed"
echo "✓ Database restored into temporary database $CHECK_DB"

row_counts "$CHECK_DB" > "$SRC/.counts-restored.tsv"
# Each table's restored count must lie between the counts taken just before and just after the dump.
problems="$(join -t $'\t' "$SRC/counts-before.tsv" "$SRC/counts-after.tsv" | join -t $'\t' - "$SRC/.counts-restored.tsv" | awk -F'\t' '{ lo=($2<$3)?$2:$3; hi=($2>$3)?$2:$3; if ($4 < lo || $4 > hi) print $1": restored "$4", expected "lo"–"hi }')"
missing="$(comm -23 <(cut -f1 "$SRC/counts-after.tsv") <(cut -f1 "$SRC/.counts-restored.tsv"))"
rm -f "$SRC/.counts-restored.tsv"
[ -z "$missing" ] || fail "tables missing after restore: $missing"
[ -z "$problems" ] || fail "row counts differ:\n$problems"
tables="$(wc -l < "$SRC/counts-after.tsv" | tr -d ' ')"
rows="$(awk -F'\t' '{s+=$2} END {print s}' "$SRC/counts-after.tsv")"
echo "✓ All $tables tables restored with matching row counts ($rows rows)"
migr="$(psql_db "$CHECK_DB" -c "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL")"
[ "$migr" = "$(wc -l < "$SRC/migrations.txt" | tr -d ' ')" ] || fail "migration history differs"
echo "✓ Migration history intact ($migr migrations)"
dc exec -T "$DB_SERVICE" dropdb -U "$DB_USER" "$CHECK_DB"
echo "✓ Backup verified: $SRC"
