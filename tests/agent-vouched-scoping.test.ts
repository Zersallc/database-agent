/**
 * A value seen on one connection must not vouch for a filter on another.
 *
 * `vouched` used to be a single `Set` shared across every connection in a
 * multi-connection run, seeded from every connection's schema and
 * replenished from every connection's results indiscriminately
 * (lib/agent/index.ts:646-655, fixed to key it by connection id). A value
 * real on connection A could wrongly excuse an absence claim about
 * connection B — the exact mechanism the absence-evidence check exists to
 * police, just crossing a boundary it never anticipated.
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

function call(id: string, input: Record<string, unknown>): ToolCall {
  return { id, name: "run_sql", input };
}

describe("vouching is scoped per connection", () => {
  test("a value returned by one connection does not excuse an absence on another", async () => {
    // Primary's first (and only) result shows "Acme Corp" — that value is
    // vouched for on Primary, and must stay vouched only there.
    const primary = {
      id: "conn_primary",
      name: "Primary",
      engine: "postgres",
      schema: null,
      execute: async (sql: string) => ({
        queryId: "qry_primary",
        result: {
          columns: [{ name: "Company", data_type: "text" }],
          rows: [["Acme Corp"]],
          row_count: 1,
          truncated: false,
          duration_ms: 1,
        },
      }),
    };

    // Secondary has never shown "Acme Corp" anywhere — no schema value hint,
    // no prior result — so a filter on it that finds nothing is a real,
    // unverified absence on Secondary, not a confirmed one borrowed from Primary.
    const secondary = {
      id: "conn_secondary",
      name: "Secondary",
      engine: "postgres",
      schema: null,
      execute: async (sql: string) => ({
        queryId: "qry_secondary",
        result: { columns: [], rows: [], row_count: 0, truncated: false, duration_ms: 1 },
      }),
    };

    const client = scriptedClient([
      { text: "", toolCalls: [call("c1", { database: "Primary", sql: "SELECT \"Company\" FROM t", purpose: "look" })] },
      {
        text: "",
        toolCalls: [
          call("c2", {
            database: "Secondary",
            sql: `SELECT * FROM t WHERE "Company" = 'Acme Corp'`,
            purpose: "check",
          }),
        ],
      },
      { text: "Done." },
    ]);

    const events: AgentEvent[] = [];
    for await (const event of runAgent({
      question: "does Acme Corp appear in Secondary too?",
      history: [],
      playbookContext: "",
      responseDetail: "balanced",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      connections: [primary, secondary] as any,
      client,
      reportGenerator: null,
    })) {
      events.push(event);
    }

    const secondToolResult = client.requests[2].messages.find(
      (m) => m.role === "tool" && m.toolCallId === "c2"
    );
    assert.ok(secondToolResult, "the second query's tool result should exist");
    const content = JSON.parse(String(secondToolResult?.content));
    assert.ok(
      "unverified_filter" in content,
      "Secondary's empty result must be flagged as an unverified absence, " +
        "not silently excused by a value Primary happened to return"
    );
    assert.match(String(content.unverified_filter), /Acme Corp/);
  });
});
