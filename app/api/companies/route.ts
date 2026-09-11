import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminSession } from "@/lib/require-admin";
import { recordAuditEvent } from "@/lib/services/audit";
import { serializeCompany, validateLogoInput } from "@/lib/services/company-logo";

export async function GET() {
  const { session, response } = await requireAdminSession();
  if (response) return response;

  // Developers can switch between companies, so they need the full list to
  // pick from. Every other admin only ever manages their own company.
  const isDeveloper = session.user.role === "Developer";
  const companies =
    !isDeveloper && !session.user.companyId
      ? []
      : await prisma.company.findMany({
          where: isDeveloper ? undefined : { id: session.user.companyId ?? undefined },
          include: { _count: { select: { users: true } } },
          orderBy: { createdAt: "desc" },
        });

  return NextResponse.json({ companies: companies.map(serializeCompany) });
}

export async function POST(req: NextRequest) {
  const { session, response } = await requireAdminSession();
  if (response) return response;

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const country = typeof body?.country === "string" ? body.country.trim() || null : null;
  const isActive = body?.isActive !== false;

  if (!name) {
    return NextResponse.json({ error: "Company name is required." }, { status: 400 });
  }

  try {
    validateLogoInput(body?.logo_base64, body?.logo_mime_type);
  } catch (cause) {
    return NextResponse.json({ error: (cause as Error).message }, { status: 400 });
  }

  const company = await prisma.company.create({
    data: {
      name,
      country,
      isActive,
      logoBase64: typeof body?.logo_base64 === "string" ? body.logo_base64 : null,
      logoMimeType: typeof body?.logo_mime_type === "string" ? body.logo_mime_type : null,
    },
    include: { _count: { select: { users: true } } },
  });

  await recordAuditEvent({
    actor: session.user,
    action: "company.created",
    targetType: "company",
    targetId: company.id,
    companyId: company.id,
    metadata: { name: company.name, country: company.country },
  });

  return NextResponse.json({ company: serializeCompany(company) }, { status: 201 });
}
