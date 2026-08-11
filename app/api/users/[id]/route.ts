import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { requireAdminSession } from "@/lib/require-admin";
import { encryptSecret, hintFor } from "@/lib/crypto";

function serializeUser(user: {
  id: string;
  email: string;
  name: string | null;
  role: string;
  companyId: string | null;
  company: { id: string; name: string } | null;
  isActive: boolean;
  aiApiKeyHint: string | null;
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
    hasAiApiKey: user.aiApiKeyHint !== null,
    aiApiKeyHint: user.aiApiKeyHint,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { response } = await requireAdminSession();
  if (response) return response;

  const { id } = await params;
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const data: {
    email?: string;
    name?: string | null;
    role?: string;
    companyId?: string | null;
    isActive?: boolean;
    password?: string;
    aiApiKeyEnc?: string | null;
    aiApiKeyHint?: string | null;
  } = {};

  if (typeof body.email === "string" && body.email.trim()) {
    const email = body.email.trim().toLowerCase();
    if (email !== existing.email) {
      const conflict = await prisma.user.findUnique({ where: { email } });
      if (conflict) {
        return NextResponse.json({ error: "A user with that email already exists." }, { status: 409 });
      }
      data.email = email;
    }
  }
  if (typeof body.name === "string") data.name = body.name.trim() || null;
  if (body.role === "Admin" || body.role === "User") data.role = body.role;
  if (typeof body.companyId === "string" || body.companyId === null) {
    data.companyId = body.companyId || null;
  }
  if (typeof body.isActive === "boolean") data.isActive = body.isActive;

  if (typeof body.password === "string" && body.password) {
    if (body.password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
    }
    data.password = await bcrypt.hash(body.password, 12);
  }

  // aiApiKey: omitted -> unchanged. Non-empty string -> re-encrypt. Explicit
  // empty string -> clear it. Distinguishing "omitted" from "empty" is why
  // this checks `"aiApiKey" in body` rather than truthiness.
  if ("aiApiKey" in body) {
    const key = typeof body.aiApiKey === "string" ? body.aiApiKey.trim() : "";
    data.aiApiKeyEnc = key ? encryptSecret(key) : null;
    data.aiApiKeyHint = key ? hintFor(key) : null;
  }

  const user = await prisma.user.update({
    where: { id },
    data,
    include: { company: { select: { id: true, name: true } } },
  });

  return NextResponse.json({ user: serializeUser(user) });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, response } = await requireAdminSession();
  if (response) return response;

  const { id } = await params;

  if (id === session.user.id) {
    return NextResponse.json({ error: "You cannot delete your own account." }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  await prisma.user.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
