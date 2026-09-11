import { config } from "dotenv";
import { defineConfig } from "prisma/config";

config({ path: ".env.local" });

function buildDatabaseUrl(): string | undefined {
  const { PGUSER, PGPASSWORD, PGDATABASE, PGHOST, PGPORT, DATABASE_URL } = process.env;

  if (!PGUSER || !PGPASSWORD || !PGDATABASE) {
    return DATABASE_URL;
  }

  // .env.local escapes `$` as `\$` so @next/env's dotenv-expand (used by the
  // Next.js app at runtime) doesn't treat it as a variable reference. Plain
  // `dotenv` (used here) never expands in the first place, so it never
  // un-escapes either — do that ourselves before the password is used.
  const user = encodeURIComponent(PGUSER);
  const pass = encodeURIComponent(PGPASSWORD.replace(/\\\$/g, "$"));

  return `postgresql://${user}:${pass}@${PGHOST}:${PGPORT}/${PGDATABASE}?sslmode=disable`;
}

// schema.prisma declares models for TWO physical databases —
// Company/User/AppDocument/AppSecret/AuditEvent (self-hosted, see lib/db.ts)
// and Hospital/Inventory/ItemSustainability/ObservationsDb (Medi-Merchant's
// Cloud SQL, see lib/db-medimerchant.ts). This config exists only for
// `prisma generate` (produces types, never connects) — the datasource.url
// above is not used for any real connection. Deploy-time schema sync
// (`prisma db push`, in start.sh) uses prisma.app.config.ts +
// prisma/schema.app.prisma instead, scoped to just the app's own database —
// pushing the full schema here would try to create Medi-Merchant's tables in
// whichever database PG* happens to resolve to.
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
