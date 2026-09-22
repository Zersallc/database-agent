/**
 * The A3 analysis tooling, on results built by hand.
 *
 * The analysis is what turns evaluation runs into the numbers a decision is made
 * from, so its own arithmetic and its own guarantees are tested here, without a
 * model and without the real result files: that it counts only valid runs, that
 * it infers nothing from a result that lacks run detail, that a failed run has one
 * primary cause, that two passes are never averaged, that a missing result is TBD
 * and never an empty table, and that the report never states a verdict.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { pairControls } from "@/evals/analysis/controls";
import { renderReport } from "@/evals/analysis/document";
import { DEFAULT_MANIFEST, loadResults, type ManifestEntry, type Role } from "@/evals/analysis/manifest";
import {
  answerGivenRouting,
  baseId,
  behavior,
  cost,
  expectationFor,
  failureAccounting,
  multiSource,
  passes,
  provenance,
  retries,
  routingPatternOf,
  shapeOf,
  sourceSelection,
  toolSelection,
  unnecessarySearches,
  variantOf,
  type Expectations,
} from "@/evals/analysis/metrics";
import { KNOWN_ISSUES } from "@/evals/analysis/register";
import { comparePasses, summarizeCase } from "@/evals/analysis/repeat";
import { analysisSummary } from "@/evals/analysis/summary";
import { THRESHOLDS, TBD } from "@/evals/analysis/thresholds";
import { normalize, type NormalCase } from "@/evals/report";
import type { RunRecord } from "@/evals/types";

// -- Fixtures ---------------------------------------------------------------------

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

const failed = (categories: RunRecord["failure_categories"], overrides: Partial<RunRecord> = {}) =>
  record({ grade: { pass: false, reason: "failed" }, failure_categories: categories, ...overrides });

const usage = (calls = 2, input = 200, output = 20) => ({ agent: { calls, input_tokens: input, output_tokens: output }, judge: {} });

function kase(id: string, family: string, runs: RunRecord[], detailed = true, judge = { requests: 0, input_tokens: 0, output_tokens: 0 }): NormalCase {
  const agent = {
    requests: runs.reduce((n, run) => n + run.requests, 0),
    input_tokens: runs.reduce((n, run) => n + run.input_tokens, 0),
    output_tokens: runs.reduce((n, run) => n + run.output_tokens, 0),
  };
  return {
    id,
    family,
    scheduled: runs.length,
    runs,
    detailed,
    usage: { requests: agent.requests + judge.requests, input_tokens: agent.input_tokens + judge.input_tokens, output_tokens: agent.output_tokens + judge.output_tokens },
    agentUsage: agent,
    judgeUsage: judge,
    duration_ms: runs.reduce((n, run) => n + run.duration_ms, 0),
  };
}

const EXPECT: Expectations = new Map([
  ["needs-library", { required: ["lib:Contracts"], allowed: ["db:Sales"] }],
  ["needs-both", { required: ["db:Sales", "lib:Contracts"], allowed: [] }],
  ["needs-two-libraries", { required: ["lib:Contracts", "lib:Compliance"], allowed: [] }],
  ["needs-database", { required: ["db:Sales"], allowed: [] }],
  ["needs-nothing", { required: [], allowed: [] }],
]);

/** A report as the eval runner writes it, from cases built above. */
function reportJson(cases: NormalCase[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema: 2,
    label: "synthetic",
    ranAt: "2026-09-21T10:00:00.000Z",
    model: "test-model",
    repeat: 10,
    suite: ["media"],
    options: { with_library: false, max_rpm: 40, variant: null },
    env: { commit: "46ee7ffaaaaaaaa", branch: "media-connections", model_endpoint: "model.test" },
    duration_ms: 1000,
    usage_total: { agent: {}, judge: {} },
    cases: cases.map((c) => ({
      id: c.id,
      family: c.family,
      scheduled: c.scheduled,
      valid: c.runs.filter((run) => run.status === "valid").length,
      passRate: 0,
      results: [],
      runs: c.runs,
      duration_ms: c.duration_ms,
      usage: { agent: { calls: c.usage.requests, input_tokens: c.usage.input_tokens, output_tokens: c.usage.output_tokens }, judge: {} },
    })),
    ...extra,
  });
}

/** An A0-shaped report: a pass rate and grade results per case, and nothing about individual runs. */
function a0Json(): string {
  return JSON.stringify({
    ranAt: "2026-09-21T07:12:38.918Z",
    model: "syslab-default",
    label: "baseline",
    repeat: 3,
    env: { commit: "aac16b2aaaaaaaa" },
    duration_ms: 1000,
    usage_total: { agent: {}, judge: {} },
    cases: [
      {
        id: "between-boundary",
        description: "x",
        passRate: 2 / 3,
        results: [{ pass: true, reason: "a" }, { pass: true, reason: "b" }, { pass: false, reason: "c" }],
        duration_ms: 900,
        usage: usage(),
      },
    ],
  });
}

function results(files: Partial<Record<Role, string>>, manifest: ManifestEntry[] = DEFAULT_MANIFEST) {
  const byPath = new Map(manifest.filter((entry) => files[entry.role] !== undefined).map((entry) => [entry.path, files[entry.role]!]));
  return loadResults(manifest, (file) => byPath.get(file) ?? null);
}

const NOW = "2026-09-21T17:00:00.000Z";

// -- The loader ---------------------------------------------------------------------

describe("loading results", () => {
  test("a file that does not exist is pending, and nothing is invented for it", () => {
    const loaded = results({});
    for (const entry of DEFAULT_MANIFEST) {
      const result = loaded.get(entry.role)!;
      assert.equal(result.state, "pending");
      assert.deepEqual(result.cases, []);
      assert.equal(result.meta, null);
    }
  });

  test("a file that is not a complete report is unreadable, not pending and not loaded", () => {
    const loaded = results({ media_pass_1: "{ this is half written", media_pass_2: JSON.stringify({ no: "cases" }) });
    assert.equal(loaded.get("media_pass_1")!.state, "unreadable");
    assert.equal(loaded.get("media_pass_2")!.state, "unreadable");
  });

  test("a report loads with its provenance: commit, model, when, and how many runs were valid", () => {
    const loaded = results({ media_pass_1: reportJson([kase("a", "media-only", [record(), record(), record({ status: "rate_limited", grade: null })])]) });
    const meta = loaded.get("media_pass_1")!.meta!;
    assert.equal(meta.commit, "46ee7ffaaaaaaaa");
    assert.equal(meta.model, "test-model");
    assert.equal(meta.scheduled, 3);
    assert.equal(meta.valid, 2);
    assert.deepEqual(meta.suite, ["media"]);
  });

  test("the A0 baseline loads in its own, older shape, and is marked as having no run detail", () => {
    const loaded = results({ baseline_a0: a0Json() });
    const [only] = loaded.get("baseline_a0")!.cases;
    assert.equal(only.detailed, false);
    assert.equal(only.runs.length, 3);
  });
});

// -- Metrics ------------------------------------------------------------------------

describe("only valid runs count", () => {
  const cases = [
    kase("a", "media-only", [
      record(),
      failed(["routing"]),
      record({ status: "rate_limited", grade: null, tools: [] }),
      record({ status: "infrastructure", grade: null, tools: [] }),
      record({ status: "execution_failure", grade: null, tools: [] }),
    ]),
  ];

  test("a run that never reached the model is in no rate", () => {
    assert.deepEqual(passes(cases), { k: 1, n: 2 });
    assert.equal(cost(cases).validRuns, 2);
  });

  test("but it is in the accounting, apart from the model's runs", () => {
    const a = failureAccounting(cases);
    assert.equal(a.scheduled, 5);
    assert.equal(a.valid, 2);
    assert.equal(a.rateLimited, 1);
    assert.equal(a.infrastructure, 1);
    assert.equal(a.executionFailure, 1);
  });
});

describe("tool selection: the right kind of tool", () => {
  test("a needed kind, and allowed ones, are correct; a missing or unexpected kind is not", () => {
    const cases = [
      kase("needs-library", "media-only", [
        record({ tools: ["search_documents"] }), //  correct
        record({ tools: ["search_documents", "run_sql"] }), //  correct: the database is allowed
        record({ tools: [] }), //  missing search
        record({ tools: ["run_sql"] }), //  missing search
      ]),
    ];
    const t = toolSelection(cases, EXPECT);
    assert.equal(t.evaluated, 4);
    assert.equal(t.correct, 2);
    assert.equal(t.missingKind.search, 2);
    assert.equal(t.unexpectedKind.sql, 0, "sql is allowed for this case, so it is not unexpected");
    assert.deepEqual([t.shapes.search, t.shapes["sql+search"], t.shapes.none, t.shapes.sql], [1, 1, 1, 1]);
  });

  test("a case that needs nothing is right to use nothing, and wrong to use a tool", () => {
    const cases = [kase("needs-nothing", "ambiguous-material", [record({ tools: [], ended_in_question: true }), record({ tools: ["search_documents"] })])];
    const t = toolSelection(cases, EXPECT);
    assert.equal(t.correct, 1);
    assert.equal(t.unexpectedKind.search, 1);
    assert.equal(t.shapes.asked, 1);
  });

  test("a case with no declared expectation is counted, not judged", () => {
    const t = toolSelection([kase("unknown-case", "x", [record(), record()])], EXPECT);
    assert.equal(t.noExpectation, 2);
    assert.equal(t.evaluated, 0);
  });

  test("a result with no run detail is left out and said to be, never read as runs that did nothing", () => {
    const a0 = normalize(JSON.parse(a0Json()));
    const t = toolSelection(a0, EXPECT);
    assert.equal(t.runs, 0);
    assert.equal(t.evaluated, 0);
    assert.equal(t.withoutDetail, 3);
    assert.deepEqual(sourceSelection(a0), { evaluated: 0, exact: 0, missing: { library: 0, database: 0 }, unnecessary: { library: 0, database: 0 } });
    assert.equal(provenance(a0).runsWithDocuments, 0);
  });

  test("a control is not expected to use what it removed", () => {
    assert.equal(baseId("needs-both@no-database"), "needs-both");
    assert.equal(variantOf("needs-both@no-database"), "no-database");
    assert.equal(variantOf("needs-both"), null);
    assert.deepEqual(expectationFor(EXPECT, "needs-both@no-database"), { required: ["lib:Contracts"], allowed: [] });
    assert.deepEqual(expectationFor(EXPECT, "needs-both@no-library"), { required: ["db:Sales"], allowed: [] });
    assert.deepEqual(expectationFor(EXPECT, "needs-both@only-relevant-library"), EXPECT.get("needs-both"));
    assert.equal(expectationFor(EXPECT, "nothing@no-library"), null);
  });

  test("shapes: what the run did, from its tools", () => {
    assert.equal(shapeOf(record({ tools: ["run_sql", "run_sql"] })), "sql");
    assert.equal(shapeOf(record({ tools: ["run_sql", "search_documents"] })), "sql+search");
    assert.equal(shapeOf(record({ tools: [], ended_in_question: true })), "asked");
    assert.equal(shapeOf(record({ tools: [] })), "none");
    assert.equal(shapeOf(record({ tools: ["generate_esg_report"] })), "none", "a tool that is neither is not counted as either");
  });
});

describe("source selection and multi-source", () => {
  test("missing and unnecessary sources, by library and by database, from the run's own lists", () => {
    const cases = [
      kase("needs-library", "media-only", [
        record({ missing_sources: [], unnecessary_sources: [] }),
        record({ missing_sources: ["lib:Contracts"], unnecessary_sources: [] }),
        record({ missing_sources: [], unnecessary_sources: ["lib:HR Policies", "db:Sales"] }),
        record({ missing_sources: null, unnecessary_sources: null }),
      ]),
    ];
    const s = sourceSelection(cases);
    assert.equal(s.evaluated, 3, "a run with no expectation is not evaluated");
    assert.equal(s.exact, 1);
    assert.equal(s.missing.library, 1);
    assert.equal(s.unnecessary.library, 1);
    assert.equal(s.unnecessary.database, 1);
  });

  test("a question that needs two sources: all used, some, or none", () => {
    const cases = [
      kase("needs-two-libraries", "multi-library", [
        record({ missing_sources: [] }),
        record({ missing_sources: ["lib:Compliance"] }),
        record({ missing_sources: ["lib:Contracts", "lib:Compliance"] }),
      ]),
      kase("needs-library", "media-only", [record({ missing_sources: [] })]),
    ];
    assert.deepEqual(multiSource(cases, EXPECT), { evaluated: 3, all: 1, partial: 1, none: 1 });
  });
});

describe("ambiguity, unnecessary searches, provenance, retries", () => {
  test("behavior is described: which tools, and whether it ended in a question", () => {
    const cases = [
      kase("needs-nothing", "ambiguous-material", [
        record({ tools: [], ended_in_question: true }),
        record({ tools: ["search_documents"], ended_in_question: true }),
        record({ tools: ["run_sql"] }),
      ]),
    ];
    const b = behavior(cases);
    assert.equal(b.runs, 3);
    assert.equal(b.askedWithoutTools, 1);
    assert.equal(b.endedInQuestion, 2);
    assert.equal(b.usedATool, 2);
  });

  test("searching where no library is needed, and using a library the question did not need", () => {
    const cases = [
      kase("needs-database", "efficiency", [
        record({ tools: ["run_sql"], unnecessary_sources: [] }),
        record({ tools: ["run_sql", "search_documents"], unnecessary_sources: ["lib:Contracts"] }),
      ]),
      kase("needs-library", "media-only", [record({ tools: ["search_documents"] })]),
    ];
    const u = unnecessarySearches(cases, EXPECT);
    assert.deepEqual(u.libraryNotRequired, { k: 1, n: 2 });
    assert.deepEqual(u.unnecessaryLibrary, { k: 1, n: 3 });
    assert.deepEqual(u.unnecessaryDatabase, { k: 0, n: 3 });
  });

  test("provenance: counted over runs that retrieved documents, by any failed check and by primary cause", () => {
    const cases = [
      kase("needs-library", "media-only", [
        record(),
        record({ provenance_retry: true }),
        failed(["routing", "provenance_generation"], { lines_removed: 1 }),
        failed(["provenance_sanitization", "rendering"]),
        record({ documents_retrieved: false, delivered_block: false }),
      ]),
    ];
    const p = provenance(cases);
    assert.equal(p.runsWithDocuments, 4);
    assert.equal(p.blockDelivered, 4);
    assert.equal(p.unprompted, 3);
    assert.equal(p.anyGeneration, 1);
    assert.equal(p.anySanitization, 1);
    assert.equal(p.anyRendering, 1);
    assert.equal(p.primaryGeneration, 0, "routing is the primary cause of that run, so it is not charged to provenance");
    assert.equal(p.primarySanitization, 1);
    assert.equal(p.primaryRendering, 0);
    assert.equal(p.runsWithLinesRemoved, 1);
  });

  test("retries: the corrective one over runs that retrieved documents, any other over all valid runs", () => {
    const cases = [
      kase("needs-library", "media-only", [
        record({ provenance_retry: true }),
        record(),
        record({ documents_retrieved: false, other_retry: true }),
        record({ status: "rate_limited", grade: null, provenance_retry: true }),
      ]),
    ];
    const r = retries(cases);
    assert.deepEqual(r.provenance, { k: 1, n: 2 });
    assert.deepEqual(r.other, { k: 1, n: 3 });
  });
});

describe("answer correctness, given right routing", () => {
  test("only runs that routed right are asked whether the answer was right", () => {
    const cases = [
      kase("needs-library", "media-only", [record(), failed(["answer"]), failed(["routing", "answer"]), failed(["routing"])]),
    ];
    const a = answerGivenRouting(cases);
    assert.equal(a.routedRight, 2);
    assert.equal(a.answerFailed, 1);
  });

  test("a failure in a result that did not record its kind is not assigned one", () => {
    const a0 = normalize(JSON.parse(a0Json()));
    const a = answerGivenRouting(a0);
    assert.equal(a.kindNotRecorded, 1);
    assert.equal(a.routedRight, 0);
    const accounting = failureAccounting(a0);
    assert.equal(accounting.kindNotRecorded, 1);
    assert.equal(Object.values(accounting.primary).reduce((x, y) => x + y, 0), 0, "not counted under answer or anything else");
  });
});

describe("failure accounting: one primary cause per failed run", () => {
  const cases = [
    kase("needs-library", "media-only", [
      failed(["routing", "answer", "provenance_generation"], { tools: [] }),
      failed(["provenance_generation", "rendering"]),
      failed(["rendering"]),
      failed(["answer"]),
      failed(["retrieval", "answer"]),
      record(),
    ]),
  ];

  test("the earliest link is charged, so one mistake is not counted three times", () => {
    const a = failureAccounting(cases);
    assert.equal(a.failedValid, 5);
    assert.deepEqual(a.primary, { routing: 1, retrieval: 1, provenance_generation: 1, provenance_sanitization: 0, rendering: 1, answer: 1 });
    assert.equal(Object.values(a.primary).reduce((x, y) => x + y, 0), a.failedValid);
  });

  test("the primary cause follows the chain, not the order the categories happened to be recorded in", () => {
    const shuffled = [
      kase("needs-library", "media-only", [
        failed(["answer", "routing"]),
        failed(["rendering", "provenance_generation"]),
        failed(["answer", "retrieval"]),
        failed(["rendering", "provenance_sanitization", "answer"]),
      ]),
    ];
    const a = failureAccounting(shuffled);
    assert.deepEqual(a.primary, { routing: 1, retrieval: 1, provenance_generation: 1, provenance_sanitization: 1, rendering: 0, answer: 0 });
  });

  test("routing failures are described by what the run did, first pattern wins", () => {
    assert.equal(routingPatternOf(failed(["routing"], { tools: [] })), "no tool used");
    assert.equal(routingPatternOf(failed(["routing"], { tools: [], ended_in_question: true })), "asked instead of using a tool");
    assert.equal(routingPatternOf(failed(["routing"], { tools: ["run_sql"], missing_sources: ["lib:Contracts"] })), "required source not used");
    assert.equal(routingPatternOf(failed(["routing"], { tools: ["search_documents"], unnecessary_sources: ["lib:HR"] })), "unneeded source used");
    assert.equal(routingPatternOf(failed(["routing"], { tools: ["search_documents"] })), "other routing (see the grade reason)");
    assert.equal(routingPatternOf(failed(["routing"], { tools: ["run_sql"], missing_sources: ["db:Sales"], unnecessary_sources: ["lib:X"] })), "required source not used");
  });

  test("cost: from the requests and tokens actually spent, per valid run and per request", () => {
    // Grading (judge) requests are not agent cost: counted apart, left out of every per-request figure.
    const c = cost([
      kase("a", "x", [record({ requests: 2, input_tokens: 400, output_tokens: 20 }), record({ requests: 3, input_tokens: 600, output_tokens: 40, duration_ms: 3000 })], true, {
        requests: 4,
        input_tokens: 500,
        output_tokens: 8,
      }),
    ]);
    assert.equal(c.judgeRequests, 4);
    assert.equal(c.judgeInputTokens, 500);
    assert.equal(c.validRuns, 2);
    assert.equal(c.requests, 5);
    assert.equal(c.requestsPerValidRun, 2.5);
    assert.equal(c.inputPerRequest, 200);
    assert.equal(c.outputPerRequest, 12);
    assert.equal(c.inputPerValidRun, 500);
    assert.equal(c.msPerValidRun, 2000);
  });

  test("cost of a result with no run detail is taken from the case's own totals, and of an empty one is null", () => {
    const a0 = normalize(JSON.parse(a0Json()));
    assert.equal(cost(a0).validRuns, 3);
    assert.equal(cost(a0).msPerValidRun, 300);
    assert.equal(cost([]).requestsPerValidRun, null);
  });
});

// -- Repeatability and controls -------------------------------------------------------

describe("the two media passes are compared, not averaged", () => {
  const first = [
    kase("steady", "media-only", Array.from({ length: 10 }, () => record())),
    kase("moved", "media-only", [...Array.from({ length: 6 }, () => record()), ...Array.from({ length: 4 }, () => failed(["routing"], { tools: [], documents_retrieved: false, delivered_block: false }))]),
    kase("only-first", "media-only", [record()]),
  ];
  const second = [
    kase("steady", "media-only", Array.from({ length: 10 }, () => record())),
    kase("moved", "media-only", [...Array.from({ length: 3 }, () => record()), ...Array.from({ length: 7 }, () => failed(["routing"], { tools: [], documents_retrieved: false, delivered_block: false }))]),
    kase("only-second", "media-only", [record()]),
  ];
  const rows = comparePasses(first, second);
  const row = (id: string) => rows.find((r) => r.caseId === id)!;

  test("an unchanged case is identical on every dimension", () => {
    assert.deepEqual(row("steady").differsIn, []);
    assert.equal(row("steady").passP, 1);
  });

  test("a case that moved is flagged on each dimension it moved on, with both sides kept", () => {
    const moved = row("moved");
    assert.equal(moved.first!.passed.k, 6);
    assert.equal(moved.second!.passed.k, 3);
    for (const dimension of ["pass count", "search rate", "routing", "tool pattern", "primary cause", "provenance"]) {
      assert.ok(moved.differsIn.includes(dimension), `expected a difference in ${dimension}: ${moved.differsIn.join(", ")}`);
    }
    assert.ok(moved.passP !== null && moved.passP > 0 && moved.passP < 1);
    assert.equal(moved.first!.primary.routing, 4);
    assert.equal(moved.second!.primary.routing, 7);
  });

  test("a case in only one pass is listed as missing from the other, not dropped", () => {
    assert.deepEqual(row("only-first").differsIn, ["missing from the second pass"]);
    assert.deepEqual(row("only-second").differsIn, ["missing from the first pass"]);
    assert.equal(row("only-first").second, null);
  });

  test("a case summary carries every dimension separately", () => {
    const s = summarizeCase(first[1]);
    assert.deepEqual(s.passed, { k: 6, n: 10 });
    assert.deepEqual(s.searched, { k: 6, n: 10 });
    assert.equal(s.provenance!.runsWithDocuments, 6);
    assert.deepEqual(s.retries!.provenance, { k: 0, n: 6 });
  });
});

describe("controls are paired with the case they were made from", () => {
  test("by id and variant, beside the original in both passes", () => {
    const control = [kase("moved@no-database", "media-only", [record(), failed(["routing"])])];
    const one = [kase("moved", "media-only", [record(), record()])];
    const two = [kase("moved", "media-only", [failed(["routing"]), record()])];
    const [row] = pairControls(control, one, two);
    assert.equal(row.baseId, "moved");
    assert.equal(row.variant, "no-database");
    assert.deepEqual(row.firstPass!.passed, { k: 2, n: 2 });
    assert.deepEqual(row.secondPass!.passed, { k: 1, n: 2 });
    assert.deepEqual(row.control.passed, { k: 1, n: 2 });
  });

  test("an original that is not in a pass is null, not guessed", () => {
    const [row] = pairControls([kase("x@no-library", "efficiency", [record()])], [], []);
    assert.equal(row.firstPass, null);
    assert.equal(row.secondPass, null);
  });
});

// -- Thresholds and the register --------------------------------------------------------

describe("thresholds are not invented", () => {
  test("every threshold the plan did not decide says so, exactly", () => {
    const decided = THRESHOLDS.filter((t) => t.source.startsWith("engineering plan"));
    const undecided = THRESHOLDS.filter((t) => !t.source.startsWith("engineering plan"));
    assert.ok(undecided.length > 10);
    for (const row of undecided) {
      assert.equal(row.threshold, TBD, row.id);
      assert.ok(row.source.startsWith(TBD), row.id);
    }
    assert.deepEqual(decided.map((t) => t.id), ["T03", "T04", "T13", "T15"]);
  });

  test("no row carries a percentage or a rate: what the plan decided is stated in its own terms", () => {
    for (const row of THRESHOLDS) assert.ok(!/\d+\s*%/.test(row.threshold), `${row.id}: ${row.threshold}`);
  });

  test("every row says where its observed values are", () => {
    for (const row of THRESHOLDS) assert.ok(row.observedIn.length > 0, row.id);
    assert.equal(new Set(THRESHOLDS.map((t) => t.id)).size, THRESHOLDS.length);
  });
});

describe("the register of grader and fixture issues is kept by hand", () => {
  test("each entry says what was found, what it affected, and its status", () => {
    assert.ok(KNOWN_ISSUES.length >= 3);
    for (const issue of KNOWN_ISSUES) {
      assert.match(issue.id, /^ISS-\d+$/);
      for (const field of [issue.summary, issue.effect, issue.status]) assert.ok(field.length >= 10, issue.id);
      assert.ok(issue.affects.length > 0, issue.id);
      assert.ok(["grader", "report", "expectation", "limitation"].includes(issue.kind), issue.id);
    }
    assert.equal(new Set(KNOWN_ISSUES.map((i) => i.id)).size, KNOWN_ISSUES.length);
  });
});

// -- The report ---------------------------------------------------------------------------

function fullInput() {
  const media = (pass: number) => [
    kase("needs-library", "media-only", Array.from({ length: 10 }, (_, i) => (i < 5 + pass ? record() : failed(["routing"], { tools: [], documents_retrieved: false, delivered_block: false })))),
    kase("needs-both", "cross-source", Array.from({ length: 10 }, () => record({ tools: ["run_sql", "search_documents"] }))),
  ];
  const files: Partial<Record<Role, string>> = {
    baseline_a0: a0Json(),
    legacy_database_only: reportJson([kase("between-boundary", "legacy", Array.from({ length: 3 }, () => record({ tools: ["run_sql"], documents_retrieved: false, delivered_block: false })))]),
    legacy_with_library: reportJson([kase("between-boundary", "legacy", Array.from({ length: 3 }, () => record({ tools: ["run_sql"], documents_retrieved: false, delivered_block: false })))]),
    media_pass_1: reportJson(media(0)),
    media_pass_2: reportJson(media(1)),
    live: reportJson([kase("live-a", "live", [record()])]),
    control_no_database: reportJson([kase("needs-library@no-database", "media-only", [record(), failed(["routing"], { tools: [] })])]),
    control_relevant_library: reportJson([kase("needs-library@only-relevant-library", "media-only", [record()])]),
    control_no_library: reportJson([kase("needs-database@no-library", "efficiency", [record({ tools: ["run_sql"] })])]),
  };
  return { results: results(files), expectations: EXPECT, generatedAt: NOW };
}

describe("the report", () => {
  const empty = { results: results({}), expectations: EXPECT, generatedAt: NOW };

  test("with nothing available it is all TBD, and says which results are missing", () => {
    const text = renderReport(empty);
    for (const entry of DEFAULT_MANIFEST) assert.ok(text.includes(entry.path), entry.role);
    assert.match(text, /\*\*TBD — not yet run\*\*/);
    for (const control of ["no database attached", "only the relevant libraries attached", "no library attached"]) {
      const at = text.indexOf(`### Control: ${control}`);
      assert.ok(at > 0, control);
      assert.match(text.slice(at, at + 400), /\*TBD — /, `the ${control} control must read TBD`);
    }
    assert.ok(!/\| case \| original, first pass/.test(text), "no empty control table");
  });

  test("all eleven questions are there, and each ends in an assessment nobody has filled in", () => {
    const text = renderReport(fullInput());
    for (let n = 1; n <= 11; n++) assert.match(text, new RegExp(`### Q${n}\\. `));
    assert.equal((text.match(/\*\*Assessment:\*\* TBD — requires engineering review\./g) ?? []).length, 11);
  });

  test("it never states a verdict", () => {
    for (const input of [empty, fullInput()]) {
      const text = renderReport(input);
      assert.ok(!/\bA3 (passes|passed|fails|failed)\b/i.test(text));
      assert.ok(!/\b(PASS|FAIL|PASSED|FAILED)\b/.test(text), "no verdict words in capitals");
      assert.ok(!/\b(meets|does not meet|exceeds|falls short of) (the )?threshold/i.test(text));
      assert.ok(!/\b(regression|acceptable|unacceptable|recommend)/i.test(text.replace(/Grader, fixture[^\n]*/g, "")), "no judgment words outside the register");
    }
  });

  test("the same input always gives the same report", () => {
    assert.equal(renderReport(fullInput()), renderReport(fullInput()));
  });

  test("with the controls present they show data and stop saying TBD", () => {
    const text = renderReport(fullInput());
    const at = text.indexOf("### Control: no database attached");
    const section = text.slice(at, text.indexOf("### Control: only the relevant"));
    assert.ok(!/\*TBD — /.test(section));
    assert.match(section, /needs-library/);
  });

  test("repeatability shows both passes side by side and pools nothing", () => {
    const text = renderReport(fullInput());
    const section = text.slice(text.indexOf("## Repeatability"), text.indexOf("## Controls"));
    assert.match(section, /passed \(1 vs 2\)/);
    assert.match(section, /needs-library \| 5\/10  vs  6\/10/);
    assert.ok(!/pooled|average|combined|overall/i.test(section));
  });

  test("repeatability is TBD when a pass is missing", () => {
    const text = renderReport({ ...empty, results: results({ media_pass_1: reportJson([kase("needs-library", "media-only", [record()])]) }) });
    const section = text.slice(text.indexOf("## Repeatability"), text.indexOf("## Controls"));
    assert.match(section, /\*TBD — needs both passes/);
  });

  test("a result with no run detail shows a dash, not a zero, where the detail would be", () => {
    const text = renderReport({ ...empty, results: results({ baseline_a0: a0Json() }) });
    const row = text.split("\n").find((line) => line.startsWith("| between-boundary"))!;
    assert.ok(row, "the A0 case is in the appendix");
    assert.match(row, /\| 2\/3 \(67%\) \| — \| — \| — \|/, row);
  });

  test("the Tier A section is TBD without a result and shows the totals with one", () => {
    assert.match(renderReport(empty), /no Tier A result was supplied/);
    const withTier = renderReport({ ...empty, tierA: { command: "npm test", ranAt: NOW, tests: 900, passed: 895, failed: 0, skipped: 5 } });
    assert.match(withTier, /`npm test` at .*: 900 tests, 895 passed, 0 failed, 5 skipped\./);
    assert.ok(!/no Tier A result was supplied/.test(withTier));
  });

  test("the threshold table and the register are in it", () => {
    const text = renderReport(empty);
    for (const row of THRESHOLDS) assert.ok(text.includes(row.id), row.id);
    for (const issue of KNOWN_ISSUES) assert.ok(text.includes(issue.id), issue.id);
    assert.match(text, /TBD \/ requires engineering decision/);
  });

  test("building the report does not change what it was given", () => {
    const input = fullInput();
    const before = JSON.stringify([...input.results.entries()]);
    renderReport(input);
    analysisSummary(input.results, input.expectations, NOW);
    assert.equal(JSON.stringify([...input.results.entries()]), before);
  });
});

describe("the summary is the same measurements as data", () => {
  test("loaded results carry their measurements, pending ones say so, and the repeat and controls follow", () => {
    const input = fullInput();
    const summary = analysisSummary(input.results, input.expectations, NOW) as unknown as {
      generatedAt: string;
      roles: Record<string, { state: string; passes?: { k: number; n: number } }>;
      repeat: unknown[] | null;
      controls: Record<string, unknown[] | null>;
    };
    assert.equal(summary.generatedAt, NOW);
    assert.equal(summary.roles.media_pass_1.state, "loaded");
    assert.deepEqual(summary.roles.media_pass_1.passes, { k: 15, n: 20 });
    assert.equal(summary.repeat!.length, 2);
    assert.equal(summary.controls.control_no_database!.length, 1);

    const nothing = analysisSummary(results({}), EXPECT, NOW) as unknown as { roles: Record<string, { state: string }>; repeat: unknown; controls: Record<string, unknown> };
    assert.equal(nothing.roles.media_pass_1.state, "pending");
    assert.equal(nothing.repeat, null);
    assert.equal(nothing.controls.control_no_database, null);
  });
});

describe("the analysis only reads", () => {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "evals");
  const analysis = readdirSync(path.join(dir, "analysis")).filter((file) => file.endsWith(".ts"));

  test("no analysis module writes, deletes or renames a file", () => {
    assert.ok(analysis.length >= 7);
    for (const file of analysis) {
      const source = readFileSync(path.join(dir, "analysis", file), "utf8");
      assert.ok(!/writeFile|appendFile|unlink|rmSync|renameSync|copyFile|createWriteStream/.test(source), file);
    }
  });

  test("the command line writes only where it is told to, and never to a result", () => {
    const source = readFileSync(path.join(dir, "analyze.ts"), "utf8");
    const writes = source.match(/writeFileSync\([^)]*\)/g) ?? [];
    assert.equal(writes.length, 2);
    for (const write of writes) assert.match(write, /path\.resolve\(root, (out|json)\)/);
    assert.ok(!/baseline/.test(source.replace(/\/\*[\s\S]*?\*\//g, "")), "it never names the baseline itself");
  });

  test("nothing in the analysis imports the agent, the prompts or the graders", () => {
    for (const file of analysis) {
      const source = readFileSync(path.join(dir, "analysis", file), "utf8");
      assert.ok(!/from "@\/lib\//.test(source) && !/from "\.\.\/(grade|grade-media|harness|libraries|media-fixtures)"/.test(source), file);
    }
  });
});
