import { defineRoute } from "@/lib/api/handler";
import { requireRun, serializeRun } from "@/lib/services/runs";

export const runtime = "nodejs";

type Params = { run_id: string };

/**
 * A run and its trace.
 *
 * The recovery path for a client that lost a streaming connection mid-answer:
 * the run record is written before the agent starts and updated when it
 * finishes, so this always says what actually happened.
 */
export const GET = defineRoute<Params>({
  scopes: ["runs:read"],
  rateLimit: "read",
  handler: async ({ principal, params }) => ({
    body: serializeRun(await requireRun(principal.tenantId, params.run_id)),
  }),
});
