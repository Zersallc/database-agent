/**
 * A3 routing diagnostic: isolates which of three prompt variables drives
 * whether the model searches a document library.
 *
 * A3's "no-database" control (evals/results/a3-analysis.md) changed three
 * things at once when it removed the database: whether `run_sql` was offered
 * at all, whether the "## Choosing a source" section existed in the prompt
 * (`buildSystemPrompt` only renders it when connections.length + libraries.length
 * > 1 -- see lib/agent/prompt.ts), and which "## Connection" text the model
 * read (`renderConnectionIntro`). That control could not say which of the
 * three did the work -- see the handoff, section 4, point 4.
 *
 * This script does not modify lib/agent/prompt.ts, lib/agent/index.ts, or any
 * case, grader or fixture file. It drives the real, unmodified `runAgent`
 * through the real, unmodified `runCaseRepeated` harness, against real case
 * fixtures. The three variables are isolated by wrapping the model client:
 * `buildSystemPrompt` (exported, called exactly as `runAgent` calls it) still
 * produces the prompt for whatever `connections`/`libraries` a condition
 * attaches -- so database presence (and the real availability of the
 * `run_sql` tool) is a genuine variable, not simulated -- and a thin client
 * wrapper then edits the resulting text by section heading before it reaches
 * the model: deleting or inserting the "## Choosing a source" section, or
 * swapping the "## Connection" section for another condition's real text.
 * Every spliced section is real output from the real `buildSystemPrompt`,
 * harvested from a direct call to it, never hand-written.
 *
 * Only the routing outcome is measured: which of run_sql / search_documents /
 * both / neither the model called. The case's own grader still runs (free,
 * deterministic, already attached to the case) and is recorded for
 * reference, but it is not what this script measures or reports on -- a
 * grader's `sources` expectation was written for the case's natural
 * connections, and a condition that removed the database can make its
 * `unnecessary_sources`/`missing_sources` accounting stale in the same way
 * A3's own no-database control did (ISS-04).
 *
 * Two of the six primary conditions (E, F) deliberately produce an internally
 * inconsistent prompt -- the "## Connection" text denies a database that
 * `run_sql` is still genuinely offered for. That is intentional: it is the
 * only way to isolate intro wording from actual tool availability without
 * touching production code, and it is not a state the application can ever
 * really be in. See the write-up for how that is read.
 *
 * Usage:
 *   npx tsx evals/diagnostic-routing.ts
 *   npx tsx evals/diagnostic-routing.ts --max-rpm=30 --primary-repeat=6 --secondary-repeat=5
 *   npx tsx evals/diagnostic-routing.ts --primary-repeat=1 --secondary-repeat=0   # smoke test
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildSystemPrompt, type PromptLibrary } from "@/lib/agent/prompt";
import type { ModelClient, ModelRequest, ModelStreamEvent } from "@/lib/agent/providers/types";

import { mediaCrossSourceCases } from "./cases/media-cross-source.eval";
import { mediaMultiLibraryCases } from "./cases/media-multi-library.eval";
import { mediaOnlyCases } from "./cases/media-only.eval";
import { mediaPostgresOnlyCases } from "./cases/media-postgres-only.eval";
import { mediaVagueCases } from "./cases/media-vague.eval";
import { buildRealClient, runCaseRepeated } from "./harness";
import { CONTRACTS, HR_POLICIES } from "./media-fixtures";
import { copyMeter, meteredClient, pacedClient, type Meter } from "./meter";
import type { EvalCase, RunRecord } from "./types";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found?.slice(prefix.length);
}

// ---------------------------------------------------------------------------
// Section-level surgery on a real buildSystemPrompt() output. Sections are
// separated by the literal "\n\n---\n\n" buildSystemPrompt joins them with
// (see its own last line); every function here only cuts, inserts or swaps
// whole sections by their heading, never touches text within one.
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

/** Removes the section starting with this heading, if there is one. A no-op otherwise, so a judge-style call with no such section is untouched rather than failing. */
function withoutHeading(system: string, headingPrefix: string): string {
  const sections = splitSections(system);
  const index = sectionIndex(sections, headingPrefix);
  if (index === -1) return system;
  return joinSections([...sections.slice(0, index), ...sections.slice(index + 1)]);
}

function withInsertedAfter(system: string, afterHeadingPrefix: string, section: string): string {
  const sections = splitSections(system);
  const index = sectionIndex(sections, afterHeadingPrefix);
  if (index === -1) {
    throw new Error(`diagnostic-routing: no section starting with ${JSON.stringify(afterHeadingPrefix)} to insert after.`);
  }
  return joinSections([...sections.slice(0, index + 1), section, ...sections.slice(index + 1)]);
}

function withReplaced(system: string, headingPrefix: string, section: string): string {
  const sections = splitSections(system);
  const index = sectionIndex(sections, headingPrefix);
  if (index === -1) {
    throw new Error(`diagnostic-routing: no section starting with ${JSON.stringify(headingPrefix)} to replace.`);
  }
  const next = [...sections];
  next[index] = section;
  return joinSections(next);
}

function findHeading(system: string, headingPrefix: string): string {
  const sections = splitSections(system);
  const index = sectionIndex(sections, headingPrefix);
  if (index === -1) throw new Error(`diagnostic-routing: no section starting with ${JSON.stringify(headingPrefix)} found.`);
  return sections[index];
}

// ---------------------------------------------------------------------------
// Donor text: real buildSystemPrompt() output, called directly (the same
// exported function runAgent calls, unmodified), only to harvest one
// section's exact wording for splicing into a different condition.
// ---------------------------------------------------------------------------

const DONOR_NOW = new Date();
const CONTRACTS_LIB: PromptLibrary = { name: CONTRACTS.name, description: CONTRACTS.description };
const HR_LIB: PromptLibrary = { name: HR_POLICIES.name, description: HR_POLICIES.description };

/**
 * renderSourceChoice's text is a function of the database count alone (see
 * lib/agent/prompt.ts) -- not of which or how many libraries are attached --
 * so any 0-database, more-than-one-total-source workspace donates text
 * identical to what a 0-database, 1-library workspace would get if the app's
 * own gate rendered the section at all. Two libraries here exist only to trip
 * that gate; their names never appear in the harvested section.
 */
const DONOR_NO_DB_TWO_LIBRARIES = buildSystemPrompt({
  playbookContext: "",
  responseDetail: "balanced",
  connections: [],
  libraries: [CONTRACTS_LIB, HR_LIB],
  now: DONOR_NOW,
});
const SOURCE_CHOICE_AT_ZERO_DATABASES = findHeading(DONOR_NO_DB_TWO_LIBRARIES, "## Choosing a source");

/** The real no-database, one-library intro -- exactly what Condition B (the original A3 control) sends. */
const DONOR_NO_DB_ONE_LIBRARY = buildSystemPrompt({
  playbookContext: "",
  responseDetail: "balanced",
  connections: [],
  libraries: [CONTRACTS_LIB],
  now: DONOR_NOW,
});
const CONNECTION_INTRO_NO_DATABASE = findHeading(DONOR_NO_DB_ONE_LIBRARY, "## Connection");

// ---------------------------------------------------------------------------
// Conditions.
// ---------------------------------------------------------------------------

type Condition = {
  id: string;
  label: string;
  /** Whether the case's real database connection is attached -- controls the actual run_sql tool availability, not just prompt text. */
  databasePresent: boolean;
  transform: (system: string) => string;
  note: string;
};

const FULL: Condition = {
  id: "A_full",
  label: "Full (natural)",
  databasePresent: true,
  transform: (s) => s,
  note: "Unmodified buildSystemPrompt output for this case's real connections+libraries. Section present, database-style intro.",
};

const NONE: Condition = {
  id: "B_none",
  label: "No database (natural, the original A3 control)",
  databasePresent: false,
  transform: (s) => s,
  note: "Unmodified buildSystemPrompt output with connections=[]. Section absent (0 + libraries.length is not > 1 when libraries.length === 1), no-database intro. This is the confounded control A3 already ran.",
};

const SECTION_REMOVED: Condition = {
  id: "C_section_removed",
  label: "Database attached, section removed",
  databasePresent: true,
  transform: (s) => withoutHeading(s, "## Choosing a source"),
  note: "Same as Full, with the '## Choosing a source' section deleted. Database presence and intro wording held at Full's level. Isolates the section.",
};

const SECTION_ADDED: Condition = {
  id: "D_section_added",
  label: "No database, section added",
  databasePresent: false,
  transform: (s) => withInsertedAfter(s, "## Document libraries", SOURCE_CHOICE_AT_ZERO_DATABASES),
  note: "Same as None, with a real '## Choosing a source' section spliced in (harvested from a donor call with connections=[] and two libraries; see donor_texts.source_choice_at_zero_databases in the output). Database presence and intro wording held at None's level. Isolates the section.",
};

const INTRO_SWAPPED: Condition = {
  id: "E_intro_swapped",
  label: "Database attached, no-database-style intro (mismatched)",
  databasePresent: true,
  transform: (s) => withReplaced(s, "## Connection", CONNECTION_INTRO_NO_DATABASE),
  note: "Same as Full, with the '## Connection' section replaced by None's real intro text. run_sql remains genuinely offered (connections is unchanged) even though the prompt denies it. Deliberately internally inconsistent; isolates intro wording from actual tool availability. Not a state the application can produce.",
};

const DATABASE_ONLY_TOOL_AVAILABLE: Condition = {
  id: "F_database_only_tool_available",
  label: "Database attached (tool available), None-style prompt text",
  databasePresent: true,
  transform: (s) => withReplaced(withoutHeading(s, "## Choosing a source"), "## Connection", CONNECTION_INTRO_NO_DATABASE),
  note: "Same as Full, with both the section removed and the intro swapped for None's text, while run_sql remains genuinely offered. Section and intro read exactly as they do in None. Isolates database/tool availability alone.",
};

const PRIMARY_CONDITIONS = [FULL, NONE, SECTION_REMOVED, SECTION_ADDED, INTRO_SWAPPED, DATABASE_ONLY_TOOL_AVAILABLE];
const SECONDARY_PAIR_NATURAL = [FULL, NONE];
const SECONDARY_PAIR_SECTION = [FULL, SECTION_REMOVED];

// ---------------------------------------------------------------------------
// Case selection: one primary case for the full ablation (the largest, and
// structurally cleanest -- single database, single library -- known effect
// from A3), five secondary cases for a lighter two-condition generalization
// check, one per family this diagnostic was asked to represent.
// ---------------------------------------------------------------------------

function findCase(cases: EvalCase[], id: string): EvalCase {
  const found = cases.find((c) => c.id === id);
  if (!found) throw new Error(`diagnostic-routing: case ${id} not found.`);
  return found;
}

const PRIMARY_CASE = findCase(mediaVagueCases, "media-vague-show-contracts");

const SECONDARY: { case: EvalCase; conditions: Condition[]; why: string }[] = [
  {
    case: findCase(mediaOnlyCases, "media-only-notice-period"),
    conditions: SECONDARY_PAIR_NATURAL,
    why: "stable document-search case (10/10 search in both A3 passes): does a targeted, non-vague document question show the same no-database swing as the vague one?",
  },
  {
    case: findCase(mediaPostgresOnlyCases, "media-pg-contracts-register"),
    conditions: SECONDARY_PAIR_SECTION,
    why: "stable SQL case (0/10 search in both A3 passes): negative control -- does removing the section spuriously induce a search on a question that needs none?",
  },
  {
    case: findCase(mediaOnlyCases, "media-only-paraphrase"),
    conditions: SECONDARY_PAIR_SECTION,
    why: "known no-search failure (60% then 30% search across the two A3 passes): does removing the section, alone, make it worse?",
  },
  {
    case: findCase(mediaCrossSourceCases, "media-cross-register-and-terms"),
    conditions: SECONDARY_PAIR_SECTION,
    why: "known multi-source failure (0/10 search in both A3 passes, sql only): does the section's absence change a case that already ignores the library?",
  },
  {
    case: findCase(mediaMultiLibraryCases, "media-multi-leave-policy"),
    conditions: SECONDARY_PAIR_SECTION,
    why: "known multi-library failure (10-20% search, mostly no tool call): does removing the section change a case that already mostly answers without searching?",
  },
];

// ---------------------------------------------------------------------------
// The model client that performs the splice. Mirrors harness.ts's own
// recordingClient/pacedClient: a thin wrapper around the real ModelClient
// that edits the outgoing request and changes nothing else.
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

function conditionMeter(meter: ReturnType<typeof meteredClient>, condition: Condition): ReturnType<typeof meteredClient> {
  return { ...meter, client: withSystemTransform(meter.client, condition.transform) };
}

function fixtureFor(base: EvalCase, condition: Condition): EvalCase {
  return { ...base, id: `${base.id}@${condition.id}`, connections: condition.databasePresent ? base.connections : [] };
}

// ---------------------------------------------------------------------------
// Routing classification -- the only outcome this script measures.
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
  condition_id: string;
  condition_label: string;
  condition_note: string;
  database_present: boolean;
  scheduled: number;
  valid: number;
  rate_limited: number;
  infrastructure: number;
  execution_failure: number;
  routing: Record<RoutingOutcome, number>;
  /** Of the "neither" runs: ended in a clarifying question vs. just answered without any tool. */
  neither_asked: number;
  neither_answered: number;
  /** Informational only -- see file header on why this is not what the diagnostic measures. */
  grader_pass: number;
  grader_valid_graded: number;
};

async function runCell(
  kase: EvalCase,
  condition: Condition,
  meter: ReturnType<typeof meteredClient>,
  n: number
): Promise<CellResult> {
  const fixture = fixtureFor(kase, condition);
  const cMeter = conditionMeter(meter, condition);
  const { runs } = await runCaseRepeated(fixture, cMeter, n, {
    onRun: (_i, record) => process.stdout.write(mark(record)),
  });

  const valid = runs.filter((r) => r.status === "valid");
  const routing: Record<RoutingOutcome, number> = { run_sql: 0, search_documents: 0, both: 0, neither: 0 };
  let neitherAsked = 0;
  let neitherAnswered = 0;
  for (const r of valid) {
    const outcome = routingOf(r);
    routing[outcome] += 1;
    if (outcome === "neither") {
      if (r.ended_in_question) neitherAsked += 1;
      else neitherAnswered += 1;
    }
  }
  const graded = valid.filter((r) => r.grade);

  return {
    case_id: kase.id,
    condition_id: condition.id,
    condition_label: condition.label,
    condition_note: condition.note,
    database_present: condition.databasePresent,
    scheduled: n,
    valid: valid.length,
    rate_limited: runs.filter((r) => r.status === "rate_limited").length,
    infrastructure: runs.filter((r) => r.status === "infrastructure").length,
    execution_failure: runs.filter((r) => r.status === "execution_failure").length,
    routing,
    neither_asked: neitherAsked,
    neither_answered: neitherAnswered,
    grader_pass: graded.filter((r) => r.grade!.pass).length,
    grader_valid_graded: graded.length,
  };
}

// ---------------------------------------------------------------------------

async function main() {
  const maxRpm = Number(arg("max-rpm") ?? 30);
  const primaryRepeat = Number(arg("primary-repeat") ?? 6);
  const secondaryRepeat = Number(arg("secondary-repeat") ?? 5);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const outPath = arg("out") ?? path.join(root, "evals", "results", "a3-diagnostic.json");

  const { client: realClient, label } = buildRealClient();
  const meter = meteredClient(pacedClient(realClient, maxRpm));

  console.log(`A3 routing diagnostic against ${label}, at most ${maxRpm} requests a minute.`);
  console.log(`Primary case: ${PRIMARY_CASE.id}, ${PRIMARY_CONDITIONS.length} conditions x ${primaryRepeat} repeats.`);
  console.log(`Secondary cases: ${SECONDARY.length}, 2 conditions x ${secondaryRepeat} repeats each.\n`);

  const cells: CellResult[] = [];
  const start = Date.now();

  for (const condition of PRIMARY_CONDITIONS) {
    process.stdout.write(`${PRIMARY_CASE.id.padEnd(28)} ${condition.id.padEnd(30)} `);
    const cell = await runCell(PRIMARY_CASE, condition, meter, primaryRepeat);
    cells.push(cell);
    console.log(`  ${JSON.stringify(cell.routing)}`);
  }

  for (const { case: kase, conditions, why } of SECONDARY) {
    console.log(`\n${kase.id}: ${why}`);
    for (const condition of conditions) {
      process.stdout.write(`${kase.id.padEnd(28)} ${condition.id.padEnd(30)} `);
      const cell = await runCell(kase, condition, meter, secondaryRepeat);
      cells.push(cell);
      console.log(`  ${JSON.stringify(cell.routing)}`);
    }
  }

  const durationMs = Date.now() - start;
  const usage = copyMeter(meter.agent) as Meter;

  const report = {
    generated_at: new Date().toISOString(),
    purpose:
      "Isolates database presence, the '## Choosing a source' section, and the '## Connection' intro wording as " +
      "candidate causes of the search-triggering differences A3 found. See the file header for method.",
    primary_case: PRIMARY_CASE.id,
    primary_conditions: PRIMARY_CONDITIONS.map((c) => ({ id: c.id, label: c.label, note: c.note, database_present: c.databasePresent })),
    primary_repeat: primaryRepeat,
    secondary_repeat: secondaryRepeat,
    secondary: SECONDARY.map((s) => ({ case_id: s.case.id, why: s.why, condition_ids: s.conditions.map((c) => c.id) })),
    max_rpm: maxRpm,
    model: meter.client.model,
    donor_texts: {
      source_choice_at_zero_databases: SOURCE_CHOICE_AT_ZERO_DATABASES,
      connection_intro_no_database: CONNECTION_INTRO_NO_DATABASE,
    },
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
