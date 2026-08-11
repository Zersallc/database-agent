import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

/**
 * Session + role check shared by the Users/Companies admin routes. Distinct
 * from lib/api/auth.ts's Principal/scope system (that's the Bearer-key v1
 * API) — this is the plain "must be a signed-in Admin" gate for the
 * NextAuth-backed user/company management screens.
 */
export async function requireAdminSession() {
  const session = await auth();
  if (!session?.user?.id) {
    return { session: null, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (session.user.role !== "Admin") {
    return {
      session: null,
      response: NextResponse.json({ error: "Admin role required" }, { status: 403 }),
    };
  }
  return { session, response: null };
}
