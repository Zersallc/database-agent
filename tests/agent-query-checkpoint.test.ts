/**
 * The query checkpoint, the routing lines added for Gemma 4's measured
 * failures, and Postgres row estimates.
 *
 * Gemma 4 ran 6-11 queries in a row hunting for a figure the database did not
 * hold (evals/results/v033-gemma-media.json). From the fifth query on, each
 * result tells it to take stock.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { runAgent } from "@/lib/agent";
import { buildSystemPrompt } from "@/lib/agent/prompt";
import { rowEstimate } from "@/lib/connectors/postgres";
import type { ModelClient, ModelRequest, ModelStreamEvent, ToolCall } from "@/lib/agent/providers/types";

import { DATABASE_ONLY_FIXTURES } from "./helpers/prompt-fixtures";

function scriptedClient(turns: { text: string; toolCalls?: ToolCall[] }[]) {
  const requests: ModelRequest[] = [];
  let index = 0;
  const client = {
    kind: "openai_compatible",
    model: "test-model",
    async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
      requests.push({ ...request, messages: [...request.messages] });
      const turn = turns[Math.min(index++, turns.length - 1)];
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
  } as unknown as ModelClient;
  return { client, requests };
}

const sqlTurn = (n: number, fail = false) => ({
  text: "",
  toolCalls: [{ id: `call_${n}`, name: "run_sql", input: { sql: fail ? "SELECT broken" : `SELECT ${n}`, purpose: `look ${n}` } }],
});

const connection = {
  id: "conn_1",
  name: "Sales",
  engine: "postgres",
  schema: null,
  execute: async (sql: string) => {
    if (sql.includes("broken")) throw new Error('column "broken" does not exist');
    return {
      queryId: "qry_1",
      result: { columns: [{ name: "n", data_type: "integer" }], rows: [[1]], row_count: 1, truncated: false, duration_ms: 1 },
    };
  },
};

async function toolResultsAfter(turns: { text: string; toolCalls?: ToolCall[] }[]): Promise<string[]> {
  const { client, requests } = scriptedClient(turns);
  for await (const event of runAgent({
    question: "what is the late penalty for acme",
    history: [],
    playbookContext: "",
    responseDetail: "balanced",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    connections: [connection as any],
    client,
    reportGenerator: null,
  })) {
    void event;
  }
  const last = requests[requests.length - 1];
  return last.messages.filter((m) => m.role === "tool").map((m) => (m as { content: string }).content);
}

describe("the query checkpoint", () => {
  test("the first four results carry no note, the fifth and later do", async () => {
    const results = await toolResultsAfter([...[1, 2, 3, 4, 5, 6].map((n) => sqlTurn(n)), { text: "Done." }]);
    assert.equal(results.length, 6);
    for (const content of results.slice(0, 4)) assert.equal(JSON.parse(content).checkpoint, undefined);
    assert.match(JSON.parse(results[4]).checkpoint, /query 5 for this answer.*stop querying/);
    assert.match(JSON.parse(results[5]).checkpoint, /query 6/);
  });

  test("a failed query counts and carries the note too", async () => {
    const results = await toolResultsAfter([sqlTurn(1), sqlTurn(2), sqlTurn(3), sqlTurn(4), sqlTurn(5, true), { text: "Done." }]);
    assert.match(results[4], /^The query failed: [^\n]*\n\nThis is query 5 for this answer/);
  });

  test("a short run is untouched", async () => {
    const results = await toolResultsAfter([sqlTurn(1), { text: "There is 1." }]);
    assert.ok(!results[0].includes("checkpoint"));
  });
});

describe("routing lines for document libraries", () => {
  const ONE_DB = DATABASE_ONLY_FIXTURES["one postgres database"];
  const rendered = buildSystemPrompt({ ...ONE_DB, libraries: [{ name: "Contracts", description: null }] });

  test("'show me' and 'can I see' are searches", () => {
    assert.match(rendered, /"Show me the contracts" or "can I see the supplier agreements" is that kind of request/);
  });
});

describe("Postgres row estimates", () => {
  test("the planner's count is rounded; never-analysed and views give nothing", () => {
    assert.equal(rowEstimate(40213.7), 40214);
    assert.equal(rowEstimate("189"), 189);
    assert.equal(rowEstimate(-1), null);
    assert.equal(rowEstimate(0), null);
    assert.equal(rowEstimate(null), null);
  });
});
