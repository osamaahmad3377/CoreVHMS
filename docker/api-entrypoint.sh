#!/bin/sh
# Applies pending database migrations, then starts the API. Set SKIP_MIGRATIONS=true to run them separately.
set -e
if [ "${SKIP_MIGRATIONS:-false}" != "true" ]; then
  echo "Applying database migrations…"
  /app/node_modules/.bin/prisma migrate deploy --schema /app/apps/api/prisma/schema.prisma
fi
exec "$@"
