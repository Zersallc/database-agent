/**
 * Reading back a query the agent actually ran.
 *
 * The SQL a message displays used to come from a ```sql fence the model wrote
 * — its recollection of the statement, retyped after the fact, and not
 * necessarily what executed. `lib/agent/index.ts` already records the real
 * statement and emits a `query_id` with the step, so the truth is on the
 * server and only needed fetching.
 *
 * Two hops, both already served: a message carries `run_id`, a run carries its
 * steps, and a step that ran a query carries `query_id`.
 */

/**
 * A loose fingerprint of a result set, used to recognise a table the model has
 * copied out of a query the interface is already showing.
 *
 * Loose on purpose: the model retypes `2593.00` as a string where the driver
 * may hand back a number, and the reader does not care which. Comparing the
 * printed form is what matches the thing a human would call "the same table".
 */
export function resultSignature(columns: string[], rows: unknown[][]): string {
  return JSON.stringify([
    columns.map((c) => String(c).trim().toLowerCase()),
    rows.map((row) => row.map((cellValue) => String(cellValue ?? "").trim())),
  ]);
}

export type ExecutedQuery = {
  id: string;
  sql: string;
  columns: string[];
  rows: (string | number | boolean | null)[][];
  rowCount: number;
  truncated: boolean;
  executionTimeMs: number;
  error: string | null;
  /** The step's own label — "Ran query", or the model's stated purpose. */
  label: string | null;
};

type QueryDoc = {
  id: string;
  sql: string;
  status: "succeeded" | "failed";
  columns: { name: string; data_type: string | null }[];
  rows: unknown[][];
  row_count: number;
  truncated: boolean;
  duration_ms: number;
  error: { code: string; message: string } | null;
};

type RunDoc = {
  steps?: { label: string; status: string; query_id?: string | null }[];
};

function cell(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value);
}

async function fetchQuery(queryId: string, label: string | null): Promise<ExecutedQuery | null> {
  const res = await fetch(`/api/v1/queries/${encodeURIComponent(queryId)}`);
  if (!res.ok) return null;
  const doc = (await res.json()) as QueryDoc;
  return {
    id: doc.id,
    sql: doc.sql,
    columns: (doc.columns ?? []).map((c) => c.name),
    rows: (doc.rows ?? []).map((row) => row.map(cell)),
    rowCount: doc.row_count ?? 0,
    truncated: doc.truncated ?? false,
    executionTimeMs: doc.duration_ms ?? 0,
    error: doc.error?.message ?? null,
    label,
  };
}

/**
 * Every query a run executed, in the order it ran them.
 *
 * `steps` is passed in when the caller already has it — the live stream hands
 * the whole run over on `run.completed`, and refetching it would be a second
 * request for something already in memory. A reloaded conversation has only
 * `run_id`, so the run is fetched.
 *
 * Anything missing yields an empty list rather than an error: a message with no
 * queries behind it is the ordinary case, not a failure.
 */
export async function queriesForRun(
  runId: string | null | undefined,
  steps?: RunDoc["steps"]
): Promise<ExecutedQuery[]> {
  let trace = steps;
  if (!trace) {
    if (!runId) return [];
    const res = await fetch(`/api/v1/runs/${encodeURIComponent(runId)}`);
    if (!res.ok) return [];
    trace = ((await res.json()) as RunDoc).steps ?? [];
  }

  const withQueries = trace.filter((step) => step.query_id);
  const found = await Promise.all(
    withQueries.map((step) => fetchQuery(step.query_id as string, step.label ?? null))
  );
  return found.filter((q): q is ExecutedQuery => q !== null);
}
