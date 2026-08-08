/**
 * Row ceilings.
 *
 * An agent asked a vague question can easily write a query that returns ten
 * million rows. Fetching them all and slicing afterwards still pays for the
 * scan, the transfer, and the memory — so the ceiling has to reach the database,
 * not just the response.
 */

import { splitStatements } from "./sql-guard";

/**
 * Wraps a query so the engine itself stops at `limit` rows.
 *
 * Only applied to `SELECT`/`WITH`, which are the statements that can be safely
 * wrapped in a subquery. `SHOW`, `EXPLAIN`, and friends are returned untouched:
 * they cannot be wrapped, and they do not produce large result sets.
 *
 * An existing `LIMIT` inside the query is preserved — the wrapper takes the
 * more restrictive of the two, which is what a caller who wrote `LIMIT 10`
 * expects.
 */
export function applyRowCeiling(sql: string, limit: number): string {
  const statements = splitStatements(sql);
  if (statements.length !== 1) return sql;

  const firstWord = /^\s*([a-z]+)/i.exec(sql)?.[1]?.toLowerCase();
  if (firstWord !== "select" && firstWord !== "with" && firstWord !== "table") {
    return sql;
  }

  const trimmed = sql.trim().replace(/;\s*$/, "");
  return `SELECT * FROM (${trimmed}) AS agent_result LIMIT ${Math.floor(limit)}`;
}
