/**
 * The result matcher behind the SQL cases (evals/sql-match.ts), and the static shape of those
 * cases. No database or model: a wrong matcher would grade every model wrongly in the same way.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { resultsMatch } from "@/evals/sql-match";
import { SQL_QUESTIONS } from "@/evals/cases/sql-known-answer.eval";
import type { QueryResult } from "@/lib/connectors";

const result = (columns: string[], rows: unknown[][]): QueryResult => ({
  columns: columns.map((name) => ({ name, data_type: null })),
  rows,
  row_count: rows.length,
  truncated: false,
  duration_ms: 1,
});

const REF = result(["region", "sum"], [["North", "1200.50"], ["South", "980.00"]]);

test("same values, other column names, other row order: a match when order does not matter", () => {
  assert.ok(resultsMatch(REF, result(["Region", "revenue"], [["South", 980], ["north", 1200.5]]), false).pass);
});

test("an extra column the model added is allowed", () => {
  assert.ok(resultsMatch(REF, result(["id", "region", "orders", "total"], [[2, "South", 7, 980], [1, "North", 9, 1200.5]]), false).pass);
});

test("an unrounded average matches a rounded one", () => {
  const ref = result(["avg"], [["432.123456"]]);
  assert.ok(resultsMatch(ref, result(["average"], [[432.12]]), false).pass);
});

test("a wrong number fails", () => {
  assert.equal(resultsMatch(REF, result(["region", "sum"], [["North", 1200.5], ["South", 981]]), false).pass, false);
});

test("a missing row fails", () => {
  assert.equal(resultsMatch(REF, result(["region", "sum"], [["North", 1200.5]]), false).pass, false);
});

test("right values on the wrong rows fail", () => {
  assert.equal(resultsMatch(REF, result(["region", "sum"], [["North", 980], ["South", 1200.5]]), false).pass, false);
});

test("when order matters, the reverse order fails and the same order passes", () => {
  const reversed = result(["region", "sum"], [["South", 980], ["North", 1200.5]]);
  assert.equal(resultsMatch(REF, reversed, true).pass, false);
  assert.ok(resultsMatch(REF, result(["r", "s"], [["North", 1200.5], ["South", 980]]), true).pass);
});

test("NULL only matches NULL", () => {
  const ref = result(["fee"], [[null], ["2.5"]]);
  assert.ok(resultsMatch(ref, result(["fee"], [["2.50"], [null]]), false).pass);
  assert.equal(resultsMatch(ref, result(["fee"], [[0], ["2.5"]]), false).pass, false);
});

test("an empty reference matches only an empty result", () => {
  const ref = result(["name"], []);
  assert.ok(resultsMatch(ref, result(["customer"], []), false).pass);
  assert.equal(resultsMatch(ref, result(["customer"], [["Acme"]]), false).pass, false);
});

test("two reference columns cannot both be matched by the same model column", () => {
  const ref = result(["a", "b"], [["1", "1"], ["2", "2"]]);
  assert.equal(resultsMatch(ref, result(["x"], [[1], [2]]), false).pass, false);
});

test("every SQL question has a unique id and a reference, and only the unanswerable one lacks a real query", () => {
  const ids = SQL_QUESTIONS.map((q) => q.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const q of SQL_QUESTIONS) {
    assert.ok(q.id.startsWith("sql-"), q.id);
    assert.ok(q.reference.trim().length > 0, q.id);
    if (!q.unanswerable) assert.match(q.reference, /\bFROM\b/i, q.id);
  }
});
