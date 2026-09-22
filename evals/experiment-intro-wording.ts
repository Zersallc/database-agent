/**
 * A3 intro-wording experiment (follow-up to evals/diagnostic-routing.ts).
 *
 * The diagnostic found that swapping the "## Connection" section's wording,
 * alone, moved `media-vague-show-contracts` from 6/6 search to 0/6 search
 * (p = 0.0022) — the strongest single result in that diagnostic. That test
 * used A3's own no-database text as the alternative, which only showed that
 * wording matters, not that a *better* wording helps. This experiment asks
 * the next question: does making the "## Connection" section more explicit
 * about the document library's existence and role change tool selection,
 * holding the routing policy itself, the tools, the fixtures, the grader, the
 * model and everything else fixed?
 *
 * Method: identical to diagnostic-routing.ts. No change to
 * lib/agent/prompt.ts, lib/agent/index.ts, or any case/grader/fixture file.
 * The real, unmodified `runAgent` runs through the real, unmodified
 * `runCaseRepeated` harness. A thin ModelClient wrapper (same pattern as
 * harness.ts's recordingClient/pacedClient) edits `request.system` before it
 * reaches the model. Variant A is the identity transform: the real
 * `buildSystemPrompt` output, untouched -- the control, exactly as it exists
 * at the recorded git HEAD. Variant B takes that same real per-request text
 * and APPENDS one new paragraph to the end of the "## Connection" section
 * (never retypes or replaces the original wording, so the preserved portion
 * cannot drift from what production actually sends). Everything outside that
 * one section -- "## Document libraries", "## Choosing a source", "##
 * Sources", the routing policy, the tool definitions, the schema -- is
 * byte-identical between variants by construction.
 *
 * The added paragraph only names which tool serves which kind of need and
 * says the library is not a fallback; it adds no keyword rule, no
 * decision tree, no JSON structure, no new reasoning step, and it does not
 * touch the "## Choosing a source" section, which remains the sole place the
 * routing policy itself lives.
 *
 * Measured: routing outcome only (run_sql / search_documents / both /
 * clarifying question / neither), plus each case's own `missing_sources` /
 * `unnecessary_sources` accounting (whether the required source was used and
 * whether an unneeded one was), which is a narrower, non-quality-judging
 * signal than the case's full pass/fail grade. The full grade is recorded
 * too, for reference, but is not the primary measurement.
 *
 * Usage:
 *   npx tsx evals/experiment-intro-wording.ts
 *   npx tsx evals/experiment-intro-wording.ts --max-rpm=30 --repeat=5
 *   npx tsx evals/experiment-intro-wording.ts --repeat=1   # smoke test
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ModelClient, ModelRequest, ModelStreamEvent } from "@/lib/agent/providers/types";

import { mediaAmbiguityCases } from "./cases/media-ambiguity.eval";
import { mediaCrossSourceCases } from "./cases/media-cross-source.eval";
import { mediaMultiLibraryCases } from "./cases/media-multi-library.eval";
import { mediaOnlyCases } from "./cases/media-only.eval";
import { mediaPostgresOnlyCases } from "./cases/media-postgres-only.eval";
import { mediaVagueCases } from "./cases/media-vague.eval";
import { buildRealClient, runCaseRepeated } from "./harness";
import { copyMeter, meteredClient, pacedClient, type Meter } from "./meter";
import type { EvalCase, RunRecord } from "./types";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found?.slice(prefix.length);
}

function git(...args: string[]): string | null {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Section-level surgery on a real buildSystemPrompt() output -- same
// mechanism as diagnostic-routing.ts, duplicated here (not imported) so each
// diagnostic script stays a self-contained record of exactly what it did.
// ---------------------------------------------------------------------------

const SECTION_SEPARATOR = "\n\n---\n\n";

function splitSections(system: string): string[] {
  return system.split(SECTION_SEPARATOR);
}

function joinSections(sections: string[]): string {
  return sections.join(SECTION_SEPARATOR);
}

function sectionIndex(sections: string[], headingPrefix: string): number {
  return sections.findIndex((s) => s.trimStart().startsWith(headingPrefix));
}

/** Appends text to the end of the section starting with this heading, leaving everything else -- including the rest of that section's own original wording -- untouched. */
function withAppendedToSection(system: string, headingPrefix: string, addition: string): string {
  const sections = splitSections(system);
  const index = sectionIndex(sections, headingPrefix);
  if (index === -1) {
    throw new Error(`experiment-intro-wording: no section starting with ${JSON.stringify(headingPrefix)} to append to.`);
  }
  const next = [...sections];
  next[index] = `${next[index]}\n\n${addition}`;
  return joinSections(next);
}

// ---------------------------------------------------------------------------
// Variant B's one addition. English only, no keyword list, no decision tree,
// no JSON, no new reasoning step. It only names which tool serves which kind
// of need and says the library is not a fallback for the database. The
// routing policy itself stays exclusively in "## Choosing a source", which
// this experiment does not touch.
// ---------------------------------------------------------------------------

const EXPERIMENTAL_CONNECTION_ADDITION =
  "This workspace's document libraries (below) are a separate, equally real source, not a fallback: call run_sql " +
  "for a row or a figure the database holds, and search_documents for what a document says -- a clause, term, " +
  "obligation, or policy. Reach for the library because the question is about what a document states, not " +
  "because the database already came up short.";

type Variant = {
  id: "A_control" | "B_experimental";
  label: string;
  transform: (system: string) => string;
};

const CONTROL: Variant = {
  id: "A_control",
  label: "Control: the real buildSystemPrompt output, unmodified, exactly as it exists at the recorded git HEAD.",
  transform: (s) => s,
};

const EXPERIMENTAL: Variant = {
  id: "B_experimental",
  label:
    "Experimental: the real control text with one paragraph appended to the end of the '## Connection' section. " +
    "Nothing else in the prompt differs.",
  transform: (s) => withAppendedToSection(s, "## Connection", EXPERIMENTAL_CONNECTION_ADDITION),
};

const VARIANTS = [CONTROL, EXPERIMENTAL];

// ---------------------------------------------------------------------------
// Test matrix: one case per routing class the brief asked for. All six use
// the same Sales/postgres connection and the Contracts library (directly
// verified by reading the case files before writing this script), which is
// what lets one fixed Variant B addition apply unchanged across every case.
// ---------------------------------------------------------------------------

function findCase(cases: EvalCase[], id: string): EvalCase {
  const found = cases.find((c) => c.id === id);
  if (!found) throw new Error(`experiment-intro-wording: case ${id} not found.`);
  return found;
}

const MATRIX: { case: EvalCase; role: string }[] = [
  { case: findCase(mediaVagueCases, "media-vague-show-contracts"), role: "vague request (the diagnostic's strongest effect)" },
  { case: findCase(mediaOnlyCases, "media-only-notice-period"), role: "specific document question" },
  { case: findCase(mediaPostgresOnlyCases, "media-pg-contracts-register"), role: "SQL-only" },
  { case: findCase(mediaCrossSourceCases, "media-cross-register-and-terms"), role: "cross-source" },
  { case: findCase(mediaMultiLibraryCases, "media-multi-leave-policy"), role: "multi-library" },
  { case: findCase(mediaAmbiguityCases, "media-insufficient-penalty-rate"), role: "ambiguous, insufficient-source" },
];

// ---------------------------------------------------------------------------
// The model client that performs the splice. Mirrors harness.ts's own
// recordingClient/pacedClient.
// ---------------------------------------------------------------------------

function withSystemTransform(client: ModelClient, transform: (system: string) => string): ModelClient {
  return {
    kind: client.kind,
    model: client.model,
    probe: () => client.probe(),
    async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
      yield* client.stream({ ...request, system: transform(request.system) });
    },
  };
}

function variantMeter(meter: ReturnType<typeof meteredClient>, variant: Variant): ReturnType<typeof meteredClient> {
  return { ...meter, client: withSystemTransform(meter.client, variant.transform) };
}

// ---------------------------------------------------------------------------
// Routing classification -- the primary measurement.
// ---------------------------------------------------------------------------

type RoutingOutcome = "run_sql" | "search_documents" | "both" | "neither";

function routingOf(record: RunRecord): RoutingOutcome {
  const sql = record.tools.includes("run_sql");
  const search = record.tools.includes("search_documents");
  if (sql && search) return "both";
  if (search) return "search_documents";
  if (sql) return "run_sql";
  return "neither";
}

function mark(record: RunRecord): string {
  if (record.status !== "valid") {
    return { rate_limited: "R", infrastructure: "I", execution_failure: "E" }[record.status];
  }
  return { run_sql: "Q", search_documents: "S", both: "B", neither: "N" }[routingOf(record)];
}

type CellResult = {
  case_id: string;
  case_role: string;
  variant_id: Variant["id"];
  variant_label: string;
  scheduled: number;
  valid: number;
  rate_limited: number;
  infrastructure: number;
  execution_failure: number;
  routing: Record<RoutingOutcome, number>;
  neither_asked: number;
  neither_answered: number;
  /** Of valid runs with a declared source expectation: how many missed a required source, or used one the question did not need. Not a quality score -- see the file header. */
  runs_missing_required_source: number;
  runs_used_unnecessary_source: number;
  /** Informational only -- the case's own full pass/fail grade (answer content and provenance included, not just source selection). */
  grader_pass: number;
  grader_valid_graded: number;
  run_completed_at: string[];
};

async function runCell(kase: EvalCase, variant: Variant, meter: ReturnType<typeof meteredClient>, n: number): Promise<CellResult> {
  const fixture = { ...kase, id: `${kase.id}@${variant.id}` };
  const vMeter = variantMeter(meter, variant);
  const timestamps: string[] = [];
  const { runs } = await runCaseRepeated(fixture, vMeter, n, {
    onRun: (_i, record) => {
      timestamps.push(new Date().toISOString());
      process.stdout.write(mark(record));
    },
  });

  const valid = runs.filter((r) => r.status === "valid");
  const routing: Record<RoutingOutcome, number> = { run_sql: 0, search_documents: 0, both: 0, neither: 0 };
  let neitherAsked = 0;
  let neitherAnswered = 0;
  let missingRequired = 0;
  let usedUnnecessary = 0;
  for (const r of valid) {
    const outcome = routingOf(r);
    routing[outcome] += 1;
    if (outcome === "neither") {
      if (r.ended_in_question) neitherAsked += 1;
      else neitherAnswered += 1;
    }
    if (r.missing_sources && r.missing_sources.length > 0) missingRequired += 1;
    if (r.unnecessary_sources && r.unnecessary_sources.length > 0) usedUnnecessary += 1;
  }
  const graded = valid.filter((r) => r.grade);

  return {
    case_id: kase.id,
    case_role: "",
    variant_id: variant.id,
    variant_label: variant.label,
    scheduled: n,
    valid: valid.length,
    rate_limited: runs.filter((r) => r.status === "rate_limited").length,
    infrastructure: runs.filter((r) => r.status === "infrastructure").length,
    execution_failure: runs.filter((r) => r.status === "execution_failure").length,
    routing,
    neither_asked: neitherAsked,
    neither_answered: neitherAnswered,
    runs_missing_required_source: missingRequired,
    runs_used_unnecessary_source: usedUnnecessary,
    grader_pass: graded.filter((r) => r.grade!.pass).length,
    grader_valid_graded: graded.length,
    run_completed_at: timestamps,
  };
}

// ---------------------------------------------------------------------------

async function main() {
  const maxRpm = Number(arg("max-rpm") ?? 30);
  const repeat = Number(arg("repeat") ?? 5);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const outPath = arg("out") ?? path.join(root, "evals", "results", "a3-intro-experiment.json");

  const gitHead = git("rev-parse", "HEAD");
  const gitBranch = git("rev-parse", "--abbrev-ref", "HEAD");
  const gitDirty = git("status", "--porcelain");

  const { client: realClient, label } = buildRealClient();
  const meter = meteredClient(pacedClient(realClient, maxRpm));

  console.log(`A3 intro-wording experiment against ${label}, at most ${maxRpm} requests a minute.`);
  console.log(`git HEAD ${gitHead} (${gitBranch}), ${gitDirty ? gitDirty.split("\n").length + " dirty files" : "clean"}`);
  console.log(`${MATRIX.length} cases x ${VARIANTS.length} variants x ${repeat} repeats.\n`);

  const cells: CellResult[] = [];
  const start = Date.now();

  for (const { case: kase, role } of MATRIX) {
    console.log(`${kase.id}: ${role}`);
    for (const variant of VARIANTS) {
      process.stdout.write(`  ${variant.id.padEnd(20)} `);
      const cell = await runCell(kase, variant, meter, repeat);
      cell.case_role = role;
      cells.push(cell);
      console.log(`  ${JSON.stringify(cell.routing)}`);
    }
  }

  const durationMs = Date.now() - start;
  const usage = copyMeter(meter.agent) as Meter;

  const report = {
    generated_at: new Date().toISOString(),
    purpose:
      "Tests whether a more explicit '## Connection' section (naming which tool serves the database vs. the " +
      "document libraries, and saying the library is not a fallback) changes tool selection, holding the routing " +
      "policy, tools, fixtures, grader and model fixed. Follow-up to evals/diagnostic-routing.ts, which found " +
      "intro wording was the dominant variable behind media-vague-show-contracts's search-triggering swing.",
    git_head: gitHead,
    git_branch: gitBranch,
    git_dirty_files: gitDirty ? gitDirty.split("\n").map((l) => l.trim()) : [],
    model: meter.client.model,
    max_rpm: maxRpm,
    repeat,
    variants: VARIANTS.map((v) => ({ id: v.id, label: v.label })),
    experimental_addition_text: EXPERIMENTAL_CONNECTION_ADDITION,
    matrix: MATRIX.map((m) => ({ case_id: m.case.id, role: m.role })),
    cells,
    usage_total: usage,
    duration_ms: durationMs,
  };

  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(
    `\nAgent usage: ${usage.calls} requests (${usage.rate_limited} answered 429), ${usage.input_tokens} in / ${usage.output_tokens} out tokens.`
  );
  console.log(`Wall time ${Math.round(durationMs / 1000)}s.`);
  console.log(`Report written to ${outPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
