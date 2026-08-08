import { defineRoute } from "@/lib/api/handler";
import { readListParams } from "@/lib/api/pagination";
import * as v from "@/lib/api/validate";
import { createUser, listUsers, serializeUser } from "@/lib/services/users";

export const runtime = "nodejs";

const CREATE = v.object({
  name: v.string({ min: 1, max: 120 }),
  email: v.string({ min: 3, max: 320, format: "email" }),
  company: v.optional(v.string({ max: 120 })),
  title: v.optional(v.string({ max: 120 })),
  // Least privilege by default: an invite that silently granted admin would be
  // a bad surprise, and promoting afterwards is one PATCH away.
  role: v.withDefault(v.oneOf(["admin", "member", "viewer"] as const), "member"),
});

export const GET = defineRoute({
  scopes: ["users:read"],
  rateLimit: "read",
  handler: async ({ principal, url }) => {
    const page = await listUsers(principal.tenantId, readListParams(url, { order: "asc" }));
    return {
      body: {
        data: page.data.map(serializeUser),
        has_more: page.has_more,
        next_cursor: page.next_cursor,
      },
    };
  },
});

export const POST = defineRoute({
  scopes: ["users:write"],
  rateLimit: "write",
  idempotent: true,
  handler: async ({ principal, body }) => {
    const input = v.validate(body, CREATE);
    const doc = await createUser(principal.tenantId, input);
    return {
      status: 201,
      body: serializeUser(doc),
      headers: { Location: `/api/v1/users/${doc.id}` },
    };
  },
});
