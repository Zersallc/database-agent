/**
 * The sources a run may use: which databases, and which document libraries.
 *
 * This is where authorization for data sources lives, and it is deliberately
 * not in the model's hands. A run starts by asking this for the sources the
 * user's workspace may use. The agent is then given exactly that list, and
 * every later decision (which database a statement goes to, which library a
 * search reaches) is made against it. A model that invents a name, or asks for
 * another workspace's library, or slips a tenant id into a tool call, gets
 * nothing, because the only things it can reach are the objects built here.
 *
 * Today the rule for "may use" is workspace membership: a connection belongs to
 * a company and every user of that company may use it. If per-user access ever
 * exists, this function is the one place it goes; `access.userId` is here for
 * that.
 */

import type { AgentConnection, AgentLibrary } from "@/lib/agent";
import { sanitizeDescription } from "@/lib/agent/libraries";
import type { SchemaTable } from "@/lib/connectors";
import { getSchema, listConnections, listMediaConnections } from "./connections";
import { searchFor } from "./document-search";
import { isMediaConnectionActive, mediaConnectionsEnabled } from "./media-flag";
import { runQuery, toQueryResult } from "./queries";

type Env = Record<string, string | undefined>;

export type SourceAccess = { tenantId: string; userId: string | null };

export type ResolvedSources = {
  databases: AgentConnection[];
  libraries: AgentLibrary[];
};

export async function resolveSources(
  access: SourceAccess,
  options: { env?: Env } = {}
): Promise<ResolvedSources> {
  const env = options.env ?? process.env;
  const [databases, libraries] = await Promise.all([
    resolveDatabases(access),
    resolveLibraries(access.tenantId, env),
  ]);
  return { databases, libraries };
}

/**
 * Every database this workspace has — the agent identifies which one a
 * question is about itself (see lib/agent's run_sql "database" parameter),
 * rather than being limited to whichever one a person picked before asking.
 * Introspection failing for one connection doesn't kill the run or the
 * others: that one is listed with an empty schema, so the agent knows it
 * exists but not to guess table names on it.
 */
async function resolveDatabases({ tenantId, userId }: SourceAccess): Promise<AgentConnection[]> {
  const connections = (await listConnections(tenantId, { order: "asc", limit: 50, cursor: null })).data;
  return Promise.all(
    connections.map(async (conn) => {
      let schema: SchemaTable[] = [];
      try {
        schema = (await getSchema(tenantId, conn)).tables;
      } catch (error) {
        console.error("[sources] schema fetch failed, connection continues with an empty schema", conn.id, error);
        schema = [];
      }
      return {
        id: conn.id,
        name: conn.name,
        engine: conn.engine,
        schema,
        description: sanitizeDescription(conn.description),
        // Each query opens its own connector. That costs a connection setup
        // per query; the alternative is holding one open across the whole
        // run, including across model latency, which is worse for a database
        // with a bounded connection pool.
        execute: async (sql: string) => {
          const query = await runQuery(tenantId, conn, { sql, userId });
          if (query.status === "failed") {
            throw new Error(query.error?.message ?? "The query failed.");
          }
          return { queryId: query.id, result: toQueryResult(query) };
        },
      };
    })
  );
}

/**
 * The libraries this workspace may search: media connections the deployment
 * has switched on and an administrator has not switched off individually.
 *
 * The deployment switch is checked first, so a workspace in a deployment that
 * never opted in does not even read these records, and the agent is never told
 * libraries exist.
 */
async function resolveLibraries(tenantId: string, env: Env): Promise<AgentLibrary[]> {
  if (!mediaConnectionsEnabled(env)) return [];
  const connections = await listMediaConnections(tenantId);
  return connections
    .filter((connection) => isMediaConnectionActive(connection, env))
    .map((connection) => ({
      name: connection.name.trim(),
      description: sanitizeDescription(connection.description),
      search: searchFor(connection, env),
    }));
}
