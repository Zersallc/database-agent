import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// Production reads PG* from real environment variables (Docker's env_file),
// so this is a no-op there; it's only for pushing this schema by hand
// locally, the same way prisma.config.ts loads it.
config({ path: ".env.local" });

/**
 * Deploy-time schema sync for the app's own database only (see start.sh).
 * Separate from prisma.config.ts, which resolves types for the full,
 * two-database schema.prisma. Always plain TCP, no TLS: the self-hosted
 * Postgres this points at has none configured (unlike Cloud SQL).
 */
function buildAppDatabaseUrl(): string | undefined {
  const { PGUSER, PGPASSWORD, PGDATABASE, PGHOST, PGPORT } = process.env;
  if (!PGUSER || !PGPASSWORD || !PGDATABASE || !PGHOST) return undefined;
  const user = encodeURIComponent(PGUSER);
  const pass = encodeURIComponent(PGPASSWORD);
  return `postgresql://${user}:${pass}@${PGHOST}:${PGPORT}/${PGDATABASE}?sslmode=disable`;
}

export default defineConfig({
  schema: "prisma/schema.app.prisma",
  datasource: {
    url: buildAppDatabaseUrl(),
  },
});
