/**
 * Runs a SQL block against the conversation's connection.
 *
 * This replaces a frontend stub (`mockExecute`) that fabricated plausible rows
 * — first names, regions, a row count and a duration — whenever a ```sql block
 * was rendered. It was written as scaffolding for the result view and shipped,
 * so every query the reader pressed Execute on, and every block auto-run by the
 * "Auto-run generated SQL" setting, produced invented data that was
 * indistinguishable on screen from a real result.
 *
 * The rule this file exists to keep: nothing renders as a result unless a
 * database returned it. A failure is shown as a failure.
 */

export type QueryResult = {
  columns: string[];
  rows: (string | number | boolean | null)[][];
  executionTimeMs: number;
  rowCount: number;
  /** The server capped the row count. Say so rather than imply completeness. */
  truncated: boolean;
};

/** The API's error envelope: `{code, message}` at the top level, not nested. */
type ErrorEnvelope = { code?: string; message?: string };

type QueryResponse = {
  status: "succeeded" | "failed";
  columns: { name: string; data_type: string | null }[];
  rows: unknown[][];
  row_count: number;
  truncated: boolean;
  duration_ms: number;
  error: { code: string; message: string } | null;
};

/** A cell the table renderer can display. Everything else becomes its JSON. */
function cell(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value);
}

export async function executeQuery(connectionId: string, sql: string): Promise<QueryResult> {
  const res = await fetch("/api/v1/queries", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({ connection_id: connectionId, sql }),
  });

  // Two different shapes, and they are not nested the same way. A non-2xx is
  // the API's error envelope, `message` at the top level — "this connection is
  // read-only", "no connection with ID x". A 201 is a recorded query that may
  // still have failed, and its reason sits under `error`. Reading only the
  // second turns every rejection into a bare status code.
  let body: (QueryResponse & ErrorEnvelope) | null = null;
  try {
    body = (await res.json()) as QueryResponse & ErrorEnvelope;
  } catch {
    body = null;
  }

  if (!res.ok) {
    throw new Error(
      body?.message ?? body?.error?.message ?? `The query could not be run (${res.status}).`
    );
  }
  if (!body) {
    throw new Error("The query service returned a response this app could not read.");
  }
  // A query that reached the database and was rejected by it comes back 201
  // with status "failed" — the run was recorded, the statement did not work.
  if (body.status === "failed" || body.error) {
    throw new Error(body.error?.message ?? "The database rejected this query.");
  }

  return {
    columns: body.columns.map((column) => column.name),
    rows: body.rows.map((row) => row.map(cell)),
    rowCount: body.row_count,
    truncated: body.truncated,
    executionTimeMs: body.duration_ms,
  };
}
