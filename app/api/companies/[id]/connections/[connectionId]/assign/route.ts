import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminSession } from "@/lib/require-admin";
import {
  createConnection,
  findConnection,
  readCredentials,
  serializeConnection,
} from "@/lib/services/connections";
import { recordAuditEvent } from "@/lib/services/audit";
import { registerTablesForConnection } from "@/lib/services/registered-tables";

/**
 * "Assign this same database to another company" — duplicates a connection's
 * credentials into a new Connection document owned by the target company.
 * Connections are stored per-company (a company's chat agent only ever
 * queries through its own), so two companies sharing one physical database
 * are, deliberately, two separate Connection rows with the same underlying
 * host/database rather than one row two companies point at.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; connectionId: string }> }
) {
  const { session, response } = await requireAdminSession();
  if (response) return response;

  const { id: sourceCompanyId, connectionId } = await params;
  const source = await findConnection(sourceCompanyId, connectionId);
  if (!source) return NextResponse.json({ error: "Connection not found." }, { status: 404 });

  const body = await req.json().catch(() => null);
  const targetCompanyId = typeof body?.target_company_id === "string" ? body.target_company_id : "";
  if (!targetCompanyId) {
    return NextResponse.json({ error: "'target_company_id' is required." }, { status: 400 });
  }

  const targetCompany = await prisma.company.findUnique({ where: { id: targetCompanyId } });
  if (!targetCompany) return NextResponse.json({ error: "Target company not found." }, { status: 404 });

  const credentials = await readCredentials(source);
  const created = await createConnection(targetCompanyId, {
    name: source.name,
    engine: source.engine,
    credentials,
    allow_writes: source.allow_writes,
    max_rows: source.max_rows,
    default_schema: source.default_schema ?? undefined,
  });

  await recordAuditEvent({
    actor: session.user,
    action: "connection.created",
    targetType: "connection",
    targetId: created.id,
    companyId: targetCompanyId,
    metadata: {
      name: created.name,
      engine: created.engine,
      host: created.host,
      assigned_from_company: sourceCompanyId,
    },
  });

  try {
    await registerTablesForConnection(targetCompanyId, created);
  } catch {
    // Best-effort, same as on create — Test/Refresh surfaces the problem.
  }

  return NextResponse.json(serializeConnection(created), { status: 201 });
}
