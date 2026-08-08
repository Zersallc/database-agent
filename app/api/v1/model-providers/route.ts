import { defineRoute } from "@/lib/api/handler";
import { readListParams } from "@/lib/api/pagination";
import * as v from "@/lib/api/validate";
import { PROVIDER_IDS, PROVIDER_PRESETS } from "@/lib/agent/providers";
import {
  createModelProvider,
  listModelProviders,
  serializeModelProvider,
} from "@/lib/services/model-providers";

export const runtime = "nodejs";

const CREATE = v.object({
  provider: v.oneOf(PROVIDER_IDS as [string, ...string[]]),
  model: v.string({ min: 1, max: 200 }),
  name: v.optional(v.string({ min: 1, max: 120 })),
  base_url: v.optional(v.string({ max: 500 })),
  // Write-only. Accepted here, stored in the secret store, never returned.
  api_key: v.optional(v.string({ min: 1, max: 500, trim: true })),
  is_default: v.optional(v.boolean()),
});

/**
 * The catalogue is served alongside the list so the settings UI does not have to
 * hardcode base URLs and model suggestions that would then drift from the
 * server's own idea of them.
 */
export const GET = defineRoute({
  scopes: ["models:read"],
  rateLimit: "read",
  handler: async ({ principal, url }) => {
    const page = await listModelProviders(principal.tenantId, readListParams(url, { order: "asc" }));
    return {
      body: {
        data: page.data.map(serializeModelProvider),
        has_more: page.has_more,
        next_cursor: page.next_cursor,
        presets: PROVIDER_PRESETS.map((preset) => ({
          id: preset.id,
          label: preset.label,
          kind: preset.kind,
          base_url: preset.baseUrl,
          suggested_model: preset.suggestedModel,
          docs_url: preset.docsUrl,
          requires_base_url: preset.requiresBaseUrl,
          key_optional: preset.keyOptional,
          note: preset.note ?? null,
        })),
      },
    };
  },
});

export const POST = defineRoute({
  scopes: ["models:write"],
  rateLimit: "write",
  idempotent: true,
  handler: async ({ principal, body }) => {
    const input = v.validate(body, CREATE);
    const doc = await createModelProvider(principal.tenantId, input);
    return {
      status: 201,
      body: serializeModelProvider(doc),
      headers: { Location: `/api/v1/model-providers/${doc.id}` },
    };
  },
});
