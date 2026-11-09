#!/usr/bin/env bash
# Updates the live server to the latest main. Run on the server from GitHub Actions (the "deploy" job in
# .github/workflows/ci.yml) after the tests pass, or by hand:   DEPLOY_PATH=/opt/nextcore-vcms scripts/deploy.sh
#
#   1. backs up every database (and uploaded files) first — the update stops if the backup fails;
#   2. pulls main (fast-forward only: local changes on the server are never overwritten);
#   3. rebuilds and restarts the containers and waits until they are healthy.
# The API applies new database migrations to the platform database and every clinic database as it starts
# (docker/api-entrypoint.sh), so every clinic gets the new version at once.
set -euo pipefail
cd "${DEPLOY_PATH:-$(cd "$(dirname "$0")/.." && pwd)}"

ENV_FILE=.env.production
COMPOSE_FILE=docker-compose.prod.yml
[ -f "$ENV_FILE" ] || { echo "✗ $ENV_FILE not found in $(pwd)"; exit 1; }
env_value() { grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- | tr -d '"' || true; }

echo "══ Backing up before the update"
export COMPOSE_FILE ENV_FILE DB_SERVICE=db STORAGE_SERVICE=api
if [ -n "$(env_value BASE_DOMAIN)" ]; then
  # Many clinics: the platform database, then each clinic's database.
  DB_NAME="$(env_value DB_NAME)"; DB_NAME="${DB_NAME:-vcms_platform}" scripts/backup-all.sh
else
  DB_NAME="$(env_value DB_NAME)"; DB_NAME="${DB_NAME:-vcms}" scripts/backup.sh
fi

echo "══ Fetching the new version"
before="$(git rev-parse --short HEAD)"
git fetch --quiet origin main
git merge --ff-only --quiet origin/main
export APP_VERSION="$(git rev-parse --short HEAD)"
echo "→ $before → $APP_VERSION"
if [ -n "${DEPLOY_SHA:-}" ] && [ "$(git rev-parse HEAD)" != "$DEPLOY_SHA" ]; then
  echo "→ Note: main has moved on since this run started; deploying the newest version."
fi

echo "══ Rebuilding and restarting (database updates run as the API starts)"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build --remove-orphans --wait --wait-timeout 900
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps
# Old image layers are no longer needed.
docker image prune -f >/dev/null || true

echo "✓ Live on version $APP_VERSION"
