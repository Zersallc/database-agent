/**
 * Eval CLI. Not part of `npm test`: this makes real, billed, non-deterministic
 * model calls, so it is opt-in (`npm run eval`) and reports a pass rate per
 * case rather than a pass/fail verdict for the whole run.
 *
 * `--suite=<list>`  which cases: `legacy` (the original eleven), `media` (the
 *                   media-connection families), `live` (against a real
 *                   syslab-server; needs RETRIEVAL_* in the environment).
 *                   Comma separated. Default `legacy,media`.
 * `--case=<id>`     only cases whose id contains this substring (comma-separated)
 * `--repeat=<n>`    runs per case (default 5)
 * `--with-library`  attach a fixture library to every case that has none of its
 *                   own, to see whether merely having one changes SQL behavior
 * `--max-rpm=<n>`   most model requests started in any minute (default 40). The
 *                   shared gateway allows 60 per token, and a run that meets the
 *                   limit measures nothing
 * `--variant=<v>`   a control: run each selected case with one thing taken away, to
 *                   find out which of the things a case has is responsible for what
 *                   the model does. `no-database` (no database attached),
 *                   `only-relevant-library` (only the libraries the question
 *                   needs), `no-library` (databases only). Case ids get an @variant
 *                   suffix. Nothing about the prompt or the grading changes.
 * `--label=<text>`  a note stored in the report
 * `--out=<path>`    where to write the JSON report (default evals/results/<timestamp>.json)
 *
 * A run that fails because of the provider is never graded. It is classified
 * (rate limited, infrastructure, other), retried where retrying can help, and
 * reported apart from the runs that measured the model. See `classify.ts`.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { AgentLibrary } from "@/lib/agent";
import { stores } from "@/lib/providers";
import type { MediaConnectionDoc } from "@/lib/services/connections";
import { resolveSources } from "@/lib/services/sources";

import { ALL_CASES, LEGACY_CASES, LIVE_CASES, MEDIA_CASES } from "./cases/index";
import { buildRealClient, runCaseRepeated, type RunOptions } from "./harness";
import { CONTRACTS } from "./media-fixtures";
import { copyMeter, diffMeter, emptyMeter, meteredClient, pacedClient, type Meter } from "./meter";
import { aggregate, normalize, type CaseReport, type Report } from "./report";
import type { EvalCase, GradeResult, LiveLibrary, RunRecord, SearchRecord } from "./types";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found?.slice(prefix.length);
}

const flag = (name: string) => process.argv.includes(`--${name}`);

function git(...args: string[]): string | null {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

/**
 * What produced these numbers. A pass rate means little later without the
 * code it was measured against, and the working tree is often not a commit.
 */
function runEnvironment() {
  const status = git("status", "--porcelain");
  let endpoint: string | null = null;
  try {
    endpoint = process.env.MODEL_BASE_URL ? new URL(process.env.MODEL_BASE_URL).host : null;
  } catch {
    endpoint = null;
  }
  return {
    commit: git("rev-parse", "HEAD"),
    branch: git("rev-parse", "--abbrev-ref", "HEAD"),
    dirty_files: status ? status.split("\n").map((line) => line.trim()) : [],
    node: process.version,
    model_endpoint: endpoint,
  };
}

/** Whether a real syslab-server is configured for the live cases. */
function liveConfigured(): boolean {
  return Boolean(process.env.RETRIEVAL_BASE_URL && process.env.RETRIEVAL_TOKEN && process.env.RETRIEVAL_TEST_TENANT);
}

/**
 * A real library, built the way the application builds one: a media connection
 * record in the (in-memory) store, resolved by `resolveSources`. The server
 * address, token and the library's key never appear here in a form that could be
 * printed; they are read from the environment by the resolver.
 */
async function liveLibrary(spec: LiveLibrary, log: SearchRecord[]): Promise<AgentLibrary> {
  const tenantId = `ten_eval_live_${Date.now()}`;
  const now = new Date().toISOString();
  const doc: MediaConnectionDoc = {
    id: "eval_media_1",
    object: "connection",
    kind: "media",
    engine: "media",
    name: spec.name,
    description: spec.description,
    status: "unknown",
    status_checked_at: null,
    status_detail: null,
    media: { alias_id: process.env.RETRIEVAL_TEST_TENANT!, library_ref: null, server_ref: "default" },
    created_at: now,
    updated_at: now,
  };
  await stores().documents.put("connections", tenantId, doc);
  const { libraries } = await resolveSources(
    { tenantId, userId: "usr_eval" },
    {
      env: {
        MEDIA_CONNECTIONS_ENABLED: "true",
        RETRIEVAL_BASE_URL: process.env.RETRIEVAL_BASE_URL,
        RETRIEVAL_TOKEN: process.env.RETRIEVAL_TOKEN,
      },
    }
  );
  const library = libraries[0];
  if (!library) throw new Error("The live library did not resolve.");
  return {
    ...library,
    search: async (query: string) => {
      const result = await library.search(query);
      log.push({ library: library.name, query, returned: result.passages.map((passage) => passage.source) });
      return result;
    },
  };
}

const VARIANTS = ["no-database", "only-relevant-library", "no-library"] as const;
type Variant = (typeof VARIANTS)[number];

/** A control version of a case: the same question and grading, with one thing removed. */
function withVariant(kase: EvalCase, variant: Variant): EvalCase {
  const suffix = { ...kase, id: `${kase.id}@${variant}` };
  if (variant === "no-database") return { ...suffix, connections: [] };
  if (variant === "no-library") return { ...suffix, libraries: undefined, live: undefined };
  const needed = new Set([...(kase.sources?.required ?? []), ...(kase.sources?.allowed ?? [])]);
  const kept = (kase.libraries ?? []).filter((library) => needed.has(`lib:${library.name}`));
  return { ...suffix, libraries: kept.length ? kept : kase.libraries };
}

const mark = (record: RunRecord): string =>
  record.status === "rate_limited" ? "R" : record.status === "infrastructure" ? "I" : record.status === "execution_failure" ? "E" : record.grade?.pass ? "." : "x";

async function main() {
  const suites = (arg("suite") ?? "legacy,media").split(",").map((s) => s.trim()).filter(Boolean);
  const caseFilter = arg("case")?.split(",").map((s) => s.trim()).filter(Boolean);
  const repeat = Number(arg("repeat") ?? 5);
  const maxRpm = Number(arg("max-rpm") ?? 40);
  const withLibrary = flag("with-library");
  const variant = arg("variant") as Variant | undefined;
  if (variant && !VARIANTS.includes(variant)) {
    console.error(`Unknown variant ${variant}. Known: ${VARIANTS.join(", ")}.`);
    process.exit(1);
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

  const unknown = suites.filter((s) => !["legacy", "media", "live"].includes(s));
  if (unknown.length > 0) {
    console.error(`Unknown suite(s): ${unknown.join(", ")}. Known: legacy, media, live.`);
    process.exit(1);
  }

  let selected: EvalCase[] = [
    ...(suites.includes("legacy") ? LEGACY_CASES : []),
    ...(suites.includes("media") ? MEDIA_CASES : []),
  ];
  if (suites.includes("live")) {
    if (liveConfigured()) selected = [...selected, ...LIVE_CASES];
    else console.log("Skipping the live cases: RETRIEVAL_BASE_URL, RETRIEVAL_TOKEN and RETRIEVAL_TEST_TENANT are not all set.\n");
  }
  const filtered = caseFilter ? selected.filter((c) => caseFilter.some((f) => c.id.includes(f))) : selected;
  const cases = variant ? filtered.map((c) => withVariant(c, variant)) : filtered;

  if (cases.length === 0) {
    console.error(`No case matches. Known ids: ${[...ALL_CASES, ...LIVE_CASES].map((c) => c.id).join(", ")}`);
    process.exit(1);
  }

  const { client: realClient, label } = buildRealClient();
  const meter = meteredClient(pacedClient(realClient, maxRpm));
  console.log(
    `Running ${cases.length} case(s), ${repeat} repeat(s) each, against ${label}` +
      `${withLibrary ? ", with a fixture library attached" : ""}, at most ${maxRpm} requests a minute\n`
  );

  const report: Report & { schema: number; suite: string[]; options: { with_library: boolean; max_rpm: number; variant: string | null }; accounting?: unknown } = {
    schema: 2,
    label: arg("label"),
    ranAt: new Date().toISOString(),
    model: meter.client.model,
    repeat,
    suite: suites,
    options: { with_library: withLibrary, max_rpm: maxRpm, variant: variant ?? null },
    env: runEnvironment(),
    duration_ms: 0,
    usage_total: { agent: emptyMeter(), judge: emptyMeter() },
    cases: [],
  };
  const suiteStart = Date.now();

  let anyFailed = false;
  let setupFailed = false;
  for (const kase of cases) {
    process.stdout.write(`${kase.id.padEnd(42)} `);
    const before = { agent: copyMeter(meter.agent), judge: copyMeter(meter.judge) };
    const caseStart = Date.now();

    const options: RunOptions = {
      liveLibrary,
      // A case with no library of its own gets the fixture one when asked to.
      extraLibraries: withLibrary && !kase.libraries && !kase.live ? [CONTRACTS] : undefined,
    };
    const marks: string[] = [];
    const { runs, stopped, setupFailure } = await runCaseRepeated(kase, meter, repeat, {
      ...options,
      onRun: (_index, record) => {
        marks.push(mark(record));
        process.stdout.write(mark(record));
      },
    });

    const valid = runs.filter((r) => r.status === "valid");
    const results: GradeResult[] = valid.map((r) => r.grade!).filter(Boolean);
    const passes = results.filter((r) => r.pass).length;
    const count = (status: RunRecord["status"]) => runs.filter((r) => r.status === status).length;

    const caseReport: CaseReport & { scheduled: number; valid: number; rate_limited: number; infrastructure: number; execution_failure: number } = {
      id: kase.id,
      description: kase.description,
      family: kase.family,
      scheduled: repeat,
      valid: valid.length,
      rate_limited: count("rate_limited"),
      infrastructure: count("infrastructure"),
      execution_failure: count("execution_failure"),
      passRate: valid.length ? passes / valid.length : null,
      results,
      runs,
      duration_ms: Date.now() - caseStart,
      usage: {
        agent: diffMeter(meter.agent, before.agent),
        judge: diffMeter(meter.judge, before.judge),
      },
      stopped,
    };
    report.cases.push(caseReport);

    const notMeasured = runs.length - valid.length;
    const tail = notMeasured ? `  [${notMeasured} not measured: ${[count("rate_limited") && `${count("rate_limited")} rate-limited`, count("infrastructure") && `${count("infrastructure")} infrastructure`, count("execution_failure") && `${count("execution_failure")} other`].filter(Boolean).join(", ")}]` : "";
    console.log(`  ${passes}/${valid.length} valid${valid.length && passes === valid.length ? " PASS" : valid.length ? " FAIL" : " NO VALID RUNS"}${tail}`);
    if (passes < valid.length) anyFailed = true;
    for (const [i, r] of valid.entries()) {
      if (r.grade && !r.grade.pass && i < 3) console.log(`    - ${r.grade.reason.slice(0, 220)}`);
    }

    if (setupFailure) {
      console.error(`\nStopped: ${stopped}\n  ${setupFailure.code}: ${setupFailure.message}\nCheck MODEL_PROVIDER, AGENT_MODEL and MODEL_BASE_URL against the models the server lists.`);
      setupFailed = true;
      break;
    }
    if (stopped) console.log(`    (stopped early: ${stopped})`);
  }

  report.duration_ms = Date.now() - suiteStart;
  report.usage_total = { agent: copyMeter(meter.agent) as Meter, judge: copyMeter(meter.judge) as Meter };
  const totals = aggregate(normalize(report));
  report.accounting = totals;

  const spent = report.usage_total;
  console.log(
    `\nRuns: ${totals.scheduled} scheduled, ${totals.valid} valid, ${totals.rate_limited} rate-limited, ` +
      `${totals.infrastructure} infrastructure, ${totals.execution_failure} other failures (${totals.attempts} attempts)`
  );
  console.log(
    `Model usage: agent ${spent.agent.calls} requests (${(spent.agent as Meter).rate_limited} answered 429), ` +
      `${spent.agent.input_tokens} in / ${spent.agent.output_tokens} out tokens; ` +
      `judge ${spent.judge.calls} requests. Wall time ${Math.round(report.duration_ms / 1000)}s.`
  );

  const outPath = arg("out") ?? path.join(root, "evals", "results", `${Date.now()}.json`);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\nReport written to ${outPath}`);

  process.exit(setupFailed ? 2 : anyFailed ? 1 : 0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
