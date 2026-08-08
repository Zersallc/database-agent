import { defineRoute } from "@/lib/api/handler";
import { requireConnection, testConnection } from "@/lib/services/connections";

export const runtime = "nodejs";

type Params = { connection_id: string };

/**
 * A probe, not an assertion.
 *
 * A database that is down returns `200` with `status: "offline"` — the request
 * was valid and the answer is "it's offline". Returning an error status here
 * would conflate "you asked wrongly" with "the thing you asked about is
 * unhealthy", and a client checking connectivity needs to tell those apart.
 *
 * Not idempotency-keyed: it has no side effect beyond refreshing the recorded
 * status, so a retry is harmless.
 */
export const POST = defineRoute<Params>({
  scopes: ["connections:read"],
  rateLimit: "query",
  handler: async ({ principal, params }) => {
    const connection = await requireConnection(principal.tenantId, params.connection_id);
    return { body: await testConnection(principal.tenantId, connection) };
  },
});
