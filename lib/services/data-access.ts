/**
 * Per-company table access.
 *
 * A company's chat agent only ever queries through its own Connection, and a
 * Connection only ever sees what its Postgres role can SELECT — so "assign
 * this table to this company" is not an app-level filter that a clever query
 * could route around, it is a real GRANT enforced by Postgres itself.
 *
 * Each company gets exactly one dedicated, unprivileged login role the first
 * time its data access is touched, reused after that. The role's password
 * lives nowhere but the Connection's own encrypted credential — there is no
 * separate copy to lose track of or let drift out of sync.
 */

import { randomBytes } from "crypto";
import { prismaMediMerchant as prisma } from "@/lib/db-medimerchant";
import { createConnection, listConnections, requireConnection } from "./connections";

const MANAGED_CONNECTION_NAME = "Company data access (managed)";

/** Never assignable — these belong to the app itself, not to any one company's data. */
const INTERNAL_TABLES = new Set([
  "companies",
  "users",
  "app_documents",
  "app_secrets",
  "_prisma_migrations",
]);

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function roleNameForCompany(companyId: string): string {
  // Postgres role names are case-folded and length-limited; company IDs are
  // already short, lowercase-safe cuids, so a plain prefix is enough.
  return `co_${companyId.toLowerCase().replace(/[^a-z0-9]/g, "")}`.slice(0, 63);
}

/** Every real data table a company could be granted access to — the app's own tables excluded. */
export async function listAssignableTables(): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `;
  return rows.map((r) => r.table_name).filter((name) => !INTERNAL_TABLES.has(name));
}

async function findManagedConnectionId(tenantId: string): Promise<string | null> {
  // Small, bounded list per tenant — a full scan here is cheap and avoids
  // adding a lookup field to ConnectionDoc for a single internal use.
  const page = await listConnections(tenantId, { order: "asc", limit: 100, cursor: null });
  return page.data.find((c) => c.name === MANAGED_CONNECTION_NAME)?.id ?? null;
}

/**
 * Creates the company's dedicated role and Connection on first use. Later
 * calls find the existing Connection and leave the role/password alone —
 * only the GRANTs change.
 */
async function ensureCompanyRole(tenantId: string, companyId: string): Promise<string> {
  const existingConnectionId = await findManagedConnectionId(tenantId);
  if (existingConnectionId) {
    const connection = await requireConnection(tenantId, existingConnectionId);
    return connection.id;
  }

  const roleName = roleNameForCompany(companyId);
  const password = randomBytes(18).toString("base64").replace(/[+/=]/g, "").slice(0, 24);

  const roleExists = await prisma.$queryRaw<{ exists: boolean }[]>`
    SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = ${roleName}) as exists
  `;
  if (roleExists[0]?.exists) {
    // The role survived from a previous, incomplete setup with no Connection
    // to show for it — safest fix is a fresh password under the same role,
    // since nothing else can be depending on the old one if it was never wired up.
    await prisma.$executeRawUnsafe(`ALTER ROLE ${quoteIdent(roleName)} WITH PASSWORD '${password}'`);
  } else {
    await prisma.$executeRawUnsafe(
      `CREATE ROLE ${quoteIdent(roleName)} WITH LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE`
    );
  }
  await prisma.$executeRawUnsafe(`GRANT CONNECT ON DATABASE ${quoteIdent(process.env.PGDATABASE ?? "")} TO ${quoteIdent(roleName)}`);
  await prisma.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${quoteIdent(roleName)}`);

  const connection = await createConnection(tenantId, {
    name: MANAGED_CONNECTION_NAME,
    engine: "postgres",
    allow_writes: false,
    max_rows: 1000,
    credentials: {
      host: process.env.PGHOST,
      port: Number(process.env.PGPORT ?? 5432),
      database: process.env.PGDATABASE,
      username: roleName,
      password,
      ssl: true,
    },
  });
  return connection.id;
}

export type CompanyDataAccess = {
  connectionId: string | null;
  grantedTables: string[];
};

export async function getCompanyDataAccess(tenantId: string, companyId: string): Promise<CompanyDataAccess> {
  const connectionId = await findManagedConnectionId(tenantId);
  if (!connectionId) return { connectionId: null, grantedTables: [] };

  const roleName = roleNameForCompany(companyId);
  const grants = await prisma.$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.role_table_grants
    WHERE grantee = ${roleName} AND privilege_type = 'SELECT' AND table_schema = 'public'
  `;
  return { connectionId, grantedTables: grants.map((r) => r.table_name) };
}

export async function setCompanyDataAccess(
  tenantId: string,
  companyId: string,
  desiredTables: string[]
): Promise<CompanyDataAccess> {
  const assignable = new Set(await listAssignableTables());
  const desired = new Set(desiredTables.filter((t) => assignable.has(t)));

  const connectionId = await ensureCompanyRole(tenantId, companyId);
  const roleName = roleNameForCompany(companyId);

  const current = await prisma.$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.role_table_grants
    WHERE grantee = ${roleName} AND privilege_type = 'SELECT' AND table_schema = 'public'
  `;
  const currentSet = new Set(current.map((r) => r.table_name));

  for (const table of desired) {
    if (!currentSet.has(table)) {
      await prisma.$executeRawUnsafe(
        `GRANT SELECT ON ${quoteIdent(table)} TO ${quoteIdent(roleName)}`
      );
    }
  }
  for (const table of currentSet) {
    if (!desired.has(table)) {
      await prisma.$executeRawUnsafe(
        `REVOKE SELECT ON ${quoteIdent(table)} FROM ${quoteIdent(roleName)}`
      );
    }
  }

  return { connectionId, grantedTables: [...desired] };
}
