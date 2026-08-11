import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminSession } from "@/lib/require-admin";

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

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { response } = await requireAdminSession();
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

  const data: { name?: string; country?: string | null; isActive?: boolean } = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
  if (typeof body.country === "string" || body.country === null) {
    data.country = body.country || null;
  }
  if (typeof body.isActive === "boolean") data.isActive = body.isActive;

  const company = await prisma.company.update({
    where: { id },
    data,
    include: { _count: { select: { users: true } } },
  });

  return NextResponse.json({ company: serializeCompany(company) });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { response } = await requireAdminSession();
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
  return NextResponse.json({ ok: true });
}
