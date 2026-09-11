import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminSession } from "@/lib/require-admin";
import { deleteConnection, findConnection } from "@/lib/services/connections";
import { recordAuditEvent } from "@/lib/services/audit";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; connectionId: string }> }
) {
  const { session, response } = await requireAdminSession();
  if (response) return response;

  const { id, connectionId } = await params;
  const company = await prisma.company.findUnique({ where: { id } });
  if (!company) return NextResponse.json({ error: "Company not found." }, { status: 404 });

  const connection = await findConnection(id, connectionId);
  if (!connection) return NextResponse.json({ error: "Connection not found." }, { status: 404 });

  await deleteConnection(id, connectionId);

  await recordAuditEvent({
    actor: session.user,
    action: "connection.deleted",
    targetType: "connection",
    targetId: connectionId,
    companyId: id,
    metadata: { name: connection.name, engine: connection.engine },
  });

  return NextResponse.json({ ok: true });
}
