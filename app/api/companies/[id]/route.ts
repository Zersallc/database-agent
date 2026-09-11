import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminSession } from "@/lib/require-admin";
import { diffFields, recordAuditEvent } from "@/lib/services/audit";
import { serializeCompany, validateLogoInput } from "@/lib/services/company-logo";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, response } = await requireAdminSession();
  if (response) return response;

  const { id } = await params;
  const existing = await prisma.company.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Company not found." }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const data: {
    name?: string;
    country?: string | null;
    isActive?: boolean;
    logoBase64?: string | null;
    logoMimeType?: string | null;
  } = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
  if (typeof body.country === "string" || body.country === null) {
    data.country = body.country || null;
  }
  if (typeof body.isActive === "boolean") data.isActive = body.isActive;

  if (body.remove_logo === true) {
    data.logoBase64 = null;
    data.logoMimeType = null;
  } else if (typeof body.logo_base64 === "string") {
    try {
      validateLogoInput(body.logo_base64, body.logo_mime_type);
    } catch (cause) {
      return NextResponse.json({ error: (cause as Error).message }, { status: 400 });
    }
    data.logoBase64 = body.logo_base64;
    data.logoMimeType = body.logo_mime_type;
  }

  const company = await prisma.company.update({
    where: { id },
    data,
    include: { _count: { select: { users: true } } },
  });

  // Logo bytes don't belong in a human-readable audit log — record that it
  // changed, not the base64 payload itself.
  const { logoBase64, logoMimeType, ...dataForDiff } = data;
  const changes = diffFields(existing, dataForDiff);
  if (logoBase64 !== undefined || logoMimeType !== undefined) {
    changes.logo = { from: undefined, to: logoBase64 ? "updated" : "removed" };
  }
  if (Object.keys(changes).length > 0) {
    await recordAuditEvent({
      actor: session.user,
      action: "company.updated",
      targetType: "company",
      targetId: company.id,
      companyId: company.id,
      metadata: { changes },
    });
  }

  return NextResponse.json({ company: serializeCompany(company) });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, response } = await requireAdminSession();
  if (response) return response;

  const { id } = await params;
  const existing = await prisma.company.findUnique({
    where: { id },
    include: { _count: { select: { users: true } } },
  });
  if (!existing) {
    return NextResponse.json({ error: "Company not found." }, { status: 404 });
  }
  if (existing._count.users > 0) {
    return NextResponse.json(
      {
        error: `Cannot delete a company with ${existing._count.users} assigned user(s). Reassign or remove them first.`,
      },
      { status: 409 }
    );
  }

  await prisma.company.delete({ where: { id } });

  await recordAuditEvent({
    actor: session.user,
    action: "company.deleted",
    targetType: "company",
    targetId: id,
    companyId: id,
    metadata: { name: existing.name },
  });

  return NextResponse.json({ ok: true });
}
