import { defineRoute } from "@/lib/api/handler";
import * as v from "@/lib/api/validate";
import { getPlaybook, replacePlaybook, serializePlaybook } from "@/lib/services/playbook";

export const runtime = "nodejs";

const REPLACE = v.object({
  system_prompt: v.string({ max: 100000, trim: false }),
});

export const GET = defineRoute({
  scopes: ["playbook:read"],
  rateLimit: "read",
  handler: async ({ principal }) => {
    const doc = await getPlaybook(principal.tenantId);
    return { body: await serializePlaybook(principal.tenantId, doc) };
  },
});

/**
 * PUT rather than PATCH: the system prompt is a single document that is
 * replaced wholesale, and there is no partial update that makes sense for it.
 * Skills are the granular part, and they have their own endpoints.
 */
export const PUT = defineRoute({
  scopes: ["playbook:write"],
  rateLimit: "write",
  handler: async ({ principal, body }) => {
    const input = v.validate(body, REPLACE);
    const doc = await replacePlaybook(principal.tenantId, input.system_prompt);
    return { body: await serializePlaybook(principal.tenantId, doc) };
  },
});
