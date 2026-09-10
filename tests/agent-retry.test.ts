/**
 * The forced-tool retry.
 *
 * A turn that presents data without having run a query is answering from the
 * model. This is the layer that catches it, and the cases below are mostly
 * about what it must NOT do: the previous attempt at this retry was withdrawn
 * because a widened detector force-ran a query the user had explicitly asked
 * not to be run. Every "does not retry" case here is that failure written down.
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
      requests.push(request);
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

const connection = {
  name: "Test",
  engine: "postgres",
  schema: null,
  execute: async () => ({
    queryId: "qry_1",
    result: { columns: [], rows: [], row_count: 0, truncated: false, duration_ms: 1 },
  }),
};

async function run(
  turns: { text: string; toolCalls?: ToolCall[] }[],
  question = "show me the plan mix"
) {
  const client = scriptedClient(turns);
  const events: AgentEvent[] = [];
  for await (const event of runAgent({
    question,
    history: [],
    playbookContext: "",
    responseDetail: "balanced",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    connection: connection as any,
    client,
    reportGenerator: null,
  })) {
    events.push(event);
  }
  return { events, client };
}

describe("the forced-tool retry", () => {
  test("a table with no query behind it is retried, with the tool made mandatory", async () => {
    const { events, client } = await run([
      { text: 'Here it is.\n```table\n{"columns":["plan"],"rows":[["Pro"]]}\n```' },
    ]);

    assert.equal(client.requests.length, 2, "the turn should be asked twice");
    assert.equal(client.requests[0].toolChoice, "auto");
    assert.equal(client.requests[1].toolChoice, "required");
    assert.ok(
      events.some((e) => e.type === "reset"),
      "the fabricated text must be withdrawn from the stream"
    );
  });

  test("a chart with no query behind it is retried — the failure that moved here", async () => {
    const { client } = await run([{ text: '```chart\n{"series":[{"data":[15,20,10]}]}\n```' }]);
    assert.equal(client.requests.length, 2);
    assert.equal(client.requests[1].toolChoice, "required");
  });

  test("small talk is never forced to run a query", async () => {
    const { client } = await run([{ text: "Hello! How can I help?" }], "hi");
    assert.equal(client.requests.length, 1, "a greeting has no data in it to retry");
    assert.equal(client.requests[0].toolChoice, "auto");
  });

  test("a query the user asked for but not to run is left alone", async () => {
    // The exact false positive that withdrew the previous attempt.
    const { client } = await run(
      [{ text: "Sure:\n```sql\nSELECT 1;\n```" }],
      "Write me a SQL query for that. Do not run it."
    );
    assert.equal(client.requests.length, 1, "```sql alone must not force a query");
  });

  test("a turn that did run a query is not retried", async () => {
    const { client } = await run([
      {
        text: "",
        toolCalls: [{ id: "call_1", name: "run_sql", input: { sql: "SELECT 1" } }],
      },
      { text: '```table\n{"columns":["n"],"rows":[[1]]}\n```' },
    ]);
    // Two turns: the tool call, then the summary. No third, forced attempt.
    assert.equal(client.requests.length, 2);
    assert.equal(client.requests[1].toolChoice, "auto", "forcing is spent once it works");
  });

  test("the retry is spent once — a second unbacked table is not chased", async () => {
    const { client } = await run([
      { text: '```table\n{"columns":["a"],"rows":[[1]]}\n```' },
      { text: '```table\n{"columns":["a"],"rows":[[2]]}\n```' },
    ]);
    assert.equal(client.requests.length, 2, "one forced attempt, then accept the answer");
  });
});
