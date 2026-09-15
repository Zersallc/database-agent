/**
 * Cheap, deterministic graders over what the agent actually did — no model
 * call of their own. Reserve `judge.ts` for properties these can't check.
 */

import type { EvalOutcome, GradeResult } from "./types";

export function usedConnection(outcome: EvalOutcome, name: string): GradeResult {
  const pass = outcome.executedSql.some((q) => q.connection === name);
  return {
    pass,
    reason: pass
      ? `queried "${name}" as expected`
      : `never queried "${name}"; queried: ${connectionsIn(outcome)}`,
  };
}

export function neverUsedConnection(outcome: EvalOutcome, name: string): GradeResult {
  const offending = outcome.executedSql.filter((q) => q.connection === name);
  return {
    pass: offending.length === 0,
    reason:
      offending.length === 0
        ? `"${name}" was correctly left alone`
        : `"${name}" was queried ${offending.length} time(s) when it should not have been`,
  };
}

/** At least one executed query's SQL text matches `pattern`. */
export function sqlMatchedBy(outcome: EvalOutcome, pattern: RegExp | string, why?: string): GradeResult {
  const re = typeof pattern === "string" ? new RegExp(pattern) : pattern;
  const pass = outcome.executedSql.some((q) => re.test(q.sql));
  const suffix = why ? ` (${why})` : "";
  return {
    pass,
    reason: pass
      ? `a query matched ${re}${suffix}`
      : `no executed query matched ${re}${suffix}; sql seen: ${sqlIn(outcome)}`,
  };
}

/** Alias of `sqlMatchedBy` for call sites checking a specific table name. */
export function queriedTable(outcome: EvalOutcome, pattern: RegExp | string): GradeResult {
  return sqlMatchedBy(outcome, pattern);
}

/** No executed query matches `pattern` — the inverse of `queriedTable`, for decoys/bad patterns. */
export function sqlNeverMatches(outcome: EvalOutcome, pattern: RegExp | string, why: string): GradeResult {
  const re = typeof pattern === "string" ? new RegExp(pattern) : pattern;
  const offending = outcome.executedSql.filter((q) => re.test(q.sql));
  return {
    pass: offending.length === 0,
    reason:
      offending.length === 0
        ? `no query matched ${re} (${why})`
        : `${offending.length} quer${offending.length === 1 ? "y" : "ies"} matched ${re} — ${why}: ${offending
            .map((q) => q.sql)
            .join(" | ")}`,
  };
}

/** ANDs several grades together; the reason names every failing one. */
export function allOf(...grades: GradeResult[]): GradeResult {
  const failed = grades.filter((g) => !g.pass);
  return {
    pass: failed.length === 0,
    reason: failed.length === 0 ? "all checks passed" : failed.map((g) => g.reason).join("; "),
  };
}

function connectionsIn(outcome: EvalOutcome): string {
  return outcome.executedSql.length ? [...new Set(outcome.executedSql.map((q) => q.connection))].join(", ") : "(none)";
}

function sqlIn(outcome: EvalOutcome): string {
  return outcome.executedSql.length ? outcome.executedSql.map((q) => q.sql).join(" | ") : "(no queries ran)";
}
