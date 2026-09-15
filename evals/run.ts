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

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildRealClient, runCaseNTimes } from "./harness";
import { ALL_CASES } from "./cases/index";
import type { GradeResult } from "./types";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found?.slice(prefix.length);
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

  const { client, label } = buildRealClient();
  console.log(`Running ${cases.length} case(s), ${repeat} repeat(s) each, against ${label}\n`);

  const report: {
    ranAt: string;
    model: string;
    label: string;
    repeat: number;
    cases: { id: string; description: string; passRate: number; results: GradeResult[] }[];
  } = {
    ranAt: new Date().toISOString(),
    model: client.model,
    label,
    repeat,
    cases: [],
  };

  let anyFailed = false;
  for (const kase of cases) {
    process.stdout.write(`${kase.id} ... `);
    const { passRate, results } = await runCaseNTimes(kase, client, repeat);
    report.cases.push({ id: kase.id, description: kase.description, passRate, results });
    const pct = `${Math.round(passRate * 100)}%`;
    console.log(passRate === 1 ? `PASS (${pct})` : `FAIL (${pct})`);
    if (passRate < 1) {
      anyFailed = true;
      for (const [i, r] of results.entries()) {
        if (!r.pass) console.log(`  run ${i + 1}: ${r.reason}`);
      }
    }
  }

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
