/**
 * The query timeout has to reach Postgres as a session setting. It used to be
 * `SET LOCAL`, which Postgres ignores outside a transaction (with a warning),
 * so model-written queries ran with no server-side limit at all.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { PostgresConnector } from "@/lib/connectors/postgres";

test("execute sets a session-level statement_timeout before the query", async () => {
  const sent: string[] = [];
  const connector = new PostgresConnector({ credentials: {}, maxRows: 10 } as never);
  // connect() returns an existing client as is, so a stub stands in for pg.
  (connector as unknown as { client: unknown }).client = {
    async query(q: string | { text: string }) {
      sent.push(typeof q === "string" ? q : q.text);
      return { rows: [], fields: [] };
    },
  };

  await connector.execute("SELECT 1", { timeoutMs: 15000.7 });

  assert.equal(sent[0], "SET statement_timeout = 15000");
  assert.ok(!sent.some((q) => /SET LOCAL/i.test(q)));
  assert.match(sent[1], /SELECT 1/);
});
