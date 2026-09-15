/**
 * Routing a `run_sql` call to the right connection.
 *
 * `dc072b9` gave the agent every one of the workspace's databases at once
 * instead of one pre-selected connection, so `database` on the tool call is
 * the only thing standing between a question and the wrong table on the
 * wrong database. Nothing exercised that dispatch directly before this file.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { runAgent, type AgentEvent } from "@/lib/agent";
import type {
  ModelClient,
  ModelRequest,
  ModelStreamEvent,
  ToolCall,
} from "@/lib/agent/providers/types";

/** A model that replies with a scripted turn each time it is called. */
function scriptedClient(
  turns: { text: string; toolCalls?: ToolCall[] }[]
): ModelClient & { requests: ModelRequest[] } {
  const requests: ModelRequest[] = [];
  let index = 0;
  return {
    kind: "openai_compatible",
    model: "test-model",
    requests,
    async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
      // Copied, not referenced: the loop keeps appending to the same `messages`
      // array, so a stored reference would show every later turn's additions.
      requests.push({ ...request, messages: [...request.messages] });
      const turn = turns[Math.min(index, turns.length - 1)];
      index += 1;
      yield { type: "text_delta", text: turn.text };
      yield {
        type: "turn",
        turn: {
          text: turn.text,
          toolCalls: turn.toolCalls ?? [],
          stopReason: turn.toolCalls?.length ? "tool_use" : "end_turn",
          refusalDetail: null,
          usage: { input_tokens: 1, output_tokens: 1 },
          model: "test-model",
        },
      };
    },
    async probe() {
      return { ok: true, latency_ms: 1, detail: null, model_available: true };
    },
  } as ModelClient & { requests: ModelRequest[] };
}

/** A connection that counts how many times it was queried, and with what SQL. */
function connectionNamed(name: string) {
  const calls: string[] = [];
  const conn = {
    id: `conn_${name}`,
    name,
    engine: "postgres",
    schema: null,
    execute: async (sql: string) => {
      calls.push(sql);
      return {
        queryId: `qry_${calls.length}`,
        result: { columns: [], rows: [], row_count: 0, truncated: false, duration_ms: 1 },
      };
    },
  };
  return { conn, calls };
}

function call(id: string, input: Record<string, unknown>): ToolCall {
  return { id, name: "run_sql", input };
}

async function runWith(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  connections: any[],
  turns: { text: string; toolCalls?: ToolCall[] }[],
  question = "how many rows are there?"
) {
  const client = scriptedClient(turns);
  const events: AgentEvent[] = [];
  for await (const event of runAgent({
    question,
    history: [],
    playbookContext: "",
    responseDetail: "balanced",
    connections,
    client,
    reportGenerator: null,
  })) {
    events.push(event);
  }
  return { events, client };
}

describe("routing run_sql across several connections", () => {
  test("an exact database name routes to that connection only", async () => {
    const primary = connectionNamed("Primary");
    const marketing = connectionNamed("Marketing DB");

    await runWith([primary.conn, marketing.conn], [
      { text: "", toolCalls: [call("c1", { database: "Marketing DB", sql: "SELECT 1", purpose: "check" })] },
      { text: "Done." },
    ]);

    assert.equal(marketing.calls.length, 1, "the named connection should be queried");
    assert.equal(primary.calls.length, 0, "the other connection must not be touched");
  });

  test("routing is case-insensitive on the database name", async () => {
    const primary = connectionNamed("Primary");
    const marketing = connectionNamed("Marketing DB");

    await runWith([primary.conn, marketing.conn], [
      { text: "", toolCalls: [call("c1", { database: "marketing db", sql: "SELECT 1", purpose: "check" })] },
      { text: "Done." },
    ]);

    assert.equal(marketing.calls.length, 1, "a differently-cased name should still match");
    assert.equal(primary.calls.length, 0);
  });

  test("an unknown database name reaches neither connection", async () => {
    const primary = connectionNamed("Primary");
    const marketing = connectionNamed("Marketing DB");

    const { client } = await runWith([primary.conn, marketing.conn], [
      { text: "", toolCalls: [call("c1", { database: "Nonexistent", sql: "SELECT 1", purpose: "check" })] },
      { text: "Done." },
    ]);

    assert.equal(primary.calls.length, 0);
    assert.equal(marketing.calls.length, 0);
    const toolResult = client.requests[1].messages.find((m) => m.role === "tool");
    assert.match(String(toolResult?.content), /No database named "Nonexistent"/);
    assert.match(String(toolResult?.content), /Primary/);
    assert.match(String(toolResult?.content), /Marketing DB/);
  });

  test("two queries in one turn route independently to their own connections", async () => {
    const primary = connectionNamed("Primary");
    const marketing = connectionNamed("Marketing DB");

    await runWith([primary.conn, marketing.conn], [
      {
        text: "",
        toolCalls: [
          call("c1", { database: "Primary", sql: "SELECT 1", purpose: "a" }),
          call("c2", { database: "Marketing DB", sql: "SELECT 2", purpose: "b" }),
        ],
      },
      { text: "Done." },
    ]);

    assert.equal(primary.calls.length, 1);
    assert.equal(marketing.calls.length, 1);
    assert.equal(primary.calls[0], "SELECT 1");
    assert.equal(marketing.calls[0], "SELECT 2");
  });

  test("a single connection is never asked to name a database", async () => {
    const only = connectionNamed("Only DB");

    const { client } = await runWith([only.conn], [
      { text: "", toolCalls: [call("c1", { sql: "SELECT 1", purpose: "check" })] },
      { text: "Done." },
    ]);

    const params = client.requests[0].tools[0].parameters as {
      properties: Record<string, unknown>;
      required: string[];
    };
    assert.equal("database" in params.properties, false, "no selector when there is nothing to select");
    assert.deepEqual(params.required, ["sql", "purpose"]);
    assert.equal(only.calls.length, 1, "the one connection still gets queried");
  });

  test("more than one connection requires naming the database", async () => {
    const primary = connectionNamed("Primary");
    const marketing = connectionNamed("Marketing DB");

    const { client } = await runWith([primary.conn, marketing.conn], [{ text: "Hello." }], "hi");

    const params = client.requests[0].tools[0].parameters as {
      description?: string;
      properties: { database?: { description: string } };
      required: string[];
    };
    assert.ok(params.required.includes("database"), "database becomes required once there is a choice");
    assert.match(params.properties.database?.description ?? "", /Primary/);
    assert.match(params.properties.database?.description ?? "", /Marketing DB/);
  });
});
