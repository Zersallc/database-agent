/**
 * The metrics the A3 report is built from, one function per thing worth
 * measuring, each returning counts with their denominators.
 *
 * Nothing here decides whether a result is good. A function reports what
 * happened and over how many runs; deciding what is acceptable is for whoever
 * reads the report. Three rules keep the numbers honest:
 *
 * - Only `valid` runs count. A run the gateway turned away says nothing about
 *   the model (see ../classify.ts), so it is reported in the accounting and left
 *   out of every rate.
 * - Nothing is inferred from data a report does not have. The A0 baseline
 *   predates run-level detail (which tools were called, which sources were used,
 *   what kind of failure it was), so those metrics leave its runs out and say how
 *   many they left out, instead of reading "no detail" as "nothing happened".
 * - A failed run has one primary cause (`primaryCause` in ../report.ts), so one
 *   mistake is not counted as a routing failure, an answer failure and a
 *   provenance failure at once.
 */

import { aggregate, primaryCause, type NormalCase } from "../report";
import type { FailureCategory, RunRecord } from "../types";

export type Frac = { k: number; n: number };
export const frac = (k: number, n: number): Frac => ({ k, n });

export type Kind = "sql" | "search";
export type Shape = "sql" | "search" | "sql+search" | "none" | "asked";

/** Which sources a question needs and which it merely tolerates: "db:Sales", "lib:Contracts". */
export type Expectation = { required: string[]; allowed: string[] };
export type Expectations = ReadonlyMap<string, Expectation>;

/** A control's id is its case's id and "@variant". */
export const baseId = (id: string): string => id.split("@")[0];
export const variantOf = (id: string): string | null => (id.includes("@") ? id.slice(id.indexOf("@") + 1) : null);

const kindOfRef = (ref: string): Kind | null => (ref.startsWith("db:") ? "sql" : ref.startsWith("lib:") ? "search" : null);
const kindOfTool = (tool: string): Kind | null => (tool === "run_sql" ? "sql" : tool === "search_documents" ? "search" : null);

export function toolKinds(run: RunRecord): Set<Kind> {
  return new Set(run.tools.map(kindOfTool).filter((kind): kind is Kind => kind !== null));
}

export function shapeOf(run: RunRecord): Shape {
  const kinds = toolKinds(run);
  if (kinds.has("sql") && kinds.has("search")) return "sql+search";
  if (kinds.has("sql")) return "sql";
  if (kinds.has("search")) return "search";
  return run.ended_in_question ? "asked" : "none";
}

/**
 * The expectation for a case, with a control's missing piece taken out: a control
 * with no database cannot be expected to use one, and one with no library cannot
 * be expected to search.
 */
export function expectationFor(expectations: Expectations, caseId: string): Expectation | null {
  const base = expectations.get(baseId(caseId));
  if (!base) return null;
  const variant = variantOf(caseId);
  const drop = variant === "no-database" ? "db:" : variant === "no-library" ? "lib:" : null;
  if (!drop) return base;
  return {
    required: base.required.filter((ref) => !ref.startsWith(drop)),
    allowed: base.allowed.filter((ref) => !ref.startsWith(drop)),
  };
}

export type ValidRun = { caseId: string; family: string; run: RunRecord; detailed: boolean };

/** Every valid run, flat. */
export function validRuns(cases: NormalCase[]): ValidRun[] {
  return cases.flatMap((kase) =>
    kase.runs.filter((run) => run.status === "valid").map((run) => ({ caseId: kase.id, family: kase.family, run, detailed: kase.detailed }))
  );
}

/** Valid runs from reports that recorded what each run did. */
const detailedRuns = (cases: NormalCase[]): ValidRun[] => validRuns(cases).filter((entry) => entry.detailed);

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const zeroKinds = (): Record<Kind, number> => ({ sql: 0, search: 0 });
const zeroShapes = (): Record<Shape, number> => ({ sql: 0, search: 0, "sql+search": 0, none: 0, asked: 0 });

// -- 1. Tool selection: the right kind of tool, sql or search or neither ------

export type ToolSelection = {
  /** Valid runs with run-level detail. */
  runs: number;
  /** Of those, runs whose case declares what it needs. */
  evaluated: number;
  noExpectation: number;
  /** Used every kind the question needs and no kind it neither needs nor allows. */
  correct: number;
  shapes: Record<Shape, number>;
  /** A needed kind never used. */
  missingKind: Record<Kind, number>;
  /** A kind used that the question neither needs nor allows. */
  unexpectedKind: Record<Kind, number>;
  /** Valid runs left out because their report has no run-level detail. */
  withoutDetail: number;
};

export function toolSelection(cases: NormalCase[], expectations: Expectations): ToolSelection {
  const result: ToolSelection = {
    runs: 0, evaluated: 0, noExpectation: 0, correct: 0, shapes: zeroShapes(), missingKind: zeroKinds(), unexpectedKind: zeroKinds(),
    withoutDetail: validRuns(cases).length - detailedRuns(cases).length,
  };
  for (const { caseId, run } of detailedRuns(cases)) {
    result.runs += 1;
    result.shapes[shapeOf(run)] += 1;
    const expectation = expectationFor(expectations, caseId);
    if (!expectation) {
      result.noExpectation += 1;
      continue;
    }
    result.evaluated += 1;
    const needed = new Set(expectation.required.map(kindOfRef).filter((kind): kind is Kind => kind !== null));
    const tolerated = new Set([...needed, ...expectation.allowed.map(kindOfRef).filter((kind): kind is Kind => kind !== null)]);
    const used = toolKinds(run);
    const missing = [...needed].filter((kind) => !used.has(kind));
    const unexpected = [...used].filter((kind) => !tolerated.has(kind));
    for (const kind of missing) result.missingKind[kind] += 1;
    for (const kind of unexpected) result.unexpectedKind[kind] += 1;
    if (missing.length === 0 && unexpected.length === 0) result.correct += 1;
  }
  return result;
}

// -- 2. Source selection: the right library or database within the kind -----

export type SourceSelection = {
  /** Valid runs whose case declared which sources it needs, so a source can be called unneeded or missing. */
  evaluated: number;
  /** Used exactly the sources needed, or those and allowed ones: none missing, none unneeded. */
  exact: number;
  missing: { library: number; database: number };
  unnecessary: { library: number; database: number };
};

export function sourceSelection(cases: NormalCase[]): SourceSelection {
  const result: SourceSelection = { evaluated: 0, exact: 0, missing: { library: 0, database: 0 }, unnecessary: { library: 0, database: 0 } };
  for (const { run } of detailedRuns(cases)) {
    if (run.unnecessary_sources === null || run.missing_sources === null) continue;
    result.evaluated += 1;
    const missingLibrary = run.missing_sources.some((ref) => ref.startsWith("lib:"));
    const missingDatabase = run.missing_sources.some((ref) => ref.startsWith("db:"));
    const extraLibrary = run.unnecessary_sources.some((ref) => ref.startsWith("lib:"));
    const extraDatabase = run.unnecessary_sources.some((ref) => ref.startsWith("db:"));
    if (missingLibrary) result.missing.library += 1;
    if (missingDatabase) result.missing.database += 1;
    if (extraLibrary) result.unnecessary.library += 1;
    if (extraDatabase) result.unnecessary.database += 1;
    if (!missingLibrary && !missingDatabase && !extraLibrary && !extraDatabase) result.exact += 1;
  }
  return result;
}

// -- 3. Multi-source: a question that needs more than one source ------------

export type MultiSource = { evaluated: number; all: number; partial: number; none: number };

export function multiSource(cases: NormalCase[], expectations: Expectations): MultiSource {
  const result: MultiSource = { evaluated: 0, all: 0, partial: 0, none: 0 };
  for (const { caseId, run } of detailedRuns(cases)) {
    const expectation = expectationFor(expectations, caseId);
    if (!expectation || expectation.required.length < 2 || run.missing_sources === null) continue;
    result.evaluated += 1;
    if (run.missing_sources.length === 0) result.all += 1;
    else if (run.missing_sources.length < expectation.required.length) result.partial += 1;
    else result.none += 1;
  }
  return result;
}

// -- 4. Ambiguity: what the model did, described and not judged --------------

export type Behavior = {
  runs: number;
  shapes: Record<Shape, number>;
  /** Used no tool and ended with a question. */
  askedWithoutTools: number;
  /** Ended its answer with a question mark, whatever it did first. A proxy: an offer at the end counts. */
  endedInQuestion: number;
  /** Used at least one tool. */
  usedATool: number;
};

export function behavior(cases: NormalCase[]): Behavior {
  const result: Behavior = { runs: 0, shapes: zeroShapes(), askedWithoutTools: 0, endedInQuestion: 0, usedATool: 0 };
  for (const { run } of detailedRuns(cases)) {
    result.runs += 1;
    const shape = shapeOf(run);
    result.shapes[shape] += 1;
    if (shape === "asked") result.askedWithoutTools += 1;
    if (run.ended_in_question) result.endedInQuestion += 1;
    if (run.tools.length > 0) result.usedATool += 1;
  }
  return result;
}

// -- 5. Unnecessary searches -------------------------------------------------

export type Unnecessary = {
  /** Runs of cases that declare no library is needed, and how many searched one anyway. */
  libraryNotRequired: Frac;
  /** Runs with a source expectation in which a library was used that the question did not need. */
  unnecessaryLibrary: Frac;
  unnecessaryDatabase: Frac;
};

export function unnecessarySearches(cases: NormalCase[], expectations: Expectations): Unnecessary {
  let notRequiredRuns = 0;
  let notRequiredSearched = 0;
  let evaluated = 0;
  let library = 0;
  let database = 0;
  for (const { caseId, run } of detailedRuns(cases)) {
    const expectation = expectationFor(expectations, caseId);
    if (expectation && !expectation.required.some((ref) => ref.startsWith("lib:"))) {
      notRequiredRuns += 1;
      if (run.tools.includes("search_documents")) notRequiredSearched += 1;
    }
    if (run.unnecessary_sources === null) continue;
    evaluated += 1;
    if (run.unnecessary_sources.some((ref) => ref.startsWith("lib:"))) library += 1;
    if (run.unnecessary_sources.some((ref) => ref.startsWith("db:"))) database += 1;
  }
  return { libraryNotRequired: frac(notRequiredSearched, notRequiredRuns), unnecessaryLibrary: frac(library, evaluated), unnecessaryDatabase: frac(database, evaluated) };
}

// -- 6. Provenance -----------------------------------------------------------

export type Provenance = {
  /** Valid runs in which a search returned documents, so a Sources block was owed. */
  runsWithDocuments: number;
  blockDelivered: number;
  /** The model wrote a valid block without the corrective retry. */
  unprompted: number;
  /** Failed at least one check of this kind, alongside anything else. */
  anyGeneration: number;
  anySanitization: number;
  anyRendering: number;
  /** Failed with this as the primary cause. */
  primaryGeneration: number;
  primarySanitization: number;
  primaryRendering: number;
  /** Runs in which the application removed at least one line from the model's block. An approximation from line counts. */
  runsWithLinesRemoved: number;
};

export function provenance(cases: NormalCase[]): Provenance {
  const result: Provenance = {
    runsWithDocuments: 0, blockDelivered: 0, unprompted: 0, anyGeneration: 0, anySanitization: 0, anyRendering: 0,
    primaryGeneration: 0, primarySanitization: 0, primaryRendering: 0, runsWithLinesRemoved: 0,
  };
  for (const { run } of detailedRuns(cases)) {
    if (!run.documents_retrieved) continue;
    result.runsWithDocuments += 1;
    if (run.delivered_block) result.blockDelivered += 1;
    if (run.delivered_block && !run.provenance_retry) result.unprompted += 1;
    if (run.lines_removed > 0) result.runsWithLinesRemoved += 1;
    const categories = run.failure_categories;
    if (categories.includes("provenance_generation")) result.anyGeneration += 1;
    if (categories.includes("provenance_sanitization")) result.anySanitization += 1;
    if (categories.includes("rendering")) result.anyRendering += 1;
    const primary = primaryCause(categories);
    if (primary === "provenance_generation") result.primaryGeneration += 1;
    if (primary === "provenance_sanitization") result.primarySanitization += 1;
    if (primary === "rendering") result.primaryRendering += 1;
  }
  return result;
}

// -- 7. Retries --------------------------------------------------------------

export type Retries = {
  /** The corrective retry for a missing Sources block, over runs that retrieved documents. */
  provenance: Frac;
  /** Any other retry the loop's existing backstops took, over all valid runs. */
  other: Frac;
};

export function retries(cases: NormalCase[]): Retries {
  const runs = detailedRuns(cases);
  const withDocuments = runs.filter(({ run }) => run.documents_retrieved);
  return {
    provenance: frac(withDocuments.filter(({ run }) => run.provenance_retry).length, withDocuments.length),
    other: frac(runs.filter(({ run }) => run.other_retry).length, runs.length),
  };
}

// -- 8. Answer correctness, given that routing was right --------------------

export type AnswerGivenRouting = {
  /** Valid runs that did not fail routing, so the answer had what it needed to be right. */
  routedRight: number;
  /** Of those, runs whose only failure was the answer's own content. */
  answerFailed: number;
  /** Failed valid runs whose kind of failure the report did not record. */
  kindNotRecorded: number;
};

export function answerGivenRouting(cases: NormalCase[]): AnswerGivenRouting {
  const result: AnswerGivenRouting = { routedRight: 0, answerFailed: 0, kindNotRecorded: 0 };
  for (const { run, detailed } of validRuns(cases)) {
    if (!detailed) {
      if (!run.grade?.pass) result.kindNotRecorded += 1;
      continue;
    }
    if (run.failure_categories.includes("routing")) continue;
    result.routedRight += 1;
    if (primaryCause(run.failure_categories) === "answer") result.answerFailed += 1;
  }
  return result;
}

// -- 9. Cost -----------------------------------------------------------------

export type Cost = {
  validRuns: number;
  /** Agent requests sent, including ones for runs that were retried or never measured. Grading calls are not in it. */
  requests: number;
  inputTokens: number;
  outputTokens: number;
  /** Grading (LLM judge) calls and their input tokens: evaluation overhead, reported apart from what the agent spent. */
  judgeRequests: number;
  judgeInputTokens: number;
  rateLimitedRequests: number;
  requestsPerValidRun: number | null;
  inputPerRequest: number | null;
  outputPerRequest: number | null;
  inputPerValidRun: number | null;
  outputPerValidRun: number | null;
  /** Mean wall time of a valid run. It includes any wait after a rate limit. */
  msPerValidRun: number | null;
};

export function cost(cases: NormalCase[]): Cost {
  const valid = validRuns(cases);
  const totals = aggregate(cases);
  // The agent's own spending. A judge call is grading, so it is left out of what a question costs.
  const requests = sum(cases.map((kase) => kase.agentUsage.requests));
  const input = sum(cases.map((kase) => kase.agentUsage.input_tokens));
  const output = sum(cases.map((kase) => kase.agentUsage.output_tokens));
  const per = (value: number, over: number) => (over > 0 ? value / over : null);

  // From run records where there are any, from the case's own wall time where there are not.
  const detailedMs = sum(valid.filter((entry) => entry.detailed).map((entry) => entry.run.duration_ms));
  const undetailed = cases.filter((kase) => !kase.detailed);
  const undetailedValid = sum(undetailed.map((kase) => kase.runs.filter((run) => run.status === "valid").length));
  const ms = detailedMs + sum(undetailed.map((kase) => kase.duration_ms));

  return {
    validRuns: valid.length,
    requests,
    inputTokens: input,
    outputTokens: output,
    judgeRequests: sum(cases.map((kase) => kase.judgeUsage.requests)),
    judgeInputTokens: sum(cases.map((kase) => kase.judgeUsage.input_tokens)),
    rateLimitedRequests: totals.rate_limited_requests,
    requestsPerValidRun: per(requests, valid.length),
    inputPerRequest: per(input, requests),
    outputPerRequest: per(output, requests),
    inputPerValidRun: per(input, valid.length),
    outputPerValidRun: per(output, valid.length),
    msPerValidRun: per(ms, valid.filter((entry) => entry.detailed).length + undetailedValid),
  };
}

// -- 10. Failure accounting: how every scheduled run ended, and why ---------

export type RoutingPattern =
  | "no tool used"
  | "asked instead of using a tool"
  | "required source not used"
  | "unneeded source used"
  | "other routing (see the grade reason)";

export type FailureAccounting = {
  scheduled: number;
  attempts: number;
  valid: number;
  rateLimited: number;
  infrastructure: number;
  executionFailure: number;
  rateLimitedRequests: number;
  passed: number;
  failedValid: number;
  /** Failed valid runs by primary cause, from reports that recorded a kind of failure. */
  primary: Record<FailureCategory, number>;
  /** Failed valid runs whose kind of failure the report did not record. Not assigned to any category. */
  kindNotRecorded: number;
  /**
   * Routing failures by what the run did, one pattern each, first match wins. These
   * describe observed behavior; they are not causes.
   */
  routingPatterns: Record<RoutingPattern, number>;
};

const CATEGORIES: FailureCategory[] = ["routing", "retrieval", "provenance_generation", "provenance_sanitization", "rendering", "answer"];

export function routingPatternOf(run: RunRecord): RoutingPattern {
  if (run.tools.length === 0) return run.ended_in_question ? "asked instead of using a tool" : "no tool used";
  if (run.missing_sources && run.missing_sources.length > 0) return "required source not used";
  if (run.unnecessary_sources && run.unnecessary_sources.length > 0) return "unneeded source used";
  return "other routing (see the grade reason)";
}

export function failureAccounting(cases: NormalCase[]): FailureAccounting {
  const totals = aggregate(cases);
  const primary = Object.fromEntries(CATEGORIES.map((category) => [category, 0])) as Record<FailureCategory, number>;
  const patterns: Record<RoutingPattern, number> = {
    "no tool used": 0, "asked instead of using a tool": 0, "required source not used": 0, "unneeded source used": 0, "other routing (see the grade reason)": 0,
  };
  let kindNotRecorded = 0;
  for (const { run, detailed } of validRuns(cases)) {
    if (run.grade?.pass) continue;
    if (!detailed) {
      kindNotRecorded += 1;
      continue;
    }
    const cause = primaryCause(run.failure_categories);
    if (!cause) continue;
    primary[cause] += 1;
    if (cause === "routing") patterns[routingPatternOf(run)] += 1;
  }
  return {
    scheduled: totals.scheduled,
    attempts: totals.attempts,
    valid: totals.valid,
    rateLimited: totals.rate_limited,
    infrastructure: totals.infrastructure,
    executionFailure: totals.execution_failure,
    rateLimitedRequests: totals.rate_limited_requests,
    passed: totals.passed,
    failedValid: totals.failed,
    primary,
    kindNotRecorded,
    routingPatterns: patterns,
  };
}

/** Pass counts over valid runs. */
export function passes(cases: NormalCase[]): Frac {
  const runs = validRuns(cases);
  return frac(runs.filter(({ run }) => run.grade?.pass).length, runs.length);
}

/** Runs that used a search tool, over valid runs with run-level detail. */
export function searchRate(cases: NormalCase[]): Frac {
  const runs = detailedRuns(cases);
  return frac(runs.filter(({ run }) => run.tools.includes("search_documents")).length, runs.length);
}
