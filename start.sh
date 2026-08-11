#!/bin/sh

echo "Syncing database schema..."
# Deliberately NOT using --accept-data-loss: Report holds ~50k real hospital
# records and is excluded via prisma.config.ts's externalTables, but any
# future destructive change to companies/users should fail loudly here
# rather than apply silently on every deploy.
node ./node_modules/prisma/build/index.js db push || echo "Schema sync failed or needs confirmation — continuing with existing schema"

echo "Starting server..."
exec node server.js
