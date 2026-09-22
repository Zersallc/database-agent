/**
 * Reading eval reports and adding them up.
 *
 * Two shapes exist. The A0 baseline predates the run accounting: each case has a
 * pass rate over its runs and nothing about how any single run ended, because
 * every run in it was valid. Later reports carry a record per scheduled run
 * (`RunRecord`). `normalize` puts both in one shape so a comparison can set an
 * old report beside a new one without special cases, and `aggregate` adds
 * runs up into the accounting the evals report:
 *
 *   scheduled
 *   ├── valid                 (the model's to pass or fail)
 *   ├── rate limited          (the gateway's, not the model's)
 *   ├── infrastructure        (the network's or the server's)
 *   └── other execution failure
 *
 *   among valid runs
 *   ├── passed / failed, and failed by kind
 *   ├── routed as expected / not
 *   ├── valid provenance / missing or invalid
 *   └── corrective retry
 */

import { readFileSync } from "node:fs";

import type { Meter } from "./meter";
import type { FailureCategory, GradeResult, RunRecord } from "./types";

export type CaseReport = {
  id: string;
  description?: string;
  family?: string;
  passRate: number | null;
  results: GradeResult[];
  duration_ms: number;
  usage: { agent: Partial<Meter>; judge: Partial<Meter> };
  // Present from the run accounting on.
  scheduled?: number;
  valid?: number;
  rate_limited?: number;
  infrastructure?: number;
  execution_failure?: number;
  runs?: RunRecord[];
  stopped?: string | null;
};

export type Report = {
  schema?: number;
  label?: string;
  ranAt: string;
  model: string;
  repeat: number;
  env?: { commit?: string | null; branch?: string | null; dirty_files?: string[]; model_endpoint?: string | null };
  duration_ms: number;
  usage_total: { agent: Partial<Meter>; judge: Partial<Meter> };
  cases: CaseReport[];
};

export function loadReport(path: string): Report {
  return JSON.parse(readFileSync(path, "utf8")) as Report;
}

export type NormalCase = {
  id: string;
  family: string;
  scheduled: number;
  /** One record per scheduled run. For a report from before the accounting, every run is valid and only its grade is known. */
  runs: RunRecord[];
  /** Whether the run-level detail (tools, provenance, retries) is real or absent. */
  detailed: boolean;
  /** Agent and judge together: the load the run put on the model server. */
  usage: { requests: number; input_tokens: number; output_tokens: number };
  /** What the agent itself spent. This, not `usage`, is what a user's question costs. */
  agentUsage: { requests: number; input_tokens: number; output_tokens: number };
  /** Grading calls (an LLM judge), which are evaluation overhead and not agent cost. */
  judgeUsage: { requests: number; input_tokens: number; output_tokens: number };
  duration_ms: number;
};

const blankRecord = (grade: GradeResult): RunRecord => ({
  status: "valid",
  attempts: 1,
  failure: null,
  grade,
  failure_categories: grade.pass ? [] : [grade.category ?? "answer"],
  unnecessary_sources: null,
  missing_sources: null,
  tools: [],
  answered_without_tools: false,
  ended_in_question: false,
  documents_retrieved: false,
  provenance_retry: false,
  other_retry: false,
  delivered_block: false,
  lines_removed: 0,
  requests: 0,
  rate_limited_requests: 0,
  input_tokens: 0,
  output_tokens: 0,
  duration_ms: 0,
});

export function normalize(report: Report): NormalCase[] {
  return report.cases.map((kase) => {
    const detailed = Array.isArray(kase.runs);
    const runs = detailed ? kase.runs! : kase.results.map(blankRecord);
    const agent = kase.usage?.agent ?? {};
    const judge = kase.usage?.judge ?? {};
    return {
      id: kase.id,
      family: kase.family ?? "legacy",
      scheduled: kase.scheduled ?? runs.length,
      runs,
      detailed,
      usage: {
        requests: (agent.calls ?? 0) + (judge.calls ?? 0),
        input_tokens: (agent.input_tokens ?? 0) + (judge.input_tokens ?? 0),
        output_tokens: (agent.output_tokens ?? 0) + (judge.output_tokens ?? 0),
      },
      agentUsage: { requests: agent.calls ?? 0, input_tokens: agent.input_tokens ?? 0, output_tokens: agent.output_tokens ?? 0 },
      judgeUsage: { requests: judge.calls ?? 0, input_tokens: judge.input_tokens ?? 0, output_tokens: judge.output_tokens ?? 0 },
      duration_ms: kase.duration_ms,
    };
  });
}

export type Aggregate = {
  scheduled: number;
  /** Times a run was started, counting each retry after a failure. */
  attempts: number;
  valid: number;
  rate_limited: number;
  infrastructure: number;
  execution_failure: number;
  passed: number;
  failed: number;
  /** Failed valid runs by kind. A run that failed two ways counts under each. */
  failed_by: Record<FailureCategory, number>;
  /**
   * Failed valid runs by their primary cause, one each. A model that never
   * searched fails the routing check and, downstream of that, has no fact to state
   * and no source to cite; counting all three would charge one mistake three
   * times. The primary cause is the earliest link in the chain (`PRIMARY_ORDER`).
   */
  failed_primary: Record<FailureCategory, number>;
  routed_as_expected: number;
  /** Valid runs of cases that declare which sources they need. */
  with_expectation: number;
  /** Of those, runs that used a source the question did not need. */
  unnecessary: number;
  /** Of those, runs that never used a source the question required. */
  missing: number;
  /** Valid runs in which a search returned documents, so a Sources block was owed. */
  documents_retrieved: number;
  /** Of those, the answer that was delivered ends with a block. */
  block_delivered: number;
  /** Of those, the model wrote a valid block without being asked again. */
  block_first_try: number;
  /** Of those, the corrective retry fired. */
  provenance_retry: number;
  /** Valid runs in which any other retry fired. */
  other_retry: number;
  answered_without_tools: number;
  ended_in_question: number;
  requests: number;
  rate_limited_requests: number;
  input_tokens: number;
  output_tokens: number;
  duration_ms: number;
};

const CATEGORIES: FailureCategory[] = ["routing", "answer", "retrieval", "provenance_generation", "provenance_sanitization", "rendering"];

/**
 * Which kind of failure is the cause when a run has several. What the model does
 * comes before what the service returns, before what the model writes about it,
 * before what the application does to that, before how it is drawn, and the
 * answer's own content is downstream of all of them.
 */
const PRIMARY_ORDER: FailureCategory[] = ["routing", "retrieval", "provenance_generation", "provenance_sanitization", "rendering", "answer"];

export function primaryCause(categories: FailureCategory[]): FailureCategory | null {
  return PRIMARY_ORDER.find((category) => categories.includes(category)) ?? null;
}

export function aggregate(cases: NormalCase[]): Aggregate {
  const total: Aggregate = {
    scheduled: 0, attempts: 0, valid: 0, rate_limited: 0, infrastructure: 0, execution_failure: 0,
    passed: 0, failed: 0,
    failed_by: Object.fromEntries(CATEGORIES.map((category) => [category, 0])) as Record<FailureCategory, number>,
    failed_primary: Object.fromEntries(CATEGORIES.map((category) => [category, 0])) as Record<FailureCategory, number>,
    routed_as_expected: 0, with_expectation: 0, unnecessary: 0, missing: 0,
    documents_retrieved: 0, block_delivered: 0, block_first_try: 0, provenance_retry: 0, other_retry: 0,
    answered_without_tools: 0, ended_in_question: 0,
    requests: 0, rate_limited_requests: 0, input_tokens: 0, output_tokens: 0, duration_ms: 0,
  };

  for (const kase of cases) {
    total.scheduled += kase.scheduled;
    total.duration_ms += kase.duration_ms;
    total.requests += kase.usage.requests;
    total.input_tokens += kase.usage.input_tokens;
    total.output_tokens += kase.usage.output_tokens;

    for (const run of kase.runs) {
      total.attempts += run.attempts;
      total.rate_limited_requests += run.rate_limited_requests;
      if (run.status === "rate_limited") total.rate_limited += 1;
      else if (run.status === "infrastructure") total.infrastructure += 1;
      else if (run.status === "execution_failure") total.execution_failure += 1;
      if (run.status !== "valid") continue;

      total.valid += 1;
      if (run.grade?.pass) total.passed += 1;
      else total.failed += 1;
      for (const category of run.failure_categories) total.failed_by[category] += 1;
      const primary = primaryCause(run.failure_categories);
      if (primary) total.failed_primary[primary] += 1;
      if (!run.failure_categories.includes("routing")) total.routed_as_expected += 1;

      if (run.unnecessary_sources !== null) {
        total.with_expectation += 1;
        if (run.unnecessary_sources.length > 0) total.unnecessary += 1;
        if ((run.missing_sources ?? []).length > 0) total.missing += 1;
      }

      if (run.documents_retrieved) {
        total.documents_retrieved += 1;
        if (run.delivered_block) total.block_delivered += 1;
        if (!run.provenance_retry && run.delivered_block) total.block_first_try += 1;
        if (run.provenance_retry) total.provenance_retry += 1;
      }
      if (run.other_retry) total.other_retry += 1;
      if (run.answered_without_tools) total.answered_without_tools += 1;
      if (run.ended_in_question) total.ended_in_question += 1;
    }
  }
  return total;
}

/** Cases grouped by family, in the order first seen. */
export function byFamily(cases: NormalCase[]): Map<string, NormalCase[]> {
  const groups = new Map<string, NormalCase[]>();
  for (const kase of cases) {
    const group = groups.get(kase.family) ?? [];
    group.push(kase);
    groups.set(kase.family, group);
  }
  return groups;
}
