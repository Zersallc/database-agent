import { defineRoute } from "@/lib/api/handler";
import { getSchema, requireConnection } from "@/lib/services/connections";

export const runtime = "nodejs";

type Params = { connection_id: string };

/**
 * The tables and columns the agent reads before writing SQL.
 *
 * Served from cache by default because it goes into the system prompt on every
 * turn; `?refresh=true` forces re-introspection after a migration.
 */
export const GET = defineRoute<Params>({
  scopes: ["connections:read"],
  rateLimit: "query",
  handler: async ({ principal, params, url }) => {
    const connection = await requireConnection(principal.tenantId, params.connection_id);
    const refresh = url.searchParams.get("refresh") === "true";
    const schema = await getSchema(principal.tenantId, connection, { refresh });

    return {
      body: {
        connection_id: connection.id,
        object: "database_schema",
        fetched_at: schema.fetched_at,
        cached: schema.cached,
        tables: schema.tables,
      },
    };
  },
});
