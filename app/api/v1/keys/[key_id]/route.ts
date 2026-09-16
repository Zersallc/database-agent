import { defineRoute } from "@/lib/api/handler";
import { requireApiKey, revokeApiKey, serializeApiKey } from "@/lib/services/api-keys";

export const runtime = "nodejs";

type Params = { key_id: string };

export const GET = defineRoute<Params>({
  scopes: ["keys:read"],
  rateLimit: "read",
  handler: async ({ principal, params }) => ({
    body: serializeApiKey(await requireApiKey(principal.tenantId, params.key_id)),
  }),
});

export const DELETE = defineRoute<Params>({
  scopes: ["keys:write"],
  rateLimit: "write",
  handler: async ({ principal, params }) => {
    await revokeApiKey(principal.tenantId, params.key_id);
    return { status: 204 };
  },
});
