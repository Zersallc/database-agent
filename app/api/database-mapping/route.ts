import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminSession } from "@/lib/require-admin";
import { listConnections, serializeConnection } from "@/lib/services/connections";
import { getCompanyDataAccess, listAssignableTables } from "@/lib/services/data-access";

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
      return {
        company_id: company.id,
        company_name: company.name,
        connections: connectionsPage.data.map(serializeConnection),
        granted_tables: access.grantedTables,
      };
    })
  );

  return NextResponse.json({ companies: rows, tables: assignableTables });
}
