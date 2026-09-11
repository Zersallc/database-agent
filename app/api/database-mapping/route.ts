import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminSession } from "@/lib/require-admin";
import type { SchemaColumn } from "@/lib/connectors";
import { listConnections, serializeConnection } from "@/lib/services/connections";
import { getCompanyDataAccess, listAssignableTables } from "@/lib/services/data-access";
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
 * Cross-company view of every registered database, one row per table (not
 * per connection) — a database with 4 tables is 4 rows here. The per-company
 * connection endpoints are tenant-scoped by design (a company only ever
 * lists its own); this is the one place an admin looks across all of them.
 *
 * Managed connections (the shared Data Access grant system, scoped to
 * Medi-Merchant's own tables) use access.granted_tables for which tables
 * exist, same as before — no column data for those, since that grant system
 * doesn't introspect columns, only table names. Every other connection uses
 * the registered-table records (lib/services/registered-tables.ts), each
 * with real introspected columns.
 */
export async function GET() {
  const { response } = await requireAdminSession();
  if (response) return response;

  const companies = await prisma.company.findMany({ orderBy: { name: "asc" } });

  const rows: MappingRow[] = [];

  await Promise.all(
    companies.map(async (company) => {
      const [connectionsPage, access] = await Promise.all([
        listConnections(company.id, { order: "asc", limit: 50, cursor: null }),
        getCompanyDataAccess(company.id, company.id),
      ]);

      await Promise.all(
        connectionsPage.data.map(async (connection) => {
          const serialized = serializeConnection(connection);
          const isManaged = connection.name === MANAGED_CONNECTION_NAME;

          if (isManaged) {
            for (const tableName of access.grantedTables) {
              rows.push({
                company_id: company.id,
                company_name: company.name,
                connection: serialized,
                is_managed: true,
                table_name: tableName,
                columns: null,
              });
            }
            return;
          }

          const tables = await listRegisteredTables(company.id, connection.id);
          if (tables.length === 0) {
            // Still show the connection itself (Edit/Test/Refresh/Remove need
            // somewhere to live) even with nothing registered yet — a fresh
            // connection whose credentials haven't been fixed yet, most likely.
            rows.push({
              company_id: company.id,
              company_name: company.name,
              connection: serialized,
              is_managed: false,
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
              is_managed: false,
              table_name: table.table_name,
              columns: table.columns,
            });
          }
        })
      );
    })
  );

  const assignableTables = await listAssignableTables();
  return NextResponse.json({ rows, tables: assignableTables });
}
