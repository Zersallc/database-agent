/**
 * SQL execution and query history.
 *
 * Every query the agent runs is persisted here, which is what makes an answer
 * auditable: a `query_id` in a run's trace opens the exact SQL and the exact
 * rows that produced the number in the reply. Without that, "revenue was $4.2M"
 * is something you either believe or you don't.
 */

import { notFound } from "@/lib/api/errors";
import { newId } from "@/lib/api/ids";
import { assertStatementAllowed } from "@/lib/connectors/sql-guard";
import { translateConnectorError, withConnector, type QueryResult } from "@/lib/connectors";
import { stores } from "@/lib/providers";
import { connectorOptions, type ConnectionDoc } from "./connections";

/**
 * Applied whenever a caller doesn't specify one — which today is every
 * caller. Without it, a model-written query with a missing WHERE clause or
 * an unindexed join runs unbounded against the connected database.
 */
const DEFAULT_QUERY_TIMEOUT_MS = Number(process.env.QUERY_TIMEOUT_MS ?? 30000);

export type QueryDoc = {
  id: string;
  object: "query";
  connection_id: string;
  sql: string;
  status: "succeeded" | "failed";
  columns: { name: string; data_type: string | null }[];
  rows: unknown[][];
  row_count: number;
  truncated: boolean;
  duration_ms: number;
  error: { code: string; message: string } | null;
  created_by: string | null;
  created_at: string;
};

export function serializeQuery(doc: QueryDoc) {
  return {
    id: doc.id,
    object: doc.object,
    connection_id: doc.connection_id,
    sql: doc.sql,
    status: doc.status,
    columns: doc.columns,
    rows: doc.rows,
    row_count: doc.row_count,
    truncated: doc.truncated,
    duration_ms: doc.duration_ms,
    error: doc.error,
    created_at: doc.created_at,
  };
}

export async function findQuery(tenantId: string, queryId: string): Promise<QueryDoc | null> {
  return stores().documents.get<QueryDoc>("queries", tenantId, queryId);
}

export async function requireQuery(tenantId: string, queryId: string): Promise<QueryDoc> {
  const doc = await findQuery(tenantId, queryId);
  if (!doc) throw notFound("query", queryId);
  return doc;
}

export type RunQueryInput = {
  sql: string;
  maxRows?: number;
  timeoutMs?: number;
  userId?: string | null;
};

/**
 * Runs SQL and records the outcome.
 *
 * A failed query is still recorded and still returned as a `200`-level result
 * with `status: "failed"` — the request was valid, the SQL was not, and the
 * caller needs the engine's error message to fix it. Only a rejection *before*
 * execution (write on a read-only connection, multiple statements) throws.
 */
export async function runQuery(
  tenantId: string,
  connection: ConnectionDoc,
  input: RunQueryInput
): Promise<QueryDoc> {
  assertStatementAllowed(input.sql, connection.allow_writes);

  const id = newId("query");
  const createdAt = new Date().toISOString();
  const options = await connectorOptions(connection);
  const maxRows = Math.min(input.maxRows ?? connection.max_rows, connection.max_rows);

  let result: QueryResult | null = null;
  let failure: { code: string; message: string } | null = null;

  try {
    result = await withConnector(connection.engine, options, (connector) =>
      connector.execute(input.sql, {
        maxRows,
        timeoutMs: input.timeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS,
      })
    );
  } catch (error) {
    const translated = translateConnectorError(error);
    failure = {
      code: (translated as { code?: string }).code ?? "upstream_database_error",
      message: translated instanceof Error ? translated.message : String(translated),
    };
  }

  const doc: QueryDoc = {
    id,
    object: "query",
    connection_id: connection.id,
    sql: input.sql,
    status: result ? "succeeded" : "failed",
    columns: result?.columns ?? [],
    rows: result?.rows ?? [],
    row_count: result?.row_count ?? 0,
    truncated: result?.truncated ?? false,
    duration_ms: result?.duration_ms ?? 0,
    error: failure,
    created_by: input.userId ?? null,
    created_at: createdAt,
  };

  await stores().documents.put("queries", tenantId, doc);
  return doc;
}

/** The `QueryResult` shape, for callers that want the data rather than the record. */
export function toQueryResult(doc: QueryDoc): QueryResult {
  return {
    columns: doc.columns,
    rows: doc.rows,
    row_count: doc.row_count,
    truncated: doc.truncated,
    duration_ms: doc.duration_ms,
  };
}
