import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { requireAdminSession } from "@/lib/require-admin";

function serializeUser(user: {
  id: string;
  email: string;
  name: string | null;
  role: string;
  companyId: string | null;
  company: { id: string; name: string } | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    companyId: user.companyId,
    companyName: user.company?.name ?? null,
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export async function GET() {
  const { response } = await requireAdminSession();
  if (response) return response;

  const users = await prisma.user.findMany({
    include: { company: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ users: users.map(serializeUser) });
}

export async function POST(req: NextRequest) {
  const { response } = await requireAdminSession();
  if (response) return response;

  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const name = typeof body?.name === "string" ? body.name.trim() || null : null;
  const role = body?.role === "Admin" ? "Admin" : body?.role === "Viewer" ? "Viewer" : "User";
  const companyId = typeof body?.companyId === "string" && body.companyId ? body.companyId : null;
  const isActive = body?.isActive !== false;

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "A user with that email already exists." }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: {
      email,
      password: passwordHash,
      name,
      role,
      companyId,
      isActive,
    },
    include: { company: { select: { id: true, name: true } } },
  });

  return NextResponse.json({ user: serializeUser(user) }, { status: 201 });
}
