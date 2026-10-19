#!/usr/bin/env bash
# Multi-clinic hosting: backs up the platform database (with all uploaded files) and then every clinic
# database (database only), each with its own manifest, checksums and retention.
#   BACKUP_DIR/vcms-<time>                        platform database + uploaded files
#   BACKUP_DIR/clinics/<database>/vcms-<time>     one clinic's database
#
#   DB_NAME=vcms_platform scripts/backup-all.sh
#   COMPOSE_FILE=docker-compose.prod.yml DB_SERVICE=db STORAGE_SERVICE=api ENV_FILE=.env.production scripts/backup-all.sh
# Verify or restore one clinic with verify-backup.sh / restore.sh and DB_NAME=<that clinic's database>.
source "$(dirname "$0")/backup-common.sh"
HERE="$(dirname "$0")"

echo "══ Platform database '$DB_NAME' and uploaded files"
"$HERE/backup.sh"

clinics="$(psql_db "$DB_NAME" -c "SELECT \"databaseName\" FROM \"Tenant\" WHERE status IN ('ACTIVE','SUSPENDED') ORDER BY slug")"
failed=0
for db in $clinics; do
  echo; echo "══ Clinic database '$db'"
  if ! DB_NAME="$db" BACKUP_DIR="$BACKUP_DIR/clinics/$db" INCLUDE_STORAGE=false "$HERE/backup.sh"; then
    echo "✗ Backup of $db failed"; failed=$((failed + 1))
  fi
done
echo
count="$(echo "$clinics" | grep -c . || true)"
echo "✓ Platform backed up; $((count - failed)) of $count clinic databases backed up"
[ "$failed" -eq 0 ]
