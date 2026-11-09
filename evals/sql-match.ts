/**
 * Does a query the model ran return what the reference query returns?
 *
 * Execution match, the way text-to-SQL benchmarks grade, with the leniency a real answer
 * needs: the model may add columns (a name beside an id, a count beside a category) and may
 * name or order columns as it likes. Every reference column must be matched by a distinct
 * column of the model's result, and the rows, projected onto those columns, must be the same
 * multiset — or the same sequence when the question asks for an order. Numbers compare at two
 * decimals, so 46720 and "46720.00" agree and an unrounded average matches a rounded one.
 */

import type { QueryResult } from "@/lib/connectors";

export function normalize(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number" || typeof value === "bigint") return formatNumber(Number(value));
  const text = String(value).trim();
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return formatNumber(Number(text));
  return text.toLowerCase();
}

function formatNumber(n: number): string {
  return String(Math.round(n * 100) / 100);
}

function columnValues(result: QueryResult, index: number): string[] {
  return result.rows.map((row) => normalize(row[index]));
}

function sameMultiset(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const x = [...a].sort();
  const y = [...b].sort();
  return x.every((v, i) => v === y[i]);
}

export type MatchResult = { pass: boolean; reason: string };

export function resultsMatch(reference: QueryResult, got: QueryResult, ordered: boolean): MatchResult {
  if (reference.rows.length !== got.rows.length) {
    return { pass: false, reason: `${got.rows.length} rows, expected ${reference.rows.length}` };
  }
  const refCols = reference.columns.map((_, i) => columnValues(reference, i));
  const gotCols = got.columns.map((_, i) => columnValues(got, i));
  // Columns of the model's result whose values could be this reference column at all.
  const candidates = refCols.map((ref) => gotCols.map((g, j) => (sameMultiset(ref, g) ? j : -1)).filter((j) => j >= 0));
  const missing = candidates.findIndex((c) => c.length === 0);
  if (missing >= 0) return { pass: false, reason: `no column holds the values of "${reference.columns[missing].name}"` };

  const rowsOf = (cols: string[][]) => cols[0]?.map((_, r) => cols.map((c) => c[r]).join("\u0001")) ?? [];
  const want = rowsOf(refCols);
  const chosen: number[] = [];
  const search = (k: number): boolean => {
    if (k === candidates.length) {
      const have = rowsOf(chosen.map((j) => gotCols[j]));
      return ordered ? have.every((row, i) => row === want[i]) : sameMultiset(have, want);
    }
    for (const j of candidates[k]) {
      if (chosen.includes(j)) continue;
      chosen.push(j);
      if (search(k + 1)) return true;
      chosen.pop();
    }
    return false;
  };
  if (reference.rows.length === 0 || search(0)) return { pass: true, reason: "the result matches the reference" };
  return { pass: false, reason: ordered ? "the right values, not in the order the question asks for, or not row-aligned" : "the columns hold the right values but not on the same rows" };
}
