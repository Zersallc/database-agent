import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminSession } from "@/lib/require-admin";
import { getSchema, listConnections, serializeConnection } from "@/lib/services/connections";
import { getCompanyDataAccess, listAssignableTables } from "@/lib/services/data-access";

const MANAGED_CONNECTION_NAME = "Company data access (managed)";

/**
 * Cross-company view of every registered database and what each company can
 * see through it. The per-company connection endpoints are tenant-scoped by
 * design (a company only ever lists its own); this is the one place an admin
 * looks across all of them at once.
 */
export async function GET() {
  const { response } = await requireAdminSession();
  if (response) return response;

  const [companies, assignableTables] = await Promise.all([
    prisma.company.findMany({ orderBy: { name: "asc" } }),
    listAssignableTables(),
  ]);

  const rows = await Promise.all(
    companies.map(async (company) => {
      const [connectionsPage, access] = await Promise.all([
        listConnections(company.id, { order: "asc", limit: 50, cursor: null }),
        getCompanyDataAccess(company.id, company.id),
      ]);

      const connections = await Promise.all(
        connectionsPage.data.map(async (connection) => {
          const serialized = serializeConnection(connection);
          // The managed connection's tables come from the Data Access grant
          // system (access.granted_tables) instead — this is only for
          // connections with their own dedicated, ungated access, where
          // "full access" still leaves the question "to what?" unanswered.
          if (connection.name === MANAGED_CONNECTION_NAME) {
            return { ...serialized, tables: null as string[] | null };
          }
          try {
            const schema = await getSchema(company.id, connection);
            return { ...serialized, tables: schema.tables.map((t) => t.name) };
          } catch {
            return { ...serialized, tables: [] as string[] };
          }
        })
      );

      return {
        company_id: company.id,
        company_name: company.name,
        connections,
        granted_tables: access.grantedTables,
      };
    })
  );

  return NextResponse.json({ companies: rows, tables: assignableTables });
}
