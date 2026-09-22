/**
 * The A3 report, as Markdown, from a set of result files.
 *
 * It contains measurements and nothing else. Each of the eleven questions has a
 * section that shows the evidence bearing on it and ends with an assessment line
 * that this code never fills in: whether a result answers a question well enough
 * is a decision, and the report exists so the decision is made from complete
 * numbers. A section whose results do not exist yet says TBD; it never shows an
 * empty table that could be read as a result.
 *
 * The output is a pure function of its input, including the timestamp, so the
 * same result files always produce the same report.
 */

import { fisherExact, wilson } from "../stats";
import type { NormalCase } from "../report";

import { pairControls } from "./controls";
import { isLoaded, type Loaded, type Role } from "./manifest";
import {
  cost,
  failureAccounting,
  frac,
  multiSource,
  passes,
  provenance,
  retries,
  sourceSelection,
  toolSelection,
  unnecessarySearches,
  type Expectations,
  type Frac,
} from "./metrics";
import { comparePasses, summarizeCase, type CaseSummary } from "./repeat";
import { KNOWN_ISSUES, type Issue } from "./register";
import { THRESHOLDS } from "./thresholds";

export type TierA = { command: string; ranAt: string; tests: number; passed: number; failed: number; skipped: number };

export type AnalysisInput = {
  results: Map<Role, Loaded>;
  expectations: Expectations;
  issues?: Issue[];
  tierA?: TierA | null;
  generatedAt: string;
};

const ASSESSMENT = "**Assessment:** TBD — requires engineering review.";

const pct = (f: Frac) => (f.n === 0 ? "n/a" : `${Math.round((f.k / f.n) * 100)}%`);
const cell = (f: Frac | null | undefined) => (f === null || f === undefined ? "—" : f.n === 0 ? "n/a" : `${f.k}/${f.n} (${pct(f)})`);
const interval = (f: Frac) => {
  if (f.n === 0) return "";
  const { low, high } = wilson(f.k, f.n);
  return ` ${Math.round(low * 100)}–${Math.round(high * 100)}%`;
};
const number = (value: number | null, digits = 0) => (value === null ? "—" : value.toFixed(digits));

function table(headers: string[], rows: string[][]): string[] {
  const line = (cells: string[]) => `| ${cells.map((c) => c.replace(/\|/g, "\\|")).join(" | ")} |`;
  return [line(headers), line(headers.map(() => "---")), ...rows.map(line), ""];
}

const tbd = (what: string) => [`*TBD — ${what}.*`, ""];

function casesOf(input: AnalysisInput, role: Role): NormalCase[] | null {
  const result = input.results.get(role);
  return isLoaded(result) ? result.cases : null;
}

function pending(input: AnalysisInput, roles: Role[]): string[] {
  return roles
    .filter((role) => !isLoaded(input.results.get(role)))
    .map((role) => {
      const entry = input.results.get(role);
      return `${entry?.entry.title ?? role} (${entry?.state ?? "not in the manifest"})`;
    });
}

const PRIMARY_LABELS: Record<string, string> = {
  routing: "routing",
  retrieval: "retrieval",
  provenance_generation: "provenance (generation)",
  provenance_sanitization: "provenance (sanitization)",
  rendering: "rendering",
  answer: "answer",
};

function causes(summary: CaseSummary): string {
  const parts = Object.entries(summary.primary)
    .filter(([, count]) => count > 0)
    .map(([category, count]) => `${PRIMARY_LABELS[category]} ${count}`);
  if (summary.kindNotRecorded > 0) parts.push(`kind not recorded ${summary.kindNotRecorded}`);
  return parts.join(", ") || "—";
}

function shapes(summary: CaseSummary): string {
  if (!summary.shapes) return "—";
  return (
    Object.entries(summary.shapes)
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([shape, count]) => `${shape} ×${count}`)
      .join(", ") || "—"
  );
}

/** One row per case: what happened, in the dimensions that stay separate. */
function caseTable(cases: NormalCase[], expectations: Expectations, families?: string[]): string[] {
  const chosen = families ? cases.filter((kase) => families.includes(kase.family)) : cases;
  if (chosen.length === 0) return tbd("no cases of this kind in the result");
  const rows = chosen.map((kase) => {
    const summary = summarizeCase(kase);
    const tool = toolSelection([kase], expectations);
    const sources = sourceSelection([kase]);
    return [
      kase.id,
      `${summary.valid}${summary.notMeasured ? ` (+${summary.notMeasured} not measured)` : ""}`,
      cell(summary.passed),
      cell(summary.searched),
      tool.evaluated ? cell(frac(tool.correct, tool.evaluated)) : "—",
      sources.evaluated ? cell(frac(sources.exact, sources.evaluated)) : "—",
      causes(summary),
      shapes(summary),
    ];
  });
  return table(["case", "valid runs", "passed", "searched", "right kind of tool", "sources exact", "failed by primary cause", "tools used"], rows);
}

const MEDIA_ROLES: { role: Role; label: string }[] = [
  { role: "media_pass_1", label: "First pass" },
  { role: "media_pass_2", label: "Second pass" },
];

/** A section that shows the same case table for each result that bears on it. */
function perResult(
  input: AnalysisInput,
  roles: { role: Role; label: string }[],
  families: string[] | undefined,
  extra?: (cases: NormalCase[]) => string[]
): string[] {
  const out: string[] = [];
  for (const { role, label } of roles) {
    const cases = casesOf(input, role);
    out.push(`#### ${label}`, "");
    if (!cases) {
      out.push(...tbd(`${input.results.get(role)?.entry.title ?? role} is ${input.results.get(role)?.state ?? "not in the manifest"}`));
      continue;
    }
    out.push(...caseTable(cases, input.expectations, families));
    if (extra) out.push(...extra(families ? cases.filter((kase) => families.includes(kase.family)) : cases));
  }
  return out;
}

function results(input: AnalysisInput): string[] {
  const rows = [...input.results.values()].map((r) => [
    r.entry.role,
    r.entry.title,
    r.state === "loaded" ? "loaded" : r.state === "pending" ? "**TBD — not yet run**" : "**TBD — not readable yet**",
    r.entry.path,
    r.meta ? `${r.meta.commit?.slice(0, 7) ?? "?"}` : "—",
    r.meta ? r.meta.model : "—",
    r.meta ? r.meta.ranAt.slice(0, 19).replace("T", " ") : "—",
    r.meta ? `${r.meta.scheduled} / ${r.meta.valid}` : "—",
  ]);
  const notes = [...input.results.values()].filter((r) => r.entry.note).map((r) => `- **${r.entry.role}:** ${r.entry.note}`);
  return [
    ...table(["role", "result", "state", "file", "commit", "model", "ran at (UTC)", "scheduled / valid"], rows),
    ...(notes.length ? ["Notes on how results were produced:", "", ...notes, ""] : []),
  ];
}

// -- The questions --------------------------------------------------------------

function q1(input: AnalysisInput): string[] {
  const a0 = casesOf(input, "baseline_a0");
  const dbOnly = casesOf(input, "legacy_database_only");
  const withLibrary = casesOf(input, "legacy_with_library");
  const missing = pending(input, ["baseline_a0", "legacy_database_only", "legacy_with_library"]);
  const out = ["**What we need to know:** does adding libraries change SQL behavior, compared with A0.", ""];
  if (missing.length) out.push(`Pending: ${missing.join("; ")}.`, "");
  if (!a0) return [...out, ...tbd("the A0 baseline is needed for this comparison"), ASSESSMENT, ""];

  const legacyOf = (cases: NormalCase[] | null) => new Map((cases ?? []).filter((kase) => kase.family === "legacy").map((kase) => [kase.id, kase]));
  const base = legacyOf(a0);
  const db = legacyOf(dbOnly);
  const lib = legacyOf(withLibrary);

  const rows = [...base.keys()].map((id) => {
    const s0 = summarizeCase(base.get(id)!);
    const s1 = db.has(id) ? summarizeCase(db.get(id)!) : null;
    const s2 = lib.has(id) ? summarizeCase(lib.get(id)!) : null;
    const p = (s: CaseSummary | null) => (s && s.valid > 0 && s0.valid > 0 ? fisherExact({ pass: s0.passed.k, n: s0.passed.n }, { pass: s.passed.k, n: s.passed.n }).toFixed(2) : "—");
    return [id, cell(s0.passed), cell(s1?.passed), p(s1), cell(s2?.passed), p(s2), s2?.searched ? cell(s2.searched) : "—"];
  });
  out.push(...table(["case", "A0", "A2/A2b, database only", "p vs A0", "database + library", "p vs A0", "searched the attached library"], rows));

  const totals = (cases: NormalCase[] | null) => (cases ? passes(cases.filter((kase) => kase.family === "legacy")) : null);
  const t0 = totals(a0)!;
  const t1 = totals(dbOnly);
  const t2 = totals(withLibrary);
  const pAll = (t: Frac | null) => (t && t.n > 0 ? fisherExact({ pass: t0.k, n: t0.n }, { pass: t.k, n: t.n }).toFixed(2) : "—");
  out.push(
    ...table(
      ["all original cases", "A0", "database only", "p vs A0", "database + library", "p vs A0"],
      [[`valid runs passed`, cell(t0) + interval(t0), t1 ? cell(t1) + interval(t1) : "TBD", pAll(t1), t2 ? cell(t2) + interval(t2) : "TBD", pAll(t2)]]
    )
  );
  if (withLibrary) {
    const u = unnecessarySearches(withLibrary, input.expectations);
    out.push(`With a library attached, runs that used a library the question did not need: ${cell(u.unnecessaryLibrary)}.`, "");
  }
  const naming = [
    ["A0", a0],
    ["database only", dbOnly],
    ["database + library", withLibrary],
  ] as const;
  out.push(
    "The existing case `naming-multi-connection-ambiguous` (threshold T03):",
    "",
    ...table(
      ["result", "passed"],
      naming.map(([label, cases]) => {
        const kase = cases?.find((c) => c.id === "naming-multi-connection-ambiguous");
        return [label, kase ? cell(summarizeCase(kase).passed) : "TBD"];
      })
    )
  );
  return [...out, ASSESSMENT, ""];
}

function q2(input: AnalysisInput): string[] {
  const out = ["**What we need to know:** does document routing remain reliable across the real-model matrix.", ""];
  out.push("Families: media-only and vague requests, fixture libraries; then a real syslab-server tenant.", "");
  out.push(...perResult(input, MEDIA_ROLES, ["media-only", "vague"]));
  out.push("#### Live retrieval", "");
  const live = casesOf(input, "live");
  out.push(...(live ? caseTable(live, input.expectations) : tbd("the live run is not available")));
  return [...out, ASSESSMENT, ""];
}

function q3(input: AnalysisInput): string[] {
  const out = ["**What we need to know:** does cross-source routing work: PostgreSQL and a document library in one question.", ""];
  out.push(
    ...perResult(input, MEDIA_ROLES, ["cross-source"], (cases) => {
      const m = multiSource(cases, input.expectations);
      return [`Runs needing more than one source: ${m.evaluated}; all used ${m.all}, some but not all ${m.partial}, none ${m.none}.`, ""];
    })
  );
  return [...out, ASSESSMENT, ""];
}

function q4(input: AnalysisInput): string[] {
  const out = ["**What we need to know:** does multi-library selection work: the relevant library searched, without unnecessary searches.", ""];
  out.push(
    ...perResult(input, MEDIA_ROLES, ["multi-library"], (cases) => {
      const s = sourceSelection(cases);
      const m = multiSource(cases, input.expectations);
      return [
        `Runs with a source expectation: ${s.evaluated}; required library not used ${s.missing.library}, an unneeded library also searched ${s.unnecessary.library}.`,
        `Of the runs that needed more than one source: all used ${m.all}, some but not all ${m.partial}, none ${m.none} (of ${m.evaluated}).`,
        "",
      ];
    })
  );
  return [...out, ASSESSMENT, ""];
}

function q5(input: AnalysisInput): string[] {
  const out = ["**What we need to know:** does ambiguity handling work, for low-risk questions and materially consequential ones. Behavior is described here, not judged.", ""];
  out.push(...perResult(input, MEDIA_ROLES, ["ambiguous-low-risk", "ambiguous-insufficient", "ambiguous-material"]));
  return [...out, ASSESSMENT, ""];
}

function provenanceRows(input: AnalysisInput): string[][] {
  const roles: { role: Role; label: string }[] = [...MEDIA_ROLES, { role: "live", label: "Live retrieval" }];
  return roles.map(({ role, label }) => {
    const cases = casesOf(input, role);
    if (!cases) return [label, "TBD", "", "", "", "", "", ""];
    const p = provenance(cases);
    const docs = p.runsWithDocuments;
    return [
      label,
      String(docs),
      cell(frac(p.blockDelivered, docs)) + interval(frac(p.blockDelivered, docs)),
      cell(frac(p.unprompted, docs)),
      `${p.anyGeneration} / ${p.anySanitization} / ${p.anyRendering}`,
      `${p.primaryGeneration} / ${p.primarySanitization} / ${p.primaryRendering}`,
      String(p.runsWithLinesRemoved),
      "",
    ];
  });
}

function q6(input: AnalysisInput): string[] {
  const out = ["**What we need to know:** does provenance survive repeated runs: how often the delivered answer ends with a valid Sources block, and whether anything unbacked reaches the reader.", ""];
  out.push(
    ...table(
      ["result", "runs that retrieved documents", "delivered answer ends with a block", "block written unprompted", "failed a check (generation / sanitization / rendering)", "as primary cause", "runs with lines removed by the check", ""],
      provenanceRows(input)
    )
  );
  out.push("Failures are counted twice on purpose: under every check a run failed, and as the primary cause only. See ISS-01 for a first-pass counting issue.", "");
  return [...out, ASSESSMENT, ""];
}

function q7(input: AnalysisInput): string[] {
  const out = ["**What we need to know:** does the corrective retry remain rare, and how often do the loop's existing backstops retry.", ""];
  const roles: { role: Role; label: string }[] = [...MEDIA_ROLES, { role: "live", label: "Live retrieval" }, { role: "legacy_with_library", label: "Original cases, library attached" }];
  const rows = roles.map(({ role, label }) => {
    const cases = casesOf(input, role);
    if (!cases) return [label, "TBD", "TBD"];
    const r = retries(cases);
    return [label, cell(r.provenance) + interval(r.provenance), cell(r.other) + interval(r.other)];
  });
  out.push(...table(["result", "corrective retry for a missing Sources block (of runs that retrieved documents)", "any other retry (of valid runs)"], rows));
  return [...out, ASSESSMENT, ""];
}

function q8(input: AnalysisInput): string[] {
  const out = ["**What we need to know:** does SQL-only behavior remain unchanged, with no unnecessary document searches.", ""];
  out.push(
    ...perResult(input, MEDIA_ROLES, ["postgres-only", "efficiency"], (cases) => {
      const u = unnecessarySearches(cases, input.expectations);
      return [`Searched a library although the case needs none: ${cell(u.libraryNotRequired)}.`, ""];
    })
  );
  out.push("The original cases against A0 are in Q1.", "");
  return [...out, ASSESSMENT, ""];
}

function q9(input: AnalysisInput): string[] {
  const out = ["**What we need to know:** does unauthorized access remain impossible. This is a Tier A (deterministic) guarantee; the Tier B cases below only show what the model does at that boundary.", ""];
  out.push("#### Tier A: authorization and isolation tests", "");
  if (input.tierA) {
    const t = input.tierA;
    out.push(`\`${t.command}\` at ${t.ranAt}: ${t.tests} tests, ${t.passed} passed, ${t.failed} failed, ${t.skipped} skipped.`, "");
  } else {
    out.push(...tbd("no Tier A result was supplied (run `npm test` and pass its totals with --tier-a)"));
  }
  out.push("#### Tier B: the model at the boundary", "");
  out.push(...perResult(input, MEDIA_ROLES, ["unauthorized"]));
  return [...out, ASSESSMENT, ""];
}

function q10(input: AnalysisInput): string[] {
  const roles: Role[] = [
    "baseline_a0", "legacy_database_only", "legacy_with_library", "media_pass_1", "media_pass_2", "live",
    "control_no_database", "control_relevant_library", "control_no_library",
  ];
  const rows = roles.map((role) => {
    const result = input.results.get(role);
    if (!result || result.state !== "loaded") return [result?.entry.title ?? role, "TBD", "", "", "", "", "", ""];
    const c = cost(result.cases);
    return [
      result.entry.title,
      String(c.validRuns),
      number(c.requestsPerValidRun, 2),
      number(c.inputPerRequest),
      number(c.outputPerRequest),
      number(c.inputPerValidRun),
      number(c.msPerValidRun !== null ? c.msPerValidRun / 1000 : null, 1),
      `${c.requests} (${c.rateLimitedRequests} answered 429; ${c.judgeRequests} more for grading)`,
    ];
  });
  return [
    "**What we need to know:** requests, tokens and wall time of the agent. Requests include those for runs that were retried or never measured; grading (LLM-judge) requests are not agent cost and are counted apart; wall time includes any wait after a rate limit and any grading.",
    "",
    ...table(["result", "valid runs", "requests per valid run", "input tokens per request", "output tokens per request", "input tokens per valid run", "seconds per valid run", "agent requests sent"], rows),
    ASSESSMENT,
    "",
  ];
}

function q11(input: AnalysisInput): string[] {
  const roles: Role[] = [
    "baseline_a0", "legacy_database_only", "legacy_with_library", "media_pass_1", "media_pass_2", "live",
    "control_no_database", "control_relevant_library", "control_no_library",
  ];
  const statusRows: string[][] = [];
  const causeRows: string[][] = [];
  const patternRows: string[][] = [];
  for (const role of roles) {
    const result = input.results.get(role);
    if (!result || result.state !== "loaded") {
      statusRows.push([result?.entry.title ?? role, "TBD", "", "", "", "", ""]);
      continue;
    }
    const a = failureAccounting(result.cases);
    statusRows.push([result.entry.title, String(a.scheduled), String(a.valid), String(a.rateLimited), String(a.infrastructure), String(a.executionFailure), `${a.attempts} / ${a.rateLimitedRequests}`]);
    const p = a.primary;
    causeRows.push([result.entry.title, String(a.failedValid), String(p.routing), String(p.retrieval), String(p.provenance_generation), String(p.provenance_sanitization), String(p.rendering), String(p.answer), String(a.kindNotRecorded)]);
    const r = a.routingPatterns;
    patternRows.push([result.entry.title, String(p.routing), String(r["no tool used"]), String(r["asked instead of using a tool"]), String(r["required source not used"]), String(r["unneeded source used"]), String(r["other routing (see the grade reason)"])]);
  }
  return [
    "**What we need to know:** which failures are the model's. Runs that never reached the model are reported apart from every rate, and each failed run has one primary cause.",
    "",
    "#### How every scheduled run ended",
    "",
    ...table(["result", "scheduled", "valid (the model's)", "rate limited", "infrastructure", "other failure", "attempts / requests answered 429"], statusRows),
    "#### Failed valid runs by primary cause",
    "",
    ...table(["result", "failed valid runs", "routing", "retrieval", "provenance (generation)", "provenance (sanitization)", "rendering", "answer", "kind not recorded (A0)"], causeRows),
    "Routing failures by what the run did. These describe observed behavior and are not causes; one pattern each, first match wins.",
    "",
    ...table(["result", "routing failures", "no tool used", "asked instead of using a tool", "required source not used", "unneeded source used", "other"], patternRows),
    "Grader, fixture and expectation issues are not inferred from results. They are kept in the register at the end of this report.",
    "",
    ASSESSMENT,
    "",
  ];
}

const QUESTIONS: { title: string; build: (input: AnalysisInput) => string[] }[] = [
  { title: "Q1. Does adding libraries change SQL behavior?", build: q1 },
  { title: "Q2. Does document routing remain reliable?", build: q2 },
  { title: "Q3. Does cross-source routing work?", build: q3 },
  { title: "Q4. Does multi-library selection work?", build: q4 },
  { title: "Q5. Does ambiguity handling work?", build: q5 },
  { title: "Q6. Does provenance survive repeated runs?", build: q6 },
  { title: "Q7. Does the corrective retry remain rare?", build: q7 },
  { title: "Q8. Does SQL-only behavior remain unchanged?", build: q8 },
  { title: "Q9. Does unauthorized access remain impossible?", build: q9 },
  { title: "Q10. What does it cost?", build: q10 },
  { title: "Q11. Are failures actually model failures?", build: q11 },
];

// -- Repeatability, controls, thresholds, register --------------------------------

function repeatability(input: AnalysisInput): string[] {
  const first = casesOf(input, "media_pass_1");
  const second = casesOf(input, "media_pass_2");
  const out = [
    "The two media passes side by side on every dimension, each on its own; no figure is computed across the two. \"Differs\" means the observed counts differ on that dimension; p is Fisher's exact test on the pass count and is descriptive, not a threshold.",
    "",
  ];
  if (!first || !second) return [...out, ...tbd(`needs both passes; pending: ${pending(input, ["media_pass_1", "media_pass_2"]).join("; ")}`)];

  const rows = comparePasses(first, second).map((row) => {
    const a = row.first;
    const b = row.second;
    const both = (f: (s: CaseSummary) => string) => `${a ? f(a) : "—"}  vs  ${b ? f(b) : "—"}`;
    return [
      row.caseId,
      both((s) => `${s.passed.k}/${s.passed.n}`),
      row.passP === null ? "—" : row.passP.toFixed(2),
      both((s) => (s.searched ? `${s.searched.k}/${s.searched.n}` : "—")),
      both((s) => (s.routedRight ? `${s.routedRight.k}/${s.routedRight.n}` : "—")),
      both(causes),
      both((s) => (s.provenance ? `${s.provenance.blockDelivered}/${s.provenance.runsWithDocuments}, ${s.provenance.failedAnyCheck} failed` : "—")),
      both((s) => (s.retries ? `${s.retries.provenance.k}/${s.retries.provenance.n}, ${s.retries.other.k}/${s.retries.other.n}` : "—")),
      row.differsIn.join(", ") || "identical",
    ];
  });
  const differing = comparePasses(first, second).filter((row) => row.differsIn.length > 0).length;
  const samePass = comparePasses(first, second).filter((row) => row.first && row.second && row.first.passed.k === row.second.passed.k && row.first.passed.n === row.second.passed.n).length;
  out.push(
    `Cases with an identical pass count in both passes: ${samePass} of ${rows.length}. Cases that differ on at least one dimension: ${differing} of ${rows.length}.`,
    "",
    ...table(["case", "passed (1 vs 2)", "p", "searched (1 vs 2)", "routing right (1 vs 2)", "primary cause (1 vs 2)", "provenance: block / owed, failed a check (1 vs 2)", "retries: provenance, other (1 vs 2)", "differs in"], rows)
  );
  return out;
}

const CONTROLS: { role: Role; title: string; what: string }[] = [
  { role: "control_no_database", title: "Control: no database attached", what: "the same cases with the database removed" },
  { role: "control_relevant_library", title: "Control: only the relevant libraries attached", what: "the same cases with every library the question does not need removed" },
  { role: "control_no_library", title: "Control: no library attached", what: "the same cases with every library removed" },
];

function controls(input: AnalysisInput): string[] {
  const first = casesOf(input, "media_pass_1") ?? [];
  const second = casesOf(input, "media_pass_2") ?? [];
  const out: string[] = [];
  for (const { role, title, what } of CONTROLS) {
    out.push(`### ${title}`, "");
    const cases = casesOf(input, role);
    if (!cases) {
      out.push(...tbd(`${what}; the control has not been run or its result is not readable yet`));
      continue;
    }
    out.push(`${what[0].toUpperCase()}${what.slice(1)}. Each control is set beside its original in both media passes.`, "");
    const rows = pairControls(cases, first, second).map((row) => {
      const side = (s: CaseSummary | null) => (s ? `${s.passed.k}/${s.passed.n}; searched ${s.searched ? `${s.searched.k}/${s.searched.n}` : "—"}; ${shapes(s)}` : "TBD");
      return [row.baseId, side(row.firstPass), side(row.secondPass), side(row.control), causes(row.control)];
    });
    out.push(...table(["case", "original, first pass", "original, second pass", "control", "control: failed by primary cause"], rows));
  }
  return out;
}

function thresholds(): string[] {
  const rows = THRESHOLDS.map((t) => [t.id, t.metric, t.threshold, t.source, t.observedIn]);
  return [
    "No threshold below was chosen after seeing these results. Those the engineering plan did not decide say TBD. Observed values are in the section named; whether they meet a threshold is a decision for the person who sets it.",
    "",
    ...table(["id", "metric", "threshold", "where it was decided", "observed in"], rows),
  ];
}

function register(issues: Issue[]): string[] {
  return table(
    ["id", "kind", "what was found", "effect on the results", "status", "affects"],
    issues.map((i) => [i.id, i.kind, i.summary, i.effect, i.status, i.affects.join("; ")])
  );
}

function appendix(input: AnalysisInput): string[] {
  const out: string[] = [];
  for (const [role, result] of input.results) {
    if (!result || result.state !== "loaded") continue;
    out.push(`#### ${result.entry.title} (${role})`, "");
    out.push(...caseTable(result.cases, input.expectations));
  }
  return out;
}

export function renderReport(input: AnalysisInput): string {
  const lines: string[] = [
    "# A3 analysis report",
    "",
    `Generated ${input.generatedAt}.`,
    "",
    "> **Status: measurements only.** This report shows what the evaluation recorded. It reaches no verdict on the evaluation, and every assessment line is TBD until an engineer reviews it. Results that do not exist yet are marked TBD.",
    "",
    "## Results this report reads",
    "",
    ...results(input),
    "## How to read it",
    "",
    "- Only **valid** runs count in any rate. A run the gateway turned away, or that failed for another reason, is in the accounting (Q11) and in no percentage.",
    "- A failed run has **one primary cause**: routing, then retrieval, provenance generation, provenance sanitization, rendering, and the answer's own content last. The earliest link in the chain is charged, so one mistake is not counted three times.",
    "- Nothing is inferred from data a result does not have. The A0 baseline has no run-level detail, so tool, source, provenance and retry measures leave it out and say so.",
    "- Small samples: ten runs per case. Intervals are Wilson 95%; comparisons use Fisher's exact test. Neither is an acceptance criterion.",
    "",
    "## The eleven questions",
    "",
  ];
  for (const question of QUESTIONS) lines.push(`### ${question.title}`, "", ...question.build(input));
  lines.push("## Repeatability: first and second media pass", "", ...repeatability(input));
  lines.push("## Controls", "", "A control changes one thing about a case and nothing else, to show which of the things a case has is responsible for what the model does.", "", ...controls(input));
  lines.push("## Thresholds", "", ...thresholds());
  lines.push("## Grader, fixture, expectation and report issues", "", "Entered by hand. A result file cannot say its own grader was wrong, so none of these is inferred from a pattern in the data.", "", ...register(input.issues ?? KNOWN_ISSUES));
  lines.push("## Appendix: every case in every result", "", ...appendix(input));
  return lines.join("\n");
}
