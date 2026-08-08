import { defineRoute } from "@/lib/api/handler";
import { requireModelProvider, testModelProvider } from "@/lib/services/model-providers";

export const runtime = "nodejs";

type Params = { model_provider_id: string };

/**
 * Checks the credential without generating tokens.
 *
 * Always `200` with the outcome in the body — a rejected key is a fact about the
 * provider, not a malformed request, and the settings page needs to render the
 * difference between "wrong key", "unreachable host", and "that model is not on
 * this account".
 */
export const POST = defineRoute<Params>({
  scopes: ["models:read"],
  rateLimit: "query",
  handler: async ({ principal, params }) => {
    const provider = await requireModelProvider(principal.tenantId, params.model_provider_id);
    return { body: await testModelProvider(principal.tenantId, provider) };
  },
});
