import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/require-admin";
import { listAuditEvents } from "@/lib/services/audit";

export async function GET(req: NextRequest) {
  const { response } = await requireAdminSession();
  if (response) return response;

  const companyId = req.nextUrl.searchParams.get("company_id") ?? undefined;
  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Number(limitParam) : undefined;

  const events = await listAuditEvents({ companyId, limit });
  return NextResponse.json({ events });
}
