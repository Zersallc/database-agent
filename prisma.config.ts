import { config } from "dotenv";
import { defineConfig } from "prisma/config";

config({ path: ".env.local" });

function buildDatabaseUrl(): string | undefined {
  const { PGUSER, PGPASSWORD, PGDATABASE, PGHOST, PGPORT, INSTANCE_CONNECTION_NAME, DATABASE_URL } =
    process.env;

  if (!PGUSER || !PGPASSWORD || !PGDATABASE) {
    return DATABASE_URL;
  }

  // .env.local escapes `$` as `\$` so @next/env's dotenv-expand (used by the
  // Next.js app at runtime) doesn't treat it as a variable reference. Plain
  // `dotenv` (used here) never expands in the first place, so it never
  // un-escapes either — do that ourselves before the password is used.
  const user = encodeURIComponent(PGUSER);
  const pass = encodeURIComponent(PGPASSWORD.replace(/\\\$/g, "$"));

  // Cloud Run: connect through the Cloud SQL Auth Proxy socket mounted via
  // --add-cloudsql-instances, which bypasses the public-IP authorized-networks
  // allowlist entirely (see lib/db.ts for the matching runtime config).
  if (INSTANCE_CONNECTION_NAME) {
    const host = encodeURIComponent(`/cloudsql/${INSTANCE_CONNECTION_NAME}`);
    return `postgresql://${user}:${pass}@localhost/${PGDATABASE}?host=${host}`;
  }

  return `postgresql://${user}:${pass}@${PGHOST}:${PGPORT}/${PGDATABASE}?sslmode=require`;
}

// CAUTION: schema.prisma declares models for TWO physical databases now —
// Company/User/AppDocument/AppSecret/AuditEvent (self-hosted, see lib/db.ts)
// and Hospital/Inventory/ItemSustainability/ObservationsDb (Medi-Merchant's
// Cloud SQL, see lib/db-medimerchant.ts). This config's datasource.url
// (built from PG* env vars below) only ever points at ONE of them at a time
// — currently the self-hosted app database. `prisma generate` is safe to run
// regardless (it only produces types). `prisma db push`/`migrate` against
// the full schema is NOT: it would try to create Medi-Merchant's tables in
// whichever database this resolves to. To push a schema change to the other
// database, point PG*/MEDIMERCHANT_PG* at it explicitly (or use a scoped
// --config override) rather than running a plain `prisma db push` here.
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
