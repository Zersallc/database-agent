/**
 * Case-by-case summaries, and the comparison of one pass with another.
 *
 * Repeating the media suite is what says whether a result is the model's
 * behavior or a draw of ten runs. So the two passes are set side by side on
 * every dimension that matters, never merged: an average of a pass that searched
 * six times in ten and one that searched three times in ten is "half", which
 * describes neither. The comparison reports both counts, whether the observed
 * counts differ, and Fisher's exact p for the pass rate. That p is descriptive:
 * it says how surprising the difference would be if both passes had one
 * underlying rate, and is not an acceptance threshold.
 */

import { fisherExact } from "../stats";
import type { NormalCase } from "../report";
import type { FailureCategory } from "../types";

import {
  behavior,
  failureAccounting,
  frac,
  passes,
  provenance,
  retries,
  searchRate,
  validRuns,
  type Frac,
  type Shape,
} from "./metrics";

export type CaseSummary = {
  caseId: string;
  family: string;
  scheduled: number;
  valid: number;
  /** Scheduled runs that never reached the model: rate limited, infrastructure, or another execution failure. */
  notMeasured: number;
  passed: Frac;
  /** Null when the report has no run-level detail. */
  searched: Frac | null;
  routedRight: Frac | null;
  /** Failed valid runs by primary cause. */
  primary: Record<FailureCategory, number>;
  kindNotRecorded: number;
  shapes: Record<Shape, number> | null;
  provenance: { runsWithDocuments: number; blockDelivered: number; unprompted: number; failedAnyCheck: number } | null;
  retries: { provenance: Frac; other: Frac } | null;
};

export function summarizeCase(kase: NormalCase): CaseSummary {
  const one = [kase];
  const valid = validRuns(one);
  const accounting = failureAccounting(one);
  const detailed = kase.detailed;
  const prov = provenance(one);
  const failedAny = detailed
    ? valid.filter(({ run }) =>
        run.documents_retrieved && run.failure_categories.some((category) => ["provenance_generation", "provenance_sanitization", "rendering"].includes(category))
      ).length
    : 0;

  return {
    caseId: kase.id,
    family: kase.family,
    scheduled: kase.scheduled,
    valid: valid.length,
    notMeasured: kase.scheduled - valid.length,
    passed: passes(one),
    searched: detailed ? searchRate(one) : null,
    routedRight: detailed ? frac(valid.filter(({ run }) => !run.failure_categories.includes("routing")).length, valid.length) : null,
    primary: accounting.primary,
    kindNotRecorded: accounting.kindNotRecorded,
    shapes: detailed ? behavior(one).shapes : null,
    provenance: detailed ? { runsWithDocuments: prov.runsWithDocuments, blockDelivered: prov.blockDelivered, unprompted: prov.unprompted, failedAnyCheck: failedAny } : null,
    retries: detailed ? retries(one) : null,
  };
}

export type RepeatRow = {
  caseId: string;
  family: string;
  first: CaseSummary | null;
  second: CaseSummary | null;
  /** Fisher's exact p for the pass rate, when both passes have valid runs. Descriptive only. */
  passP: number | null;
  /** The dimensions on which the observed counts differ. Any difference, not a significant one. */
  differsIn: string[];
};

const sameFrac = (a: Frac | null | undefined, b: Frac | null | undefined) => (a && b ? a.k === b.k && a.n === b.n : a === b);

export function compareShapes(a: CaseSummary["shapes"], b: CaseSummary["shapes"]): boolean {
  if (!a || !b) return a === b;
  return (Object.keys(a) as Shape[]).every((shape) => a[shape] === b[shape]);
}

export function compareCauses(a: CaseSummary["primary"], b: CaseSummary["primary"]): boolean {
  return (Object.keys(a) as FailureCategory[]).every((category) => a[category] === b[category]);
}

/**
 * The two passes over the same cases. A case in only one pass is listed with the
 * other side empty, which is a difference in itself.
 */
export function comparePasses(first: NormalCase[], second: NormalCase[]): RepeatRow[] {
  const a = new Map(first.map((kase) => [kase.id, kase]));
  const b = new Map(second.map((kase) => [kase.id, kase]));
  const ids = [...new Set([...a.keys(), ...b.keys()])];

  return ids.map((id) => {
    const left = a.has(id) ? summarizeCase(a.get(id)!) : null;
    const right = b.has(id) ? summarizeCase(b.get(id)!) : null;
    const differsIn: string[] = [];
    let passP: number | null = null;

    if (left && right) {
      if (!sameFrac(left.passed, right.passed)) differsIn.push("pass count");
      if (!sameFrac(left.searched, right.searched)) differsIn.push("search rate");
      if (!sameFrac(left.routedRight, right.routedRight)) differsIn.push("routing");
      if (!compareShapes(left.shapes, right.shapes)) differsIn.push("tool pattern");
      if (!compareCauses(left.primary, right.primary)) differsIn.push("primary cause");
      const lp = left.provenance;
      const rp = right.provenance;
      if (JSON.stringify(lp) !== JSON.stringify(rp)) differsIn.push("provenance");
      if (JSON.stringify(left.retries) !== JSON.stringify(right.retries)) differsIn.push("retries");
      if (left.valid > 0 && right.valid > 0) {
        passP = fisherExact({ pass: left.passed.k, n: left.passed.n }, { pass: right.passed.k, n: right.passed.n });
      }
    } else {
      differsIn.push(left ? "missing from the second pass" : "missing from the first pass");
    }
    return { caseId: id, family: (left ?? right)!.family, first: left, second: right, passP, differsIn };
  });
}
