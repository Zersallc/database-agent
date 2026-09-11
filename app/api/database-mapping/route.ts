import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminSession } from "@/lib/require-admin";
import type { SchemaColumn } from "@/lib/connectors";
import { getSchema, listConnections, serializeConnection } from "@/lib/services/connections";
import { listRegisteredTables } from "@/lib/services/registered-tables";

const MANAGED_CONNECTION_NAME = "Company data access (managed)";

export type MappingRow = {
  company_id: string;
  company_name: string;
  connection: ReturnType<typeof serializeConnection>;
  is_managed: boolean;
  table_name: string;
  columns: SchemaColumn[] | null;
};

/**
 * Every registered database for the admin's own (or currently switched-to,
 * for Developers) company, one row per table (not per connection) — a
 * database with 4 tables is 4 rows here. Scoped the same way Users is: an
 * admin only ever sees their current company's data, never another
 * company's.
 *
 * Managed connections (Medi-Merchant's shared Data Access grants) are
 * introspected live, the same as any other connection — the managed
 * connection's own Postgres role only has SELECT on the tables it's been
 * granted, so `information_schema` naturally returns just those, with real
 * columns. No separate "grant-based, no columns" code path needed: it's a
 * real connection like any other, just one whose grants can change without
 * a credential change.
 */
export async function GET() {
  const { session, response } = await requireAdminSession();
  if (response) return response;

  const companies = session.user.companyId
    ? await prisma.company.findMany({
        where: { id: session.user.companyId },
        orderBy: { name: "asc" },
      })
    : [];

  const rows: MappingRow[] = [];

  await Promise.all(
    companies.map(async (company) => {
      const connectionsPage = await listConnections(company.id, { order: "asc", limit: 50, cursor: null });

      await Promise.all(
        connectionsPage.data.map(async (connection) => {
          const serialized = serializeConnection(connection);
          const isManaged = connection.name === MANAGED_CONNECTION_NAME;

          const tables = isManaged
            ? await getSchema(company.id, connection)
                .then((s) => s.tables.map((t) => ({ table_name: t.name, columns: t.columns })))
                .catch(() => [])
            : (await listRegisteredTables(company.id, connection.id)).map((t) => ({
                table_name: t.table_name,
                columns: t.columns,
              }));

          if (tables.length === 0) {
            // Still show the connection itself (Edit/Test/Refresh/Remove/Manage
            // need somewhere to live) even with nothing to show yet — no tables
            // granted, or a fresh connection whose credentials aren't fixed yet.
            rows.push({
              company_id: company.id,
              company_name: company.name,
              connection: serialized,
              is_managed: isManaged,
              table_name: "",
              columns: null,
            });
            return;
          }
          for (const table of tables) {
            rows.push({
              company_id: company.id,
              company_name: company.name,
              connection: serialized,
              is_managed: isManaged,
              table_name: table.table_name,
              columns: table.columns,
            });
          }
        })
      );
    })
  );

  return NextResponse.json({ rows });
}
