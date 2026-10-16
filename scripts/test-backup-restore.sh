#!/usr/bin/env bash
# Automated backup and restore test on a disposable copy of the production stack (docker-compose.prod.yml).
# It never touches a real installation: everything runs in its own compose project with its own volumes,
# which are removed at the end.
#
#   1. start db + api + web with throwaway secrets, create an organisation, a client and an uploaded file
#   2. backup.sh, then verify-backup.sh must pass
#   3. a corrupted copy of the backup must be rejected; restore.sh without CONFIRM=restore must refuse
#   4. add a second client and file, then restore.sh
#   5. after the restore the first client and file are back, and the second client and file are gone
#
#   scripts/test-backup-restore.sh                 # uses images nextcore-vcms-{api,web}:$APP_VERSION (built if missing)
#   APP_VERSION=ci BUILD=1 scripts/test-backup-restore.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export COMPOSE_FILE="$ROOT/docker-compose.prod.yml" COMPOSE_PROJECT="${COMPOSE_PROJECT:-vcms-backup-test}"
export DB_SERVICE=db STORAGE_SERVICE=api APP_VERSION="${APP_VERSION:-latest}"
PORT="${PORT:-3091}"
BASE="http://localhost:$PORT"
WORK="$(mktemp -d)"
export ENV_FILE="$WORK/env" BACKUP_DIR="$WORK/backups"
source "$ROOT/scripts/backup-common.sh"

cleanup() {
  status=$?
  if [ $status -ne 0 ]; then echo "--- api log (last 40 lines)"; dc logs --tail 40 api 2>/dev/null || true; fi
  dc down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$WORK"
  [ $status -eq 0 ] && echo "✓ Backup and restore test passed" || echo "✗ Backup and restore test FAILED"
}
trap cleanup EXIT
fail() { echo "✗ $*" >&2; exit 1; }
step() { echo; echo "── $*"; }

cat > "$ENV_FILE" <<ENV
APP_VERSION=$APP_VERSION
APP_URL=$BASE
POSTGRES_PASSWORD=$(openssl rand -hex 16)
SESSION_SECRET=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 32)
COOKIE_SECURE=false
ALLOW_INSECURE_COOKIES=true
ALLOW_SIGNUP=true
TRUST_PROXY=loopback
SMTP_HOST=localhost
SMTP_PORT=1025
MAIL_FROM="Backup test <no-reply@backup-test.local>"
LOG_FORMAT=json
WEB_BIND=127.0.0.1
WEB_PORT=$PORT
ENV

step "Starting a disposable stack (project $COMPOSE_PROJECT, port $PORT)"
up_args=(up -d --wait)
[ "${BUILD:-0}" = "1" ] && up_args+=(--build)
dc "${up_args[@]}" >/dev/null 2>&1 || { dc "${up_args[@]}"; fail "could not start the stack"; }
ready() { for _ in $(seq 1 60); do curl -sf "$BASE/api/v1/health/ready" >/dev/null && return 0; sleep 2; done; return 1; }
ready || fail "stack did not become ready"
echo "✓ Stack ready"

# Minimal API client: cookie session + CSRF token from the cookie jar.
JAR="$WORK/cookies"
: > "$JAR"
csrf() { awk '$6 == "vcms_csrf" { print $7 }' "$JAR" | tail -1; }
api() { # api METHOD PATH [JSON] → prints body; fails on HTTP >= 400 unless ALLOW_STATUS matches
  local method=$1 path=$2 body=${3:-} out="$WORK/resp" code
  local args=(-s -o "$out" -w '%{http_code}' -b "$JAR" -c "$JAR" -X "$method" -H "Origin: $BASE")
  [ "$method" != GET ] && args+=(-H "X-CSRF-Token: $(csrf)")
  [ -n "$body" ] && args+=(-H 'Content-Type: application/json' --data "$body")
  code=$(curl "${args[@]}" "$BASE/api/v1$path")
  if [ "$code" -ge 400 ] && [ "$code" != "${ALLOW_STATUS:-}" ]; then fail "$method $path → $code $(head -c 300 "$out")"; fi
  LAST_STATUS=$code
  cat "$out"
}
upload() { # upload CLIENT_ID FILE → attachment id
  curl -sf -b "$JAR" -c "$JAR" -H "Origin: $BASE" -H "X-CSRF-Token: $(csrf)" \
    -F entityType=Client -F "entityId=$1" -F "file=@$2;type=text/csv" "$BASE/api/v1/attachments" | jq -r .id
}
status_of() { ALLOW_STATUS=404 api GET "$1" >/dev/null; echo "$LAST_STATUS"; }

step "Creating data before the backup"
EMAIL="owner-$RANDOM@backup-test.local"
PASSWORD="Backup-Test-$(openssl rand -hex 4)A1"
api POST /auth/register "{\"organizationName\":\"Backup Test Clinic\",\"country\":\"AU\",\"branchName\":\"Main\",\"ownerName\":\"Test Owner\",\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" >/dev/null
CLIENT_A=$(api POST /clients '{"type":"INDIVIDUAL","firstName":"Before","lastName":"Backup","mobilePhone":"+61 400 000 001"}' | jq -r .id)
printf 'name,value\nbefore,%s\n' "$(openssl rand -hex 8)" > "$WORK/a.csv"
FILE_A=$(upload "$CLIENT_A" "$WORK/a.csv")
[ -n "$FILE_A" ] && [ "$FILE_A" != null ] || fail "upload A failed"
echo "✓ Organisation, client $CLIENT_A and file $FILE_A created"

step "Backup"
"$ROOT/scripts/backup.sh"
SNAP="$(ls -1d "$BACKUP_DIR"/vcms-* | tail -1)"

step "Verify the backup"
"$ROOT/scripts/verify-backup.sh" "$SNAP"

step "A corrupted backup must be rejected"
cp -R "$SNAP" "$SNAP-corrupt"
printf 'x' >> "$SNAP-corrupt/database.dump"
if "$ROOT/scripts/verify-backup.sh" "$SNAP-corrupt" > "$WORK/corrupt.log" 2>&1; then fail "corrupted backup was accepted"; fi
grep -q "checksum mismatch" "$WORK/corrupt.log" || fail "unexpected failure for corrupted backup: $(cat "$WORK/corrupt.log")"
echo "✓ Corrupted backup rejected (checksum mismatch)"

step "Restore must refuse without CONFIRM=restore"
set +e; CONFIRM= "$ROOT/scripts/restore.sh" "$SNAP" >/dev/null 2>&1; rc=$?; set -e
[ $rc -eq 2 ] || fail "restore without confirmation exited $rc (expected 2)"
echo "✓ Refused"

step "Changing data after the backup"
CLIENT_B=$(api POST /clients '{"type":"INDIVIDUAL","firstName":"After","lastName":"Backup","mobilePhone":"+61 400 000 002"}' | jq -r .id)
printf 'name,value\nafter,1\n' > "$WORK/b.csv"
FILE_B=$(upload "$CLIENT_B" "$WORK/b.csv")
[ "$(status_of "/clients/$CLIENT_B")" = 200 ] || fail "client B not created"
echo "✓ Client $CLIENT_B and file $FILE_B added"

step "Restore"
CONFIRM=restore "$ROOT/scripts/restore.sh" "$SNAP"
ready || fail "API not ready after restore"

step "Checking the restored data"
: > "$JAR"
api POST /auth/login "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" >/dev/null
[ "$(status_of "/clients/$CLIENT_A")" = 200 ] || fail "client A missing after restore"
[ "$(status_of "/clients/$CLIENT_B")" = 404 ] || fail "client B still present after restore"
curl -sf -b "$JAR" "$BASE/api/v1/attachments/$FILE_A/download" > "$WORK/a.restored" || fail "file A not downloadable"
cmp -s "$WORK/a.csv" "$WORK/a.restored" || fail "file A content differs after restore"
[ "$(status_of "/attachments/$FILE_B/download")" = 404 ] || fail "file B still present after restore"
echo "✓ Client and file from before the backup are back; later changes are gone"
