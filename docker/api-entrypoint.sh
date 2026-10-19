#!/bin/sh
# Applies pending database migrations, then starts the API. Set SKIP_MIGRATIONS=true to run them separately.
# With BASE_DOMAIN set (multi-clinic hosting) this updates the platform database and every clinic database.
set -e
if [ "${SKIP_MIGRATIONS:-false}" != "true" ]; then
  echo "Applying database migrations…"
  node /app/apps/api/dist/cli/platform.js migrate
fi
exec "$@"
