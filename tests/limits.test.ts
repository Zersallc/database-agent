/**
 * The ceiling has to reach the database, so what matters is that the wrapper is
 * actually emitted for the statements that can return millions of rows — and
 * never emitted for the ones that would break if wrapped.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { applyRowCeiling } from "@/lib/connectors/limits";

describe("applyRowCeiling — wraps row-producing queries", () => {
  test("wraps a SELECT", () => {
    assert.equal(
      applyRowCeiling("SELECT * FROM orders", 100),
      "SELECT * FROM (SELECT * FROM orders) AS agent_result LIMIT 100"
    );
  });

  test("wraps a WITH", () => {
    assert.equal(
      applyRowCeiling("WITH recent AS (SELECT * FROM orders) SELECT * FROM recent", 50),
      "SELECT * FROM (WITH recent AS (SELECT * FROM orders) SELECT * FROM recent) AS agent_result LIMIT 50"
    );
  });

  test("wraps a bare TABLE", () => {
    assert.equal(
      applyRowCeiling("TABLE orders", 10),
      "SELECT * FROM (TABLE orders) AS agent_result LIMIT 10"
    );
  });

  test("is case-insensitive about the leading keyword", () => {
    assert.equal(
      applyRowCeiling("select 1", 5),
      "SELECT * FROM (select 1) AS agent_result LIMIT 5"
    );
    assert.equal(
      applyRowCeiling("SeLeCt 1", 5),
      "SELECT * FROM (SeLeCt 1) AS agent_result LIMIT 5"
    );
  });

  test("strips a trailing semicolon so the subquery stays valid", () => {
    assert.equal(
      applyRowCeiling("SELECT * FROM orders;", 25),
      "SELECT * FROM (SELECT * FROM orders) AS agent_result LIMIT 25"
    );
    // Whitespace *before* the semicolon survives, since the trim happens first.
    // Cosmetic only — the subquery is still valid.
    assert.equal(
      applyRowCeiling("SELECT * FROM orders ;  \n", 25),
      "SELECT * FROM (SELECT * FROM orders ) AS agent_result LIMIT 25"
    );
  });

  test("trims surrounding whitespace", () => {
    assert.equal(
      applyRowCeiling("\n  SELECT 1  \n", 5),
      "SELECT * FROM (SELECT 1) AS agent_result LIMIT 5"
    );
  });

  test("keeps an inner LIMIT, letting the more restrictive one win", () => {
    // The caller asked for 10; the ceiling is 100. Wrapping preserves the 10.
    assert.equal(
      applyRowCeiling("SELECT * FROM orders LIMIT 10", 100),
      "SELECT * FROM (SELECT * FROM orders LIMIT 10) AS agent_result LIMIT 100"
    );
  });

  test("floors a fractional limit rather than emitting invalid SQL", () => {
    assert.equal(
      applyRowCeiling("SELECT 1", 10.9),
      "SELECT * FROM (SELECT 1) AS agent_result LIMIT 10"
    );
  });
});

describe("applyRowCeiling — leaves un-wrappable statements alone", () => {
  const untouched = ["SHOW TABLES", "EXPLAIN SELECT * FROM orders", "DESCRIBE orders", "PRAGMA foo"];

  for (const sql of untouched) {
    test(sql, () => assert.equal(applyRowCeiling(sql, 10), sql));
  }

  test("SHOW keeps its exact original text, whitespace included", () => {
    assert.equal(applyRowCeiling("  SHOW TABLES  ", 10), "  SHOW TABLES  ");
  });

  test("multiple statements are returned unchanged", () => {
    // Wrapping would be nonsense here; the guard rejects this separately.
    const sql = "SELECT 1; SELECT 2";
    assert.equal(applyRowCeiling(sql, 10), sql);
  });

  test("an empty statement is returned unchanged", () => {
    assert.equal(applyRowCeiling("   ", 10), "   ");
  });
});
