/**
 * Adding runs up, and reading the A0 baseline beside newer reports.
 *
 * The numbers an eval produces are only as good as the arithmetic that sums
 * them, and the baseline is in an older shape than the reports that will be
 * compared to it. Both are tested here with reports built by hand.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { aggregate, byFamily, normalize, primaryCause, type Report } from "@/evals/report";
import type { RunRecord } from "@/evals/types";

function record(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    status: "valid",
    attempts: 1,
    failure: null,
    grade: { pass: true, reason: "ok" },
    failure_categories: [],
    unnecessary_sources: [],
    missing_sources: [],
    tools: ["search_documents"],
    answered_without_tools: false,
    ended_in_question: false,
    documents_retrieved: true,
    provenance_retry: false,
    other_retry: false,
    delivered_block: true,
    lines_removed: 0,
    requests: 2,
    rate_limited_requests: 0,
    input_tokens: 100,
    output_tokens: 10,
    duration_ms: 1000,
    ...overrides,
  };
}

const usage = { agent: { calls: 4, input_tokens: 400, output_tokens: 40 }, judge: { calls: 1, input_tokens: 10, output_tokens: 5 } };

describe("reading the A0 baseline", () => {
  const baseline: Report = {
    ranAt: "2026-09-21T07:12:38.918Z",
    model: "syslab-default",
    repeat: 3,
    duration_ms: 1000,
    usage_total: usage,
    cases: [
      {
        id: "between-boundary",
        passRate: 2 / 3,
        results: [{ pass: true, reason: "a" }, { pass: true, reason: "b" }, { pass: false, reason: "c" }],
        duration_ms: 500,
        usage,
      },
    ],
  };

  test("every run in a report from before the accounting is a valid one, graded as recorded", () => {
    const [kase] = normalize(baseline);
    assert.equal(kase.family, "legacy");
    assert.equal(kase.detailed, false);
    assert.equal(kase.runs.length, 3);
    assert.deepEqual(kase.runs.map((run) => run.status), ["valid", "valid", "valid"]);
    assert.deepEqual(kase.runs.map((run) => run.grade?.pass), [true, true, false]);
  });

  test("its usage counts agent and judge requests together", () => {
    const [kase] = normalize(baseline);
    assert.deepEqual(kase.usage, { requests: 5, input_tokens: 410, output_tokens: 45 });
  });

  test("it aggregates like any other, with no provenance to report", () => {
    const totals = aggregate(normalize(baseline));
    assert.equal(totals.valid, 3);
    assert.equal(totals.passed, 2);
    assert.equal(totals.failed, 1);
    assert.equal(totals.failed_by.answer, 1, "a failure with no stated kind is an answer failure");
    assert.equal(totals.documents_retrieved, 0);
    assert.equal(totals.with_expectation, 0);
  });
});

describe("aggregate: how the runs ended", () => {
  const cases = normalize({
    ranAt: "x",
    model: "m",
    repeat: 6,
    duration_ms: 1,
    usage_total: usage,
    cases: [
      {
        id: "a",
        family: "media-only",
        passRate: 0.5,
        results: [],
        duration_ms: 10,
        usage,
        scheduled: 6,
        runs: [
          record(),
          record({ grade: { pass: false, reason: "wrong tool" }, failure_categories: ["routing"], unnecessary_sources: ["lib:HR Policies"] }),
          record({ status: "rate_limited", grade: null, attempts: 3, documents_retrieved: false, delivered_block: false, tools: [] }),
          record({ status: "infrastructure", grade: null, attempts: 2, documents_retrieved: false, delivered_block: false, tools: [] }),
          record({ status: "execution_failure", grade: null, documents_retrieved: false, delivered_block: false, tools: [] }),
          record({ provenance_retry: true, grade: { pass: false, reason: "no block" }, failure_categories: ["provenance_generation", "rendering"], missing_sources: ["db:Sales"] }),
        ],
      },
    ],
  });
  const totals = aggregate(cases);

  test("a run that did not reach the model is counted as such and never as a pass or a failure", () => {
    assert.equal(totals.scheduled, 6);
    assert.equal(totals.valid, 3);
    assert.equal(totals.rate_limited, 1);
    assert.equal(totals.infrastructure, 1);
    assert.equal(totals.execution_failure, 1);
    assert.equal(totals.passed + totals.failed, totals.valid);
  });

  test("attempts count every start, including the ones after a failure", () => {
    assert.equal(totals.attempts, 1 + 1 + 3 + 2 + 1 + 1);
  });

  test("failures are counted by kind, and a run that failed two ways counts under each", () => {
    assert.equal(totals.failed_by.routing, 1);
    assert.equal(totals.failed_by.provenance_generation, 1);
    assert.equal(totals.failed_by.rendering, 1);
    assert.equal(totals.failed_by.retrieval, 0);
  });

  test("a failed run has one primary cause, the earliest link in the chain, so one mistake is not charged three times", () => {
    assert.equal(primaryCause(["answer", "routing", "provenance_generation"]), "routing");
    assert.equal(primaryCause(["answer", "provenance_generation"]), "provenance_generation");
    assert.equal(primaryCause(["rendering", "provenance_sanitization"]), "provenance_sanitization");
    assert.equal(primaryCause(["answer"]), "answer");
    assert.equal(primaryCause([]), null);
    // The run that failed routing, provenance and rendering counts once, under routing.
    assert.equal(totals.failed_primary.routing, 1);
    assert.equal(totals.failed_primary.provenance_generation, 1, "the run that failed provenance generation and rendering counts once");
    assert.equal(totals.failed_primary.rendering, 0);
    assert.equal(Object.values(totals.failed_primary).reduce((a, b) => a + b, 0), totals.failed);
  });

  test("routed as expected means no routing failure", () => {
    assert.equal(totals.routed_as_expected, 2);
  });

  test("unnecessary and missing sources are counted over the runs that had an expectation", () => {
    assert.equal(totals.with_expectation, 3);
    assert.equal(totals.unnecessary, 1);
    assert.equal(totals.missing, 1);
  });

  test("provenance: how many runs owed a block, got one, wrote it unprompted, or needed the retry", () => {
    assert.equal(totals.documents_retrieved, 3);
    assert.equal(totals.block_delivered, 3);
    assert.equal(totals.block_first_try, 2);
    assert.equal(totals.provenance_retry, 1);
  });

  test("families group cases in the order first seen", () => {
    const groups = byFamily([...cases, { ...cases[0], id: "b", family: "efficiency" }, { ...cases[0], id: "c" }]);
    assert.deepEqual([...groups.keys()], ["media-only", "efficiency"]);
    assert.equal(groups.get("media-only")?.length, 2);
  });
});
