import { SCOPES } from "@/lib/api/auth";
import { defineRoute } from "@/lib/api/handler";
import { readListParams } from "@/lib/api/pagination";
import * as v from "@/lib/api/validate";
import { createApiKey, listApiKeys, serializeApiKey } from "@/lib/services/api-keys";

export const runtime = "nodejs";

const CREATE = v.object({
  name: v.optional(v.string({ max: 120 })),
  // Least privilege by default, same as inviting a user: a key minted with no
  // role specified should not silently come back an admin.
  role: v.withDefault(v.oneOf(["admin", "member", "viewer"] as const), "member"),
  scopes: v.optional(v.array(v.oneOf(SCOPES))),
});

export const GET = defineRoute({
  scopes: ["keys:read"],
  rateLimit: "read",
  handler: async ({ principal, url }) => {
    const page = await listApiKeys(principal.tenantId, readListParams(url, { order: "desc" }));
    return {
      body: {
        data: page.data.map(serializeApiKey),
        has_more: page.has_more,
        next_cursor: page.next_cursor,
      },
    };
  },
});

export const POST = defineRoute({
  scopes: ["keys:write"],
  rateLimit: "write",
  idempotent: true,
  handler: async ({ principal, body }) => {
    const input = v.validate(body, CREATE);
    const { doc, rawKey } = await createApiKey(principal.tenantId, principal.userId, input);
    return {
      status: 201,
      // The only response, ever, that carries the raw key. Every read after
      // this one — including GET on this same resource — returns `key_hint`.
      body: { ...serializeApiKey(doc), key: rawKey },
      headers: { Location: `/api/v1/keys/${doc.key_id}` },
    };
  },
});
