import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/require-admin";
import { listAuditEvents } from "@/lib/services/audit";

export async function GET(req: NextRequest) {
  const { session, response } = await requireAdminSession();
  if (response) return response;

  // Only a Developer (who can switch between companies) may ask for another
  // company's log via ?company_id — every other admin is always scoped to
  // their own, regardless of what's in the query string.
  const isDeveloper = session.user.role === "Developer";
  const requestedCompanyId = req.nextUrl.searchParams.get("company_id") ?? undefined;
  const companyId = isDeveloper ? requestedCompanyId : session.user.companyId ?? undefined;

  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Number(limitParam) : undefined;

  const events = await listAuditEvents({ companyId, limit });
  return NextResponse.json({ events });
}
