/**
 * Builds the A3 analysis report from completed eval results.
 *
 *   npx tsx evals/analyze.ts --out=evals/results/a3-analysis.md --json=evals/results/a3-analysis.json
 *
 * `--manifest=<json>`   a list of { role, path, title, note? } replacing the default
 *                       (evals/analysis/manifest.ts)
 * `--out=<path>`        write the Markdown report here (default: print it)
 * `--json=<path>`       also write the measurements as JSON
 * `--tier-a=<json>`     the totals of the Tier A run, { command, ranAt, tests, passed,
 *                       failed, skipped }; without it the Tier A section says TBD
 * `--generated-at=<t>`  the timestamp to print, so a report can be reproduced exactly
 *
 * This reads result files and writes a report. It never runs a model, never opens
 * a result file for writing, and does not touch the A0 baseline. A role whose file
 * does not exist yet is shown as TBD.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { LEGACY_CASES, LIVE_CASES, MEDIA_CASES } from "./cases/index";
import { renderReport, type TierA } from "./analysis/document";
import { DEFAULT_MANIFEST, loadResults, type ManifestEntry } from "./analysis/manifest";
import type { Expectation } from "./analysis/metrics";
import { analysisSummary } from "./analysis/summary";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** What each case declares it needs, from the case definitions, never from what a run did. */
function expectationsFromCases(): Map<string, Expectation> {
  const found = new Map<string, Expectation>();
  for (const kase of [...LEGACY_CASES, ...MEDIA_CASES, ...LIVE_CASES]) {
    if (kase.sources) found.set(kase.id, { required: [...kase.sources.required], allowed: [...(kase.sources.allowed ?? [])] });
  }
  return found;
}

function main() {
  const manifestPath = arg("manifest");
  const manifest: ManifestEntry[] = manifestPath ? JSON.parse(readFileSync(path.resolve(root, manifestPath), "utf8")) : DEFAULT_MANIFEST;
  const tierAPath = arg("tier-a");
  const tierA: TierA | null = tierAPath ? JSON.parse(readFileSync(path.resolve(root, tierAPath), "utf8")) : null;
  const generatedAt = arg("generated-at") ?? new Date().toISOString();

  const results = loadResults(manifest, (relative) => {
    const file = path.resolve(root, relative);
    return existsSync(file) ? readFileSync(file, "utf8") : null;
  });
  const expectations = expectationsFromCases();

  const report = renderReport({ results, expectations, tierA, generatedAt });
  const out = arg("out");
  if (out) {
    mkdirSync(path.dirname(path.resolve(root, out)), { recursive: true });
    writeFileSync(path.resolve(root, out), report);
    console.log(`Report written to ${out}`);
  } else {
    console.log(report);
  }

  const json = arg("json");
  if (json) {
    mkdirSync(path.dirname(path.resolve(root, json)), { recursive: true });
    writeFileSync(path.resolve(root, json), JSON.stringify(analysisSummary(results, expectations, generatedAt), null, 2));
    console.log(`Measurements written to ${json}`);
  }
}

main();
