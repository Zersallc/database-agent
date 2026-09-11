#!/bin/sh

echo "Syncing database schema..."
# Scoped to prisma/schema.app.prisma (the app's own 5 tables) via
# prisma.app.config.ts, not the full schema.prisma — that one also declares
# Medi-Merchant's own models, which live in a different physical database
# (Cloud SQL, see lib/db-medimerchant.ts) and must never be pushed here.
# Deliberately NOT using --accept-data-loss: any future destructive change
# to companies/users should fail loudly here rather than apply silently on
# every deploy.
node ./node_modules/prisma/build/index.js db push --config=prisma.app.config.ts || echo "Schema sync failed or needs confirmation — continuing with existing schema"

echo "Starting server..."
exec node server.js
