import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminSession } from "@/lib/require-admin";
import {
  deleteConnection,
  findConnection,
  readCredentials,
  serializeConnection,
  updateConnection,
} from "@/lib/services/connections";
import { recordAuditEvent } from "@/lib/services/audit";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; connectionId: string }> }
) {
  const { session, response } = await requireAdminSession();
  if (response) return response;

  const { id, connectionId } = await params;
  const company = await prisma.company.findUnique({ where: { id } });
  if (!company) return NextResponse.json({ error: "Company not found." }, { status: 404 });

  const connection = await findConnection(id, connectionId);
  if (!connection) return NextResponse.json({ error: "Connection not found." }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });

  // Non-secret fields can change freely. The password is write-only: a blank
  // one here means "keep the existing password", not "clear it" — otherwise
  // every edit that doesn't touch the password would silently break the
  // connection.
  const existingCredentials = await readCredentials(connection);
  const credentials = {
    host: typeof body.host === "string" ? body.host : existingCredentials.host,
    port: typeof body.port === "number" ? body.port : existingCredentials.port,
    database: typeof body.database === "string" ? body.database : existingCredentials.database,
    username: typeof body.username === "string" ? body.username : existingCredentials.username,
    password:
      typeof body.password === "string" && body.password ? body.password : existingCredentials.password,
    ssl: existingCredentials.ssl,
  };

  const updated = await updateConnection(id, connectionId, {
    name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : undefined,
    credentials,
  });

  await recordAuditEvent({
    actor: session.user,
    action: "connection.created",
    targetType: "connection",
    targetId: updated.id,
    companyId: id,
    metadata: {
      name: updated.name,
      engine: updated.engine,
      host: updated.host,
      password_changed: typeof body.password === "string" && body.password.length > 0,
    },
  });

  return NextResponse.json(serializeConnection(updated));
}

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
