/**
 * The guard is defense in depth, not the defense — but it is the layer that
 * catches an agent that misread a question, so its false-accept cases are the
 * ones that matter. Every "must reject" case below is a statement that would
 * have changed data if it slipped through.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { ApiError } from "@/lib/api/errors";
import {
  assertStatementAllowed,
  isReadOnly,
  splitStatements,
  stripLiterals,
} from "@/lib/connectors/sql-guard";

describe("isReadOnly — allows genuine reads", () => {
  const allowed = [
    "SELECT * FROM orders",
    "select id, total from orders where total > 100",
    "WITH recent AS (SELECT * FROM orders) SELECT * FROM recent",
    "EXPLAIN SELECT * FROM orders",
    "SHOW TABLES",
    "DESCRIBE orders",
    "VALUES (1), (2)",
    "TABLE orders",
    "  \n SELECT 1 \n ",
    "SELECT * FROM orders;",
  ];

  for (const sql of allowed) {
    test(sql.trim(), () => assert.equal(isReadOnly(sql), true));
  }
});

describe("isReadOnly — rejects writes", () => {
  const rejected: Array<[string, string]> = [
    ["DELETE FROM orders", "bare delete"],
    ["UPDATE orders SET total = 0", "bare update"],
    ["DROP TABLE orders", "drop"],
    ["TRUNCATE orders", "truncate"],
    ["INSERT INTO orders (id) VALUES (1)", "insert"],
    ["ALTER TABLE orders ADD COLUMN x int", "alter"],
    ["CREATE TABLE t (id int)", "create"],
    ["GRANT SELECT ON orders TO bob", "grant"],
    // Postgres data-modifying CTE: opens with an innocent WITH and deletes.
    [
      "WITH d AS (DELETE FROM orders RETURNING *) SELECT * FROM d",
      "data-modifying CTE",
    ],
    [
      "WITH u AS (UPDATE orders SET total = 0 RETURNING *) SELECT * FROM u",
      "updating CTE",
    ],
    // SELECT ... INTO writes a new table.
    ["SELECT * INTO backup FROM orders", "select into"],
    // Stacked statements.
    ["SELECT 1; DROP TABLE orders", "stacked statements"],
    ["SELECT 1;DELETE FROM orders", "stacked without space"],
    // EXPLAIN of a write.
    ["EXPLAIN DELETE FROM orders", "explain of a write"],
  ];

  for (const [sql, label] of rejected) {
    test(label, () => assert.equal(isReadOnly(sql), false));
  }

  test("empty input is not read-only", () => {
    assert.equal(isReadOnly(""), false);
    assert.equal(isReadOnly("   \n  "), false);
  });

  test("a comment alone is not read-only", () => {
    assert.equal(isReadOnly("-- just a note"), false);
  });
});

describe("isReadOnly — a write hidden behind a comment is still a write", () => {
  // The danger is the reverse of the usual one: `--` does not neutralize what
  // follows on the *next* line, so stripping the comment must not also strip
  // the statement hiding after it.
  test("newline ends the line comment, exposing the DROP", () => {
    assert.equal(isReadOnly("SELECT 1 -- harmless\nDROP TABLE orders"), false);
  });

  test("write after a commented-out semicolon", () => {
    assert.equal(isReadOnly("SELECT 1 -- ;\n; DELETE FROM orders"), false);
  });

  test("block comment does not hide a write", () => {
    assert.equal(isReadOnly("SELECT 1 /* nothing here */ ; DROP TABLE orders"), false);
  });

  test("a write commented out entirely is genuinely inert", () => {
    assert.equal(isReadOnly("SELECT * FROM orders -- DELETE FROM orders"), true);
    assert.equal(isReadOnly("SELECT * FROM orders /* DROP TABLE orders */"), true);
  });
});

describe("isReadOnly — not fooled by identifiers or literals", () => {
  test("a column named deleted_at is not a DELETE", () => {
    assert.equal(isReadOnly("SELECT deleted_at FROM orders WHERE deleted_at IS NULL"), true);
  });

  test("other keyword-prefixed identifiers survive", () => {
    assert.equal(isReadOnly("SELECT created_at, updated_at FROM orders"), true);
    assert.equal(isReadOnly("SELECT insert_id, drop_ship FROM orders"), true);
  });

  test("a quoted identifier that *is* a keyword is stripped, not scanned", () => {
    assert.equal(isReadOnly('SELECT "delete" FROM orders'), true);
    assert.equal(isReadOnly("SELECT `update` FROM orders"), true);
  });

  test("string literals containing write words are inert", () => {
    assert.equal(isReadOnly("SELECT * FROM logs WHERE action = 'delete'"), true);
    assert.equal(isReadOnly("SELECT 'please drop table orders' AS note"), true);
  });

  test("a semicolon inside a literal does not split the statement", () => {
    assert.equal(isReadOnly("SELECT * FROM logs WHERE note = 'a;b'"), true);
  });

  test("an escaped quote does not end the literal early", () => {
    // If the doubled quote terminated the string, `DROP` would escape the
    // literal and be scanned as SQL.
    assert.equal(isReadOnly("SELECT 'it''s fine' AS note"), true);
    assert.equal(isReadOnly("SELECT 'don''t DROP TABLE orders' AS note"), true);
    assert.equal(isReadOnly("SELECT 'back\\' DROP TABLE orders' AS note"), true);
  });
});

describe("stripLiterals", () => {
  test("removes line comments, block comments and quoted runs", () => {
    assert.equal(stripLiterals("SELECT 1 -- note\nFROM t").includes("note"), false);
    assert.equal(stripLiterals("SELECT /* note */ 1").includes("note"), false);
    assert.equal(stripLiterals("SELECT 'note'").includes("note"), false);
    assert.equal(stripLiterals('SELECT "note"').includes("note"), false);
  });

  test("leaves the surrounding SQL intact", () => {
    const stripped = stripLiterals("SELECT a FROM t WHERE b = 'x'");
    assert.match(stripped, /SELECT\s+a\s+FROM\s+t\s+WHERE\s+b\s+=/);
  });

  test("an unterminated literal swallows the rest rather than leaking it", () => {
    assert.equal(stripLiterals("SELECT 'unterminated DROP TABLE t").includes("DROP"), false);
  });
});

describe("splitStatements", () => {
  test("splits on real semicolons only", () => {
    assert.deepEqual(splitStatements("SELECT 1; SELECT 2"), ["SELECT 1", "SELECT 2"]);
  });

  test("ignores semicolons in literals and comments", () => {
    assert.equal(splitStatements("SELECT 'a;b'").length, 1);
    assert.equal(splitStatements("SELECT 1 -- a;b\n").length, 1);
  });

  test("drops empty trailing statements", () => {
    assert.deepEqual(splitStatements("SELECT 1;"), ["SELECT 1"]);
    assert.deepEqual(splitStatements("SELECT 1;;  ;"), ["SELECT 1"]);
    assert.deepEqual(splitStatements("   "), []);
  });
});

describe("assertStatementAllowed", () => {
  function codeOf(fn: () => void): string {
    try {
      fn();
    } catch (err) {
      assert.ok(err instanceof ApiError, `expected ApiError, got ${String(err)}`);
      return err.code;
    }
    return "<no throw>";
  }

  test("a read passes on a read-only connection", () => {
    assert.doesNotThrow(() => assertStatementAllowed("SELECT * FROM orders", false));
  });

  test("a write is rejected on a read-only connection", () => {
    assert.equal(
      codeOf(() => assertStatementAllowed("DELETE FROM orders", false)),
      "sql_not_read_only"
    );
  });

  test("a write passes when the connection allows writes", () => {
    assert.doesNotThrow(() => assertStatementAllowed("DELETE FROM orders", true));
  });

  test("stacked statements are rejected even when writes are allowed", () => {
    // Separate code from sql_not_read_only on purpose: the caller's fix is
    // "split this into separate requests", not "reconfigure the connection".
    assert.equal(
      codeOf(() => assertStatementAllowed("SELECT 1; SELECT 2", true)),
      "sql_multiple_statements"
    );
  });

  test("the multi-statement error reports the count", () => {
    try {
      assertStatementAllowed("SELECT 1; SELECT 2; SELECT 3", false);
      assert.fail("expected a throw");
    } catch (err) {
      assert.ok(err instanceof ApiError);
      assert.deepEqual(err.details, { statement_count: 3 });
    }
  });

  test("an empty statement is an invalid request", () => {
    assert.equal(codeOf(() => assertStatementAllowed("   ", false)), "invalid_request");
    assert.equal(codeOf(() => assertStatementAllowed(";", false)), "invalid_request");
  });

  test("rejections carry the 422 status the contract promises", () => {
    try {
      assertStatementAllowed("DROP TABLE orders", false);
      assert.fail("expected a throw");
    } catch (err) {
      assert.ok(err instanceof ApiError);
      assert.equal(err.status, 422);
    }
  });
});
