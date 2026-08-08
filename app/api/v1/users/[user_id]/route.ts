import { requireAdmin } from "@/lib/api/auth";
import { defineRoute } from "@/lib/api/handler";
import * as v from "@/lib/api/validate";
import { deleteUser, requireUser, serializeUser, updateUser } from "@/lib/services/users";

export const runtime = "nodejs";

type Params = { user_id: string };

const UPDATE = v.object({
  name: v.optional(v.string({ min: 1, max: 120 })),
  company: v.optional(v.string({ max: 120 })),
  title: v.optional(v.string({ max: 120 })),
  role: v.optional(v.oneOf(["admin", "member", "viewer"] as const)),
  status: v.optional(v.oneOf(["active", "pending"] as const)),
});

export const GET = defineRoute<Params>({
  scopes: ["users:read"],
  rateLimit: "read",
  handler: async ({ principal, params }) => ({
    body: serializeUser(await requireUser(principal.tenantId, params.user_id)),
  }),
});

export const PATCH = defineRoute<Params>({
  scopes: ["users:write"],
  rateLimit: "write",
  handler: async ({ principal, params, body }) => {
    const input = v.validate(body, UPDATE);

    // Scope alone is not enough for a privilege change: a member key holding
    // `users:write` can edit a profile, but only an admin can hand out a role.
    if (input.role !== undefined) requireAdmin(principal);

    const doc = await updateUser(principal.tenantId, params.user_id, input);
    return { body: serializeUser(doc) };
  },
});

export const DELETE = defineRoute<Params>({
  scopes: ["users:write"],
  rateLimit: "write",
  handler: async ({ principal, params }) => {
    requireAdmin(principal);
    await deleteUser(principal.tenantId, params.user_id);
    return { status: 204 };
  },
});
