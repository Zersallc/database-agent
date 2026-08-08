import { defineRoute } from "@/lib/api/handler";
import { requireQuery, serializeQuery } from "@/lib/services/queries";

export const runtime = "nodejs";

type Params = { query_id: string };

/**
 * A past query and its results.
 *
 * This is what a `query_id` in a run's trace resolves to — the audit trail that
 * turns "revenue was $4.2M" into a claim someone can check.
 */
export const GET = defineRoute<Params>({
  scopes: ["queries:read"],
  rateLimit: "read",
  handler: async ({ principal, params }) => ({
    body: serializeQuery(await requireQuery(principal.tenantId, params.query_id)),
  }),
});
