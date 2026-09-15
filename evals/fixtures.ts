/** Small builders for the fabricated `QueryResult`s eval case fixtures return. */

import type { QueryResult } from "@/lib/connectors";

export function rowsResult(columns: string[], rows: unknown[][]): QueryResult {
  return {
    columns: columns.map((name) => ({ name, data_type: null })),
    rows,
    row_count: rows.length,
    truncated: false,
    duration_ms: 1,
  };
}

export function countResult(n: number): QueryResult {
  return rowsResult(["count"], [[n]]);
}

export function emptyResult(columns: string[] = []): QueryResult {
  return rowsResult(columns, []);
}
