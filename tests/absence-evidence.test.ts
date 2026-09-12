/**
 * Evidence for an absence.
 *
 * Reporting "there is none" is only honest when the value that matched nothing
 * was a value the database has. These cases are about telling those two apart —
 * and, as with every other check in this codebase, the cases that must NOT fire
 * are the ones carrying the weight: a legitimate empty finding that gets argued
 * with is worse than the bug being fixed.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { filterLiteralsIn, foundNothing, unvouchedLiterals, vouchedFrom } from "@/lib/agent/evidence";

const REAL = "Health or Hygiene or Ergonomic Hazards";

function vouching(...values: string[]): Set<string> {
  return new Set(values.map((value) => value.toLowerCase()));
}

describe("the values a query filtered on", () => {
  test("an equality filter is a claim about what the data contains", () => {
    assert.deepEqual(
      filterLiteralsIn(`SELECT * FROM o WHERE "SubClassification" = 'Health Hazards'`),
      ["Health Hazards"]
    );
  });

  test("a case-insensitive match is the same claim", () => {
    assert.deepEqual(
      filterLiteralsIn(`SELECT * FROM o WHERE "Status" ILIKE '%pending review%'`),
      ["pending review"]
    );
  });

  test("an IN list is several claims at once", () => {
    assert.deepEqual(
      filterLiteralsIn(`SELECT * FROM o WHERE "Category" IN ('Unsafe Act', 'Unsafe Condition')`),
      ["Unsafe Act", "Unsafe Condition"]
    );
  });

  test("a date that matched nothing really did match nothing", () => {
    // No alternative spelling of 2026-08-13 is hiding in the column, so this
    // must not be dragged back for verification.
    assert.deepEqual(
      filterLiteralsIn(`SELECT * FROM o WHERE "Date" >= '2026-08-01' AND "Date" < '2026-09-01'`),
      []
    );
  });

  test("a format string is machinery, not a claim", () => {
    // to_char's second argument is how the query works, not what it expects to
    // find. Scanning every literal instead of compared ones would flag it.
    assert.deepEqual(
      filterLiteralsIn(`SELECT to_char("Date", 'YYYY-MM') FROM o WHERE "n" = 4`),
      []
    );
  });

  test("an interval is machinery too", () => {
    assert.deepEqual(
      filterLiteralsIn(`SELECT * FROM o WHERE "Date" > now() - interval '30 days'`),
      []
    );
  });

  test("an escaped apostrophe survives the trip", () => {
    assert.deepEqual(filterLiteralsIn(`SELECT * FROM o WHERE "c" = 'Driver''s Hazards'`), [
      "Driver's Hazards",
    ]);
  });

  test("a pattern with nothing fixed in it is not looked up", () => {
    assert.deepEqual(filterLiteralsIn(`SELECT * FROM o WHERE "c" LIKE '%a%b%'`), []);
  });
});

describe("whether the database vouched for them", () => {
  test("the reader's phrasing, filtered on and matching nothing, is a guess", () => {
    assert.deepEqual(
      unvouchedLiterals(`SELECT * FROM o WHERE "c" = 'Health Hazards'`, vouching(REAL)),
      ["Health Hazards"]
    );
  });

  test("the real spelling is vouched for by the schema's list", () => {
    assert.deepEqual(
      unvouchedLiterals(`SELECT * FROM o WHERE "c" = '${REAL}'`, vouching(REAL)),
      []
    );
  });

  test("casing is not a difference the database cares about here", () => {
    assert.deepEqual(
      unvouchedLiterals(`SELECT * FROM o WHERE lower("c") = 'electrical hazards'`, vouching("Electrical Hazards")),
      []
    );
  });

  test("a pattern that found the real value is vouched for", () => {
    // '%health%' does occur in the real value, so this query reached the right
    // category and came back empty for some other reason — a real absence.
    assert.deepEqual(
      unvouchedLiterals(`SELECT * FROM o WHERE "c" ILIKE '%health%'`, vouching(REAL)),
      []
    );
  });

  test("a query with no value filter establishes absence on its own", () => {
    assert.deepEqual(unvouchedLiterals(`SELECT count(*) FROM o`, vouching()), []);
  });

  test("one bad value among good ones is still reported", () => {
    assert.deepEqual(
      unvouchedLiterals(
        `SELECT * FROM o WHERE "c" = '${REAL}' AND "Status" = 'Pending'`,
        vouching(REAL, "Open", "Closed")
      ),
      ["Pending"]
    );
  });
});

/**
 * Counting is how this question is usually asked, and a count that found
 * nothing still returns a row. Reading that row as data is what made the
 * contradiction check tell a model "the data is there" about a zero.
 */
describe("whether a result found anything", () => {
  test("no rows at all found nothing", () => {
    assert.equal(foundNothing([], 0), true);
  });

  test("a count of zero found nothing, whatever the row count says", () => {
    assert.equal(foundNothing([[0]], 1), true);
  });

  test("a count returned as a string found nothing either", () => {
    // node-postgres hands back bigint counts as strings.
    assert.equal(foundNothing([["0"]], 1), true);
  });

  test("an aggregate row of nulls found nothing", () => {
    assert.equal(foundNothing([[0, null, null]], 1), true);
  });

  test("a count of three found something", () => {
    assert.equal(foundNothing([[3]], 1), false);
  });

  test("one real row is something", () => {
    assert.equal(foundNothing([[REAL, 0]], 1), false);
  });

  test("many rows are something, even if one is blank", () => {
    assert.equal(foundNothing([[""], [REAL]], 2), false);
  });
});

describe("what a result adds to the record", () => {
  test("the values it returned can vouch for a later query", () => {
    assert.deepEqual(vouchedFrom([[REAL], ["Electrical Hazards"]]), [
      REAL.toLowerCase(),
      "electrical hazards",
    ]);
  });

  test("counts and nulls vouch for nothing", () => {
    assert.deepEqual(vouchedFrom([[42, null, new Date()]]), []);
  });

  test("a free-text comment does not vouch for every word in it", () => {
    // Otherwise any literal appearing anywhere in a narrative would count as
    // confirmed, and the check would go quiet exactly where text is richest.
    const comment = "Worker observed ".padEnd(200, "x");
    assert.deepEqual(vouchedFrom([[comment]]), []);
  });
});
