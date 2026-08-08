import { defineRoute } from "@/lib/api/handler";
import * as v from "@/lib/api/validate";
import {
  deleteModelProvider,
  requireModelProvider,
  serializeModelProvider,
  updateModelProvider,
} from "@/lib/services/model-providers";

export const runtime = "nodejs";

type Params = { model_provider_id: string };

const UPDATE = v.object({
  name: v.optional(v.string({ min: 1, max: 120 })),
  model: v.optional(v.string({ min: 1, max: 200 })),
  base_url: v.optional(v.string({ max: 500 })),
  // Send to rotate the key. Omit to leave the stored one alone — there is no
  // way to read it back, so a form that round-tripped it would erase it.
  api_key: v.optional(v.string({ min: 1, max: 500 })),
  is_default: v.optional(v.boolean()),
});

export const GET = defineRoute<Params>({
  scopes: ["models:read"],
  rateLimit: "read",
  handler: async ({ principal, params }) => ({
    body: serializeModelProvider(
      await requireModelProvider(principal.tenantId, params.model_provider_id)
    ),
  }),
});

export const PATCH = defineRoute<Params>({
  scopes: ["models:write"],
  rateLimit: "write",
  handler: async ({ principal, params, body }) => {
    const input = v.validate(body, UPDATE);
    const doc = await updateModelProvider(principal.tenantId, params.model_provider_id, input);
    return { body: serializeModelProvider(doc) };
  },
});

export const DELETE = defineRoute<Params>({
  scopes: ["models:write"],
  rateLimit: "write",
  handler: async ({ principal, params }) => {
    await deleteModelProvider(principal.tenantId, params.model_provider_id);
    return { status: 204 };
  },
});
