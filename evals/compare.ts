/**
 * Sets eval reports beside each other and, above all, beside the A0 baseline.
 *
 *   npx tsx evals/compare.ts --baseline=evals/results/baseline-pre-media.json \
 *       --reports=evals/results/a3-legacy.json,evals/results/a3-media.json
 *
 * It prints, for each report, how its runs ended (so a busy gateway is never
 * read as a model failure), then for the original cases a like-for-like
 * comparison with the baseline, then the media families, then what it cost.
 *
 * Ten runs is a small sample, so every comparison carries an interval and an
 * exact test. A drop from 10/10 to 8/10 is what chance does about half the time
 * and is not reported as a regression; the tables say so.
 */

import path from "node:path";

import { aggregate, byFamily, loadReport, normalize, type Aggregate, type NormalCase } from "./report";
import { fisherExact, percent, wilson } from "./stats";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

const rate = (k: number, n: number) => (n === 0 ? "n/a" : percent(k / n));
const pad = (text: string | number, width: number) => String(text).padEnd(width);
const padLeft = (text: string | number, width: number) => String(text).padStart(width);

function interval(k: number, n: number): string {
  if (n === 0) return "";
  const { low, high } = wilson(k, n);
  return `(${percent(low)}–${percent(high)})`;
}

function accounting(name: string, totals: Aggregate) {
  console.log(`\n${name}`);
  console.log(`  scheduled runs        ${totals.scheduled}   (${totals.attempts} attempts)`);
  console.log(`  ├─ valid              ${totals.valid}`);
  console.log(`  ├─ rate limited       ${totals.rate_limited}`);
  console.log(`  ├─ infrastructure     ${totals.infrastructure}`);
  console.log(`  └─ other failure      ${totals.execution_failure}`);
  console.log(`  among valid runs      ${totals.valid}`);
  console.log(`  ├─ passed             ${totals.passed} (${rate(totals.passed, totals.valid)})`);
  console.log(`  ├─ failed             ${totals.failed}, by primary cause: ${Object.entries(totals.failed_primary).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(", ") || "none"}`);
  console.log(`  ├─ routed as expected ${totals.routed_as_expected} (${rate(totals.routed_as_expected, totals.valid)})`);
  console.log(`  ├─ documents retrieved ${totals.documents_retrieved}: block delivered ${totals.block_delivered}, written unprompted ${totals.block_first_try}, corrective retry ${totals.provenance_retry}`);
  console.log(`  └─ requests           ${totals.requests} (${totals.rate_limited_requests} answered 429); ${totals.input_tokens} in / ${totals.output_tokens} out tokens; ${Math.round(totals.duration_ms / 1000)}s`);
}

function legacyTable(baseline: NormalCase[], name: string, cases: NormalCase[]) {
  const before = new Map(baseline.filter((c) => c.family === "legacy").map((c) => [c.id, c]));
  const rows = cases.filter((c) => c.family === "legacy" && before.has(c.id));
  if (rows.length === 0) return;

  console.log(`\nThe original cases against the A0 baseline — ${name}`);
  console.log(`${pad("case", 38)} ${pad("A0", 8)} ${pad("now (valid runs)", 24)} ${pad("p", 6)} verdict`);
  let differing = 0;
  for (const row of rows) {
    const a = before.get(row.id)!;
    const aValid = a.runs.filter((r) => r.status === "valid");
    const bValid = row.runs.filter((r) => r.status === "valid");
    const aPass = aValid.filter((r) => r.grade?.pass).length;
    const bPass = bValid.filter((r) => r.grade?.pass).length;
    const p = fisherExact({ pass: aPass, n: aValid.length }, { pass: bPass, n: bValid.length });
    const verdict = bValid.length === 0 ? "no valid runs" : bPass / bValid.length >= aPass / aValid.length ? "same or better" : p < 0.1 ? "LOWER, unlikely to be chance" : "lower, within chance";
    if (verdict.startsWith("LOWER")) differing += 1;
    console.log(`${pad(row.id, 38)} ${pad(`${aPass}/${aValid.length}`, 8)} ${pad(`${bPass}/${bValid.length} ${interval(bPass, bValid.length)}`, 24)} ${pad(p.toFixed(2), 6)} ${verdict}`);
  }
  const aAll = rows.flatMap((row) => before.get(row.id)!.runs.filter((r) => r.status === "valid"));
  const bAll = rows.flatMap((row) => row.runs.filter((r) => r.status === "valid"));
  const aPass = aAll.filter((r) => r.grade?.pass).length;
  const bPass = bAll.filter((r) => r.grade?.pass).length;
  console.log(`${pad("ALL", 38)} ${pad(`${aPass}/${aAll.length}`, 8)} ${pad(`${bPass}/${bAll.length} ${interval(bPass, bAll.length)}`, 24)} ${pad(fisherExact({ pass: aPass, n: aAll.length }, { pass: bPass, n: bAll.length }).toFixed(2), 6)} ${differing === 0 ? "no case is lower beyond chance" : `${differing} case(s) lower beyond chance`}`);
}

function familyTable(name: string, cases: NormalCase[]) {
  const media = cases.filter((c) => c.family !== "legacy");
  if (media.length === 0) return;

  console.log(`\nMedia families — ${name}`);
  console.log(`${pad("family", 24)} ${padLeft("valid", 5)} ${padLeft("pass", 6)} ${pad("", 11)} ${padLeft("routed", 7)} ${padLeft("unneeded", 9)} ${padLeft("missing", 8)}  failed by (primary cause)`);
  for (const [family, group] of byFamily(media)) {
    const t = aggregate(group);
    const failed = Object.entries(t.failed_primary).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(", ") || "—";
    console.log(
      `${pad(family, 24)} ${padLeft(t.valid, 5)} ${padLeft(rate(t.passed, t.valid), 6)} ${pad(interval(t.passed, t.valid), 11)} ${padLeft(rate(t.routed_as_expected, t.valid), 7)} ` +
        `${padLeft(t.with_expectation ? rate(t.unnecessary, t.with_expectation) : "n/a", 9)} ${padLeft(t.with_expectation ? rate(t.missing, t.with_expectation) : "n/a", 8)}  ${failed}` +
        `${t.rate_limited + t.infrastructure + t.execution_failure ? `   [not measured: ${t.rate_limited} rate-limited, ${t.infrastructure} infrastructure, ${t.execution_failure} other]` : ""}`
    );
  }

  console.log(`\n${pad("case", 42)} ${padLeft("valid", 5)} ${padLeft("pass", 7)} ${padLeft("unneeded", 9)}  first tool → tools`);
  for (const kase of media) {
    const t = aggregate([kase]);
    const shapes = new Map<string, number>();
    for (const run of kase.runs.filter((r) => r.status === "valid")) {
      const shape = run.tools.length ? run.tools.map((tool) => (tool === "run_sql" ? "sql" : "search")).join("+") : run.ended_in_question ? "asked" : "no tools";
      shapes.set(shape, (shapes.get(shape) ?? 0) + 1);
    }
    const shapeText = [...shapes.entries()].sort((a, b) => b[1] - a[1]).map(([shape, n]) => `${shape} ×${n}`).join(", ");
    console.log(`${pad(kase.id, 42)} ${padLeft(t.valid, 5)} ${padLeft(`${t.passed}/${t.valid}`, 7)} ${padLeft(t.with_expectation ? `${t.unnecessary}/${t.with_expectation}` : "n/a", 9)}  ${shapeText}`);
  }
}

function provenanceTable(name: string, cases: NormalCase[]) {
  const t = aggregate(cases.filter((c) => c.family !== "legacy"));
  if (t.documents_retrieved === 0) return;
  console.log(`\nProvenance — ${name}`);
  console.log(`  runs that retrieved documents          ${t.documents_retrieved}`);
  console.log(`  delivered answer ends with a block     ${t.block_delivered} (${rate(t.block_delivered, t.documents_retrieved)} ${interval(t.block_delivered, t.documents_retrieved)})`);
  console.log(`  model wrote a valid block unprompted   ${t.block_first_try} (${rate(t.block_first_try, t.documents_retrieved)})`);
  console.log(`  corrective retry fired                 ${t.provenance_retry} (${rate(t.provenance_retry, t.documents_retrieved)} ${interval(t.provenance_retry, t.documents_retrieved)})`);
  console.log(`  failures (any check): generation ${t.failed_by.provenance_generation}, sanitization ${t.failed_by.provenance_sanitization}, rendering ${t.failed_by.rendering}`);
}

function main() {
  const baselinePath = arg("baseline");
  const reportPaths = (arg("reports") ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  if (reportPaths.length === 0) {
    console.error("usage: compare.ts [--baseline=<report.json>] --reports=<a.json>,<b.json>");
    process.exit(1);
  }

  const baseline = baselinePath ? normalize(loadReport(baselinePath)) : null;
  if (baselinePath && baseline) {
    const raw = loadReport(baselinePath);
    accounting(`BASELINE ${path.basename(baselinePath)} (${raw.env?.commit?.slice(0, 7) ?? "?"}, ${raw.model})`, aggregate(baseline));
  }

  for (const reportPath of reportPaths) {
    const raw = loadReport(reportPath);
    const cases = normalize(raw);
    const name = `${raw.label ?? path.basename(reportPath)} (${raw.env?.commit?.slice(0, 7) ?? "?"})`;
    accounting(name.toUpperCase(), aggregate(cases));
    if (baseline) legacyTable(baseline, name, cases);
    familyTable(name, cases);
    provenanceTable(name, cases);
  }

  if (baseline) {
    const perRun = (t: Aggregate) => ({ requests: t.requests / Math.max(1, t.valid), input: t.input_tokens / Math.max(1, t.requests), output: t.output_tokens / Math.max(1, t.requests) });
    const base = perRun(aggregate(baseline));
    console.log("\nCost per valid run and per request");
    console.log(`  baseline: ${base.requests.toFixed(2)} requests/run, ${Math.round(base.input)} in / ${Math.round(base.output)} out tokens per request`);
    for (const reportPath of reportPaths) {
      const raw = loadReport(reportPath);
      const now = perRun(aggregate(normalize(raw)));
      console.log(`  ${pad(raw.label ?? path.basename(reportPath), 28)} ${now.requests.toFixed(2)} requests/run, ${Math.round(now.input)} in / ${Math.round(now.output)} out tokens per request`);
    }
  }
}

main();
