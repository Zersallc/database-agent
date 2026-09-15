/**
 * A turn cut off by the output token ceiling (`stopReason: "max_tokens"`)
 * must never be presented as a normal, complete answer — falling through to
 * the ordinary completion path would show a truncated answer as whole, or
 * worse, try to execute a tool call whose JSON arguments were cut mid-stream.
 * See lib/agent/index.ts's `max_tokens` stopReason branch.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { runAgent, type AgentEvent } from "@/lib/agent";
import type {
  ModelClient,
  ModelRequest,
  ModelStreamEvent,
  StopReason,
  ToolCall,
} from "@/lib/agent/providers/types";

/** A model that replies with one scripted, explicitly-stopped turn. */
function scriptedClient(turn: {
  text: string;
  toolCalls?: ToolCall[];
  stopReason: StopReason;
}): ModelClient & { requests: ModelRequest[] } {
  const requests: ModelRequest[] = [];
  return {
    kind: "openai_compatible",
    model: "test-model",
    requests,
    async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
      requests.push({ ...request, messages: [...request.messages] });
      yield { type: "text_delta", text: turn.text };
      yield {
        type: "turn",
        turn: {
          text: turn.text,
          toolCalls: turn.toolCalls ?? [],
          stopReason: turn.stopReason,
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

function connectionCounting() {
  let calls = 0;
  return {
    conn: {
      id: "conn_test",
      name: "Test",
      engine: "postgres" as const,
      schema: null,
      execute: async () => {
        calls += 1;
        return {
          queryId: "qry_1",
          result: { columns: [], rows: [], row_count: 0, truncated: false, duration_ms: 1 },
        };
      },
    },
    get calls() {
      return calls;
    },
  };
}

async function run(client: ModelClient, connections: ReturnType<typeof connectionCounting>["conn"][]) {
  const events: AgentEvent[] = [];
  for await (const event of runAgent({
    question: "How many observations last month?",
    history: [],
    playbookContext: "",
    responseDetail: "balanced",
    connections,
    client,
    reportGenerator: null,
  })) {
    events.push(event);
  }
  return events;
}

describe("a turn cut off by the output token limit", () => {
  test("fails loudly instead of presenting a truncated answer as complete", async () => {
    const client = scriptedClient({
      text: "There were 41 observations in May, 45 in June, and the trend appears to be",
      toolCalls: [],
      stopReason: "max_tokens",
    });
    const { conn } = connectionCounting();

    const events = await run(client, [conn]);

    const failed = events.find((e) => e.type === "failed");
    assert.ok(failed, "expected a failed event, not a normal completion");
    if (failed?.type !== "failed") throw new Error("unreachable");
    assert.match(failed.error.message, /cut off/i);
    assert.match(failed.error.message, /output token limit/i);

    const completed = events.find((e) => e.type === "completed");
    assert.equal(completed, undefined, "a cut-off turn must not be reported as completed");

    const step = failed.steps.find((s) => s.label === "Cut off by the output token limit");
    assert.ok(step, "expected a visible failed step naming the cutoff");
    assert.equal(step?.status, "failed");
    assert.match(step?.detail ?? "", /reply was cut off/i);
  });

  test("never executes a tool call whose arguments were cut mid-stream", async () => {
    const client = scriptedClient({
      text: "",
      toolCalls: [
        {
          id: "call_1",
          name: "run_sql",
          // A real truncation would leave this JSON incomplete; whether the
          // provider layer manages to parse a partial object or not, this
          // call must never reach `execute` once stopReason says max_tokens.
          input: { sql: "SELECT * FROM observations WHERE", purpose: "count" },
        },
      ],
      stopReason: "max_tokens",
    });
    const { conn, calls } = connectionCounting();

    const events = await run(client, [conn]);

    assert.equal(calls, 0, "a cut-off tool call must never be executed");

    const failed = events.find((e) => e.type === "failed");
    assert.ok(failed, "expected a failed event");
    if (failed?.type !== "failed") throw new Error("unreachable");
    assert.match(failed.error.message, /cut off/i);

    const step = failed.steps.find((s) => s.label === "Cut off by the output token limit");
    assert.match(step?.detail ?? "", /mid tool call/i);
  });
});
