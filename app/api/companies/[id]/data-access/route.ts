import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminSession } from "@/lib/require-admin";
import { getCompanyDataAccess, listAssignableTables, setCompanyDataAccess } from "@/lib/services/data-access";
import { recordAuditEvent } from "@/lib/services/audit";

async function requireCompany(id: string) {
  return prisma.company.findUnique({ where: { id } });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { response } = await requireAdminSession();
  if (response) return response;

  const { id } = await params;
  const company = await requireCompany(id);
  if (!company) return NextResponse.json({ error: "Company not found." }, { status: 404 });

  const [allTables, access] = await Promise.all([listAssignableTables(), getCompanyDataAccess(id, id)]);
  return NextResponse.json({
    tables: allTables,
    granted_tables: access.grantedTables,
    connection_id: access.connectionId,
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, response } = await requireAdminSession();
  if (response) return response;

  const { id } = await params;
  const company = await requireCompany(id);
  if (!company) return NextResponse.json({ error: "Company not found." }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.tables) || !body.tables.every((t: unknown) => typeof t === "string")) {
    return NextResponse.json({ error: "'tables' must be an array of table names." }, { status: 400 });
  }

  const before = await getCompanyDataAccess(id, id);
  const access = await setCompanyDataAccess(id, id, body.tables);

  const beforeSet = new Set(before.grantedTables);
  const afterSet = new Set(access.grantedTables);
  const granted = access.grantedTables.filter((t) => !beforeSet.has(t));
  const revoked = before.grantedTables.filter((t) => !afterSet.has(t));
  if (granted.length > 0 || revoked.length > 0) {
    await recordAuditEvent({
      actor: session.user,
      action: "data_access.updated",
      targetType: "connection",
      targetId: access.connectionId,
      companyId: id,
      metadata: { granted, revoked },
    });
  }

  return NextResponse.json({ granted_tables: access.grantedTables, connection_id: access.connectionId });
}
