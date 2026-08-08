/**
 * Read-only enforcement for generated SQL.
 *
 * Read this first: **this is defense in depth, not the defense.** A parser-free
 * guard cannot be a security boundary against a determined adversary, and the
 * agent writes SQL from user text, so an adversary is in scope. The actual
 * protection is a database role that lacks write privileges. Configure that;
 * this guard exists to catch the ordinary case — an agent that misread a
 * question and produced a DELETE — before it reaches a connection whose role is
 * more permissive than it should be.
 *
 * The guard is deliberately conservative: anything it cannot prove is read-only
 * is rejected. A false rejection is an annoyance, a false acceptance is a
 * dropped table.
 */

import { ApiError } from "@/lib/api/errors";

/** Statements that may open a read-only query. */
const READ_ONLY_STARTS = new Set([
  "select",
  "with",
  "show",
  "explain",
  "describe",
  "desc",
  "table",
  "values",
  "pragma",
]);

/**
 * Words that mean a statement writes, wherever they appear.
 *
 * Position-independent on purpose: Postgres allows data-modifying CTEs, so
 * `WITH x AS (DELETE FROM orders RETURNING *) SELECT * FROM x` starts with a
 * perfectly innocent `WITH` and deletes your orders.
 */
const WRITE_KEYWORDS = [
  "insert",
  "update",
  "delete",
  "merge",
  "upsert",
  "drop",
  "truncate",
  "alter",
  "create",
  "replace",
  "grant",
  "revoke",
  "commit",
  "rollback",
  "savepoint",
  "vacuum",
  "analyze",
  "reindex",
  "cluster",
  "lock",
  "copy",
  "call",
  "do",
  "execute",
  "prepare",
  "set",
  "reset",
  "attach",
  "detach",
  "load",
  "unload",
  "refresh",
];

/**
 * Removes comments and string/identifier literals.
 *
 * Without this, a column called `"deleted_at"` or the text `'please delete'`
 * would trip the keyword scan, and — worse — `-- ` could be used to hide a
 * write from it.
 */
export function stripLiterals(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const char = sql[i];
    const next = sql[i + 1];

    if (char === "-" && next === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      out += " ";
      continue;
    }
    if (char === "/" && next === "*") {
      i += 2;
      while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
      i += 2;
      out += " ";
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      const quote = char;
      i++;
      while (i < sql.length) {
        if (sql[i] === "\\") {
          i += 2;
          continue;
        }
        // Doubled quote is an escaped quote, not a terminator.
        if (sql[i] === quote && sql[i + 1] === quote) {
          i += 2;
          continue;
        }
        if (sql[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      out += " ";
      continue;
    }

    out += char;
    i++;
  }
  return out;
}

/** Statements in the SQL, ignoring semicolons inside literals and comments. */
export function splitStatements(sql: string): string[] {
  return stripLiterals(sql)
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

export function isReadOnly(sql: string): boolean {
  const statements = splitStatements(sql);
  if (statements.length !== 1) return false;

  const [statement] = statements;
  const words: string[] = statement.toLowerCase().match(/[a-z_]+/g) ?? [];
  if (words.length === 0) return false;
  if (!READ_ONLY_STARTS.has(words[0])) return false;

  // `EXPLAIN DELETE …` executes nothing on most engines but not all, and
  // `SELECT … INTO` writes a table. Neither is worth allowing.
  const wordSet = new Set(words.slice(1));
  if (WRITE_KEYWORDS.some((keyword) => wordSet.has(keyword))) return false;
  if (wordSet.has("into")) return false;

  return true;
}

/**
 * Throws unless the statement may run on this connection.
 *
 * The two rejections are separate error codes because they mean different
 * things to the caller: one is "you need a differently configured connection",
 * the other is "split this into separate requests".
 */
export function assertStatementAllowed(sql: string, allowWrites: boolean): void {
  const statements = splitStatements(sql);

  if (statements.length === 0) {
    throw new ApiError("invalid_request", "The 'sql' field contains no statement to run.");
  }
  if (statements.length > 1) {
    throw new ApiError(
      "sql_multiple_statements",
      `Send one statement per request; this contained ${statements.length}. Batching them hides which one failed and makes the result set ambiguous.`,
      { details: { statement_count: statements.length } }
    );
  }
  if (!allowWrites && !isReadOnly(sql)) {
    throw new ApiError(
      "sql_not_read_only",
      "This connection is read-only and the statement is not provably a read. Enable 'allow_writes' on the connection if writes are intended — and make sure its database role actually permits them.",
      { details: { allow_writes: false } }
    );
  }
}
