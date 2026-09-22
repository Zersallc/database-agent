/**
 * Cheap, deterministic graders over what the agent actually did — no model
 * call of their own. Reserve `judge.ts` for properties these can't check.
 */

import type { EvalOutcome, FailureCategory, GradeResult, SourceExpectation, SourceRef } from "./types";

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

/** The final answer contains `value` — for a fact it had to read rather than invent. */
export function answerMentions(outcome: EvalOutcome, value: string, why: string): GradeResult {
  const pass = outcome.finalText.toLowerCase().includes(value.toLowerCase());
  return {
    pass,
    reason: pass ? `the answer named "${value}" (${why})` : `the answer never names "${value}" — ${why}`,
  };
}

/** The final answer matches nothing like `pattern` — for a claim it must not make. */
export function answerNeverMatches(outcome: EvalOutcome, pattern: RegExp, why: string): GradeResult {
  const pass = !pattern.test(outcome.finalText);
  return {
    pass,
    reason: pass ? `the answer avoided ${pattern} (${why})` : `the answer matched ${pattern} — ${why}`,
  };
}

/**
 * The answer does not retype the result set at it.
 *
 * The rows are on screen in a sortable, exportable table directly above the
 * answer, so a prose list of them is the same data twice — and the handful the
 * model picks are not the ones the reader would have picked. Naming one or two
 * as examples is the legitimate version of this, which is what `max` allows
 * for; ten is the failure.
 */
export function retypesRows(
  outcome: EvalOutcome,
  values: string[],
  max: number
): GradeResult {
  const answer = outcome.finalText.toLowerCase();
  const quoted = values.filter((value) => answer.includes(value.toLowerCase()));
  return {
    pass: quoted.length <= max,
    reason:
      quoted.length <= max
        ? `${quoted.length} row value(s) named, within the ${max} allowed as examples`
        : `${quoted.length} of ${values.length} row values were retyped into the prose (at most ${max} should be): ${quoted
            .slice(0, 5)
            .join(", ")}…`,
  };
}

/** The failed checks inside a grade, each with a kind. A grade that never said is an `answer` failure. */
export function failuresOf(grade: GradeResult): { category: FailureCategory; reason: string }[] {
  if (grade.pass) return [];
  if (grade.failures?.length) return grade.failures;
  return [{ category: grade.category ?? "answer", reason: grade.reason }];
}

/** ANDs several grades together; the reason names every failing one and the failures keep their kinds. */
export function allOf(...grades: GradeResult[]): GradeResult {
  const failed = grades.filter((g) => !g.pass);
  return {
    pass: failed.length === 0,
    reason: failed.length === 0 ? "all checks passed" : failed.map((g) => g.reason).join("; "),
    ...(failed.length > 0 ? { failures: failed.flatMap(failuresOf) } : {}),
  };
}

/**
 * ORs several grades together, for a case with more than one right answer.
 *
 * Not a weaker `allOf`. Some questions genuinely have two correct moves —
 * group by the column that repeats, or tell the reader the one they named does
 * not — and grading only the move we happened to think of first would fail the
 * other for being different rather than wrong.
 */
export function anyOf(...grades: GradeResult[]): GradeResult {
  const passed = grades.find((g) => g.pass);
  return {
    pass: Boolean(passed),
    reason: passed ? passed.reason : `none of the accepted answers: ${grades.map((g) => g.reason).join("; ")}`,
    ...(passed ? {} : { failures: grades.flatMap(failuresOf) }),
  };
}

function connectionsIn(outcome: EvalOutcome): string {
  return outcome.executedSql.length ? [...new Set(outcome.executedSql.map((q) => q.connection))].join(", ") : "(none)";
}

function sqlIn(outcome: EvalOutcome): string {
  return outcome.executedSql.length ? outcome.executedSql.map((q) => q.sql).join(" | ") : "(no queries ran)";
}
