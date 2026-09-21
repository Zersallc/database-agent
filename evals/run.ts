/**
 * Eval CLI. Not part of `npm test`: this makes real, billed, non-deterministic
 * model calls, so it is opt-in (`npm run eval`) and reports a pass rate per
 * case rather than a pass/fail verdict for the whole run.
 *
 * `--case=<id>`   run only cases whose id contains this substring (repeatable
 *                 by comma: --case=naming,date)
 * `--repeat=<n>`  runs per case (default 5)
 * `--out=<path>`  where to write the JSON report (default evals/results/<timestamp>.json)
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildRealClient, runCaseNTimes } from "./harness";
import { ALL_CASES } from "./cases/index";
import type { ModelClient, ModelRequest, ModelStreamEvent } from "@/lib/agent/providers/types";
import type { GradeResult } from "./types";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found?.slice(prefix.length);
}

type Meter = { calls: number; input_tokens: number; output_tokens: number };

const emptyMeter = (): Meter => ({ calls: 0, input_tokens: 0, output_tokens: 0 });
const copyMeter = (m: Meter): Meter => ({ ...m });
const diffMeter = (after: Meter, before: Meter): Meter => ({
  calls: after.calls - before.calls,
  input_tokens: after.input_tokens - before.input_tokens,
  output_tokens: after.output_tokens - before.output_tokens,
});

/**
 * Counts what a run really sends to and gets back from the model.
 *
 * The agent loop reports its own usage on the `completed` event, but a judge
 * call (`judge.ts`) and a rate-limited retry never show up there, so the
 * loop's figure understates what an eval run costs. Metering at the client
 * counts every request. A judge call is told apart from an agent call by
 * having no tools, which is how `judge.ts` makes them. `calls` counts
 * requests sent, including ones the provider rate limited, which return no
 * usage: it is load on the server, where the token counts are the work done.
 */
function meteredClient(client: ModelClient) {
  const agent = emptyMeter();
  const judge = emptyMeter();
  const metered: ModelClient = {
    kind: client.kind,
    model: client.model,
    probe: () => client.probe(),
    async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
      const bucket = request.tools.length > 0 ? agent : judge;
      bucket.calls += 1;
      for await (const event of client.stream(request)) {
        if (event.type === "turn" && event.turn.usage) {
          bucket.input_tokens += event.turn.usage.input_tokens;
          bucket.output_tokens += event.turn.usage.output_tokens;
        }
        yield event;
      }
    },
  };
  return { client: metered, agent, judge };
}

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

async function main() {
  const caseFilter = arg("case")?.split(",").map((s) => s.trim()).filter(Boolean);
  const repeat = Number(arg("repeat") ?? 5);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

  const cases = caseFilter
    ? ALL_CASES.filter((c) => caseFilter.some((f) => c.id.includes(f)))
    : ALL_CASES;

  if (cases.length === 0) {
    console.error(`No case id matches --case=${caseFilter?.join(",")}. Known ids: ${ALL_CASES.map((c) => c.id).join(", ")}`);
    process.exit(1);
  }

  const { client: realClient, label } = buildRealClient();
  const metered = meteredClient(realClient);
  const client = metered.client;
  console.log(`Running ${cases.length} case(s), ${repeat} repeat(s) each, against ${label}\n`);

  const report: {
    ranAt: string;
    model: string;
    label: string;
    repeat: number;
    env: ReturnType<typeof runEnvironment>;
    duration_ms: number;
    usage_total: { agent: Meter; judge: Meter };
    cases: {
      id: string;
      description: string;
      passRate: number;
      results: GradeResult[];
      duration_ms: number;
      usage: { agent: Meter; judge: Meter };
    }[];
  } = {
    ranAt: new Date().toISOString(),
    model: client.model,
    label,
    repeat,
    env: runEnvironment(),
    duration_ms: 0,
    usage_total: { agent: emptyMeter(), judge: emptyMeter() },
    cases: [],
  };
  const suiteStart = Date.now();

  let anyFailed = false;
  for (const kase of cases) {
    process.stdout.write(`${kase.id} ... `);
    const before = { agent: copyMeter(metered.agent), judge: copyMeter(metered.judge) };
    const caseStart = Date.now();
    const { passRate, results, failure } = await runCaseNTimes(kase, client, repeat);
    report.cases.push({
      id: kase.id,
      description: kase.description,
      passRate,
      results,
      duration_ms: Date.now() - caseStart,
      usage: {
        agent: diffMeter(metered.agent, before.agent),
        judge: diffMeter(metered.judge, before.judge),
      },
    });
    const pct = `${Math.round(passRate * 100)}%`;
    console.log(failure ? "ERROR" : passRate === 1 ? `PASS (${pct})` : `FAIL (${pct})`);
    if (passRate < 1) {
      anyFailed = true;
      for (const [i, r] of results.entries()) {
        if (!r.pass) console.log(`  run ${i + 1}: ${r.reason}`);
      }
    }

    /**
     * A run that never reached the model is a setup mistake, not a finding —
     * the same call `buildRealClient` makes about missing credentials, one
     * layer further in, where the wrong model name or an unreachable server
     * shows up. Stopping here costs one run to diagnose instead of the whole
     * suite reporting 0% for a reason that has nothing to do with any case.
     *
     * A rate limit reaches this only after the harness has already waited it
     * out and been pushed back again, so it is worth stopping on too — but it
     * says nothing about the configuration, and pointing at the model name
     * would send the reader after the wrong thing.
     */
    if (failure) {
      console.error(
        `\nStopped: the agent failed before answering, so nothing here measures model behavior.\n` +
          `  ${failure.code}: ${failure.message}\n` +
          (failure.retryAfter
            ? `The provider was still rate limiting after ${failure.retryAfter}s of backoff. ` +
              `Rerun the remaining cases when the server is quieter, or with a lower --repeat.`
            : `Check MODEL_PROVIDER, AGENT_MODEL and MODEL_BASE_URL against the models the server lists.`)
      );
      break;
    }
  }

  report.duration_ms = Date.now() - suiteStart;
  report.usage_total = { agent: copyMeter(metered.agent), judge: copyMeter(metered.judge) };
  const spent = report.usage_total;
  console.log(
    `\nModel usage: agent ${spent.agent.calls} requests, ${spent.agent.input_tokens} in / ${spent.agent.output_tokens} out tokens; ` +
      `judge ${spent.judge.calls} requests, ${spent.judge.input_tokens} in / ${spent.judge.output_tokens} out. ` +
      `Wall time ${Math.round(report.duration_ms / 1000)}s.`
  );

  const outPath = arg("out") ?? path.join(root, "evals", "results", `${Date.now()}.json`);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\nReport written to ${outPath}`);

  process.exit(anyFailed ? 1 : 0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
