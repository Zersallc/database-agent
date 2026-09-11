import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminSession } from "@/lib/require-admin";
import { recordAuditEvent } from "@/lib/services/audit";

function serializeCompany(company: {
  id: string;
  name: string;
  country: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  _count: { users: number };
}) {
  return {
    id: company.id,
    name: company.name,
    country: company.country,
    isActive: company.isActive,
    userCount: company._count.users,
    createdAt: company.createdAt,
    updatedAt: company.updatedAt,
  };
}

export async function GET() {
  const { response } = await requireAdminSession();
  if (response) return response;

  const companies = await prisma.company.findMany({
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

  const company = await prisma.company.create({
    data: { name, country, isActive },
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
