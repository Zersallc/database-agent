import { config } from "dotenv";
import { defineConfig } from "prisma/config";

config({ path: ".env.local" });

function buildDatabaseUrl(): string | undefined {
  const { PGUSER, PGPASSWORD, PGDATABASE, PGHOST, PGPORT, INSTANCE_CONNECTION_NAME, DATABASE_URL } =
    process.env;

  if (!PGUSER || !PGPASSWORD || !PGDATABASE) {
    return DATABASE_URL;
  }

  const user = encodeURIComponent(PGUSER);
  const pass = encodeURIComponent(PGPASSWORD);

  // Cloud Run: connect through the Cloud SQL Auth Proxy socket mounted via
  // --add-cloudsql-instances, which bypasses the public-IP authorized-networks
  // allowlist entirely (see lib/db.ts for the matching runtime config).
  if (INSTANCE_CONNECTION_NAME) {
    const host = encodeURIComponent(`/cloudsql/${INSTANCE_CONNECTION_NAME}`);
    return `postgresql://${user}:${pass}@localhost/${PGDATABASE}?host=${host}`;
  }

  return `postgresql://${user}:${pass}@${PGHOST}:${PGPORT}/${PGDATABASE}?sslmode=require`;
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  experimental: {
    externalTables: true,
  },
  datasource: {
    url: buildDatabaseUrl(),
  },
  tables: {
    external: ["public.Report"],
  },
});
