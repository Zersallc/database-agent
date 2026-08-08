import { defineRoute } from "@/lib/api/handler";
import * as v from "@/lib/api/validate";
import { requireConnection } from "@/lib/services/connections";
import { runQuery, serializeQuery } from "@/lib/services/queries";

export const runtime = "nodejs";

const CREATE = v.object({
  connection_id: v.string({ min: 1 }),
  sql: v.string({ min: 1, max: 100000, trim: false }),
  max_rows: v.optional(v.integer({ min: 1, max: 50000 })),
  timeout_ms: v.withDefault(v.integer({ min: 100, max: 300000 }), 30000),
});

/**
 * Executes SQL and records it.
 *
 * Idempotency-keyed even though a `SELECT` is naturally repeatable: on a
 * connection with `allow_writes` enabled it is not, and the endpoint cannot be
 * safe in one configuration and unsafe in another without the caller having to
 * know which.
 */
export const POST = defineRoute({
  scopes: ["queries:execute"],
  rateLimit: "query",
  idempotent: true,
  handler: async ({ principal, body }) => {
    const input = v.validate(body, CREATE);
    const connection = await requireConnection(principal.tenantId, input.connection_id);

    const query = await runQuery(principal.tenantId, connection, {
      sql: input.sql,
      maxRows: input.max_rows,
      timeoutMs: input.timeout_ms,
      userId: principal.userId,
    });

    return { status: 201, body: serializeQuery(query) };
  },
});
