import { defineRoute } from "@/lib/api/handler";
import * as v from "@/lib/api/validate";
import { deleteSkill, requireSkill, serializeSkill, updateSkill } from "@/lib/services/playbook";

export const runtime = "nodejs";

type Params = { skill_id: string };

const UPDATE = v.object({
  name: v.optional(v.string({ min: 1, max: 120 })),
  description: v.optional(v.string({ max: 500 })),
  content: v.optional(v.string({ max: 100000, trim: false })),
  enabled: v.optional(v.boolean()),
});

export const GET = defineRoute<Params>({
  scopes: ["playbook:read"],
  rateLimit: "read",
  handler: async ({ principal, params }) => ({
    body: serializeSkill(await requireSkill(principal.tenantId, params.skill_id)),
  }),
});

export const PATCH = defineRoute<Params>({
  scopes: ["playbook:write"],
  rateLimit: "write",
  handler: async ({ principal, params, body }) => {
    const input = v.validate(body, UPDATE);
    const doc = await updateSkill(principal.tenantId, params.skill_id, input);
    return { body: serializeSkill(doc) };
  },
});

export const DELETE = defineRoute<Params>({
  scopes: ["playbook:write"],
  rateLimit: "write",
  handler: async ({ principal, params }) => {
    await deleteSkill(principal.tenantId, params.skill_id);
    return { status: 204 };
  },
});
