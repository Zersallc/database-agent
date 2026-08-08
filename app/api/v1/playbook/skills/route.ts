import { defineRoute } from "@/lib/api/handler";
import { readListParams } from "@/lib/api/pagination";
import * as v from "@/lib/api/validate";
import { createSkill, listSkills, serializeSkill } from "@/lib/services/playbook";

export const runtime = "nodejs";

const CREATE = v.object({
  name: v.string({ min: 1, max: 120 }),
  description: v.withDefault(v.string({ max: 500 }), ""),
  content: v.string({ max: 100000, trim: false }),
  enabled: v.withDefault(v.boolean(), true),
});

export const GET = defineRoute({
  scopes: ["playbook:read"],
  rateLimit: "read",
  handler: async ({ principal, url }) => {
    const page = await listSkills(principal.tenantId, readListParams(url, { order: "asc" }));
    return {
      body: {
        data: page.data.map(serializeSkill),
        has_more: page.has_more,
        next_cursor: page.next_cursor,
      },
    };
  },
});

export const POST = defineRoute({
  scopes: ["playbook:write"],
  rateLimit: "write",
  idempotent: true,
  handler: async ({ principal, body }) => {
    const input = v.validate(body, CREATE);
    const doc = await createSkill(principal.tenantId, input);
    return { status: 201, body: serializeSkill(doc) };
  },
});
