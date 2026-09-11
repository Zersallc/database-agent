import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminSession } from "@/lib/require-admin";
import { SUPPORTED_ENGINES } from "@/lib/connectors";
import { createConnection, listConnections, serializeConnection } from "@/lib/services/connections";
import { recordAuditEvent } from "@/lib/services/audit";
import { registerTablesForConnection } from "@/lib/services/registered-tables";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { response } = await requireAdminSession();
  if (response) return response;

  const { id } = await params;
  const company = await prisma.company.findUnique({ where: { id } });
  if (!company) return NextResponse.json({ error: "Company not found." }, { status: 404 });

  const page = await listConnections(id, { order: "asc", limit: 50, cursor: null });
  return NextResponse.json({ data: page.data.map(serializeConnection) });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, response } = await requireAdminSession();
  if (response) return response;

  const { id } = await params;
  const company = await prisma.company.findUnique({ where: { id } });
  if (!company) return NextResponse.json({ error: "Company not found." }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "'name' is required." }, { status: 400 });
  }
  if (!SUPPORTED_ENGINES.includes(body.engine)) {
    return NextResponse.json(
      { error: `'engine' must be one of: ${SUPPORTED_ENGINES.join(", ")}.` },
      { status: 400 }
    );
  }

  const credentials =
    body.credentials && typeof body.credentials === "object"
      ? {
          dsn: typeof body.credentials.dsn === "string" ? body.credentials.dsn : undefined,
          host: typeof body.credentials.host === "string" ? body.credentials.host : undefined,
          port: typeof body.credentials.port === "number" ? body.credentials.port : undefined,
          database: typeof body.credentials.database === "string" ? body.credentials.database : undefined,
          username: typeof body.credentials.username === "string" ? body.credentials.username : undefined,
          password: typeof body.credentials.password === "string" ? body.credentials.password : undefined,
          ssl: typeof body.credentials.ssl === "boolean" ? body.credentials.ssl : undefined,
        }
      : undefined;

  const connection = await createConnection(id, {
    name: body.name.trim(),
    engine: body.engine,
    credentials,
    allow_writes: false,
    max_rows: 1000,
  });

  await recordAuditEvent({
    actor: session.user,
    action: "connection.created",
    targetType: "connection",
    targetId: connection.id,
    companyId: id,
    metadata: { name: connection.name, engine: connection.engine, host: credentials?.host },
  });

  // Best-effort: a connection with bad credentials should still get created
  // (there's a Test action to diagnose that) — registering its tables just
  // doesn't happen until credentials are fixed and someone hits Refresh.
  try {
    await registerTablesForConnection(id, connection);
  } catch {
    // Swallowed on purpose; see comment above.
  }

  return NextResponse.json(serializeConnection(connection), { status: 201 });
}
