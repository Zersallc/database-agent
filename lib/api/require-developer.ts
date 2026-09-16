/**
 * The exception to single-tenant scoping, narrowed to exactly the Developer
 * role — mirrors the `role === "Developer"` check already used by
 * CompanySwitcher.tsx and /api/audit-events, /api/companies, /api/users,
 * /api/database-mapping. Deliberately NOT isAdminRole()/`principal.role ===
 * "admin"` (this file's own requireAdmin), which conflates Admin and
 * Developer and would leak every company's AI Feedback to every company's
 * own Admin — this resource is an internal engineering concern, not
 * something a customer Admin owns.
 *
 * A Bearer API key can never satisfy this: an API key belongs to one tenant
 * and has no equivalent of "Developer," so cross-tenant reach is never
 * appropriate for it.
 */

import { prisma } from "@/lib/db";
import { ApiError } from "./errors";
import type { Principal } from "./auth";

async function defaultLookupRole(userId: string): Promise<string | undefined> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  return user?.role;
}

/**
 * `lookupRole` is injectable so this can be unit-tested with a fake role
 * lookup instead of a live database connection — see
 * tests/ai-feedback.test.ts. Every real caller relies on the default.
 */
export async function requireDeveloperRole(
  principal: Principal,
  lookupRole: (userId: string) => Promise<string | undefined> = defaultLookupRole
): Promise<void> {
  if (principal.apiKeyId !== null) {
    throw new ApiError(
      "insufficient_role",
      "This endpoint is only available to a signed-in Developer account, not an API key."
    );
  }
  const role = await lookupRole(principal.userId);
  if (role !== "Developer") {
    throw new ApiError("insufficient_role", "This action requires the Developer role.", {
      details: { required_role: "Developer" },
    });
  }
}
