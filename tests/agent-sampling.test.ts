/**
 * What a result set is labelled as establishing.
 *
 * The agent declared `Donation Value` absent from the database — 40,618
 * populated rows totalling 34,171,960.53 — after running `LIMIT 5` with no
 * `ORDER BY`, landing on five small suppliers whose values were null, and
 * generalising from them. Real query, real rows, read correctly; the error was
 * entirely in the inference. These tests cover the note that says so, in the
 * payload the model reads rather than in a prompt it can drift away from.
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

describe("what a sample establishes", () => {
  test("an arbitrary sample says so in the payload the model reads", async () => {
    // The agent declared `Donation Value` absent from 40,618 populated rows
    // after LIMIT 5 with no ORDER BY. The note is what stands between five
    // arbitrary rows and a claim about the whole table.
    const { client } = await run([
      {
        text: "",
        toolCalls: [
          {
            id: "call_1",
            name: "run_sql",
            input: { sql: 'SELECT "Hospital Name", "Donation Value" FROM "Report" LIMIT 5' },
          },
        ],
      },
      { text: "Nothing to report." },
    ]);
    const toolMessage = client.requests[1].messages.find((m) => m.role === "tool");
    assert.ok(toolMessage, "the tool result should be in the next request");
    assert.match(
      (toolMessage as { content: string }).content,
      /arbitrary subset/,
      "an unordered LIMIT must be labelled as arbitrary"
    );
  });

  test("an ordered query is not labelled arbitrary", async () => {
    const { client } = await run([
      {
        text: "",
        toolCalls: [
          {
            id: "call_1",
            name: "run_sql",
            input: {
              sql: 'SELECT "Hospital Name" FROM "Report" ORDER BY "Donation Value" DESC LIMIT 5',
            },
          },
        ],
      },
      { text: "Done." },
    ]);
    const toolMessage = client.requests[1].messages.find((m) => m.role === "tool");
    assert.doesNotMatch((toolMessage as { content: string }).content, /arbitrary subset/);
  });

  test("LIMIT inside a string literal is not a LIMIT", async () => {
    const { client } = await run([
      {
        text: "",
        toolCalls: [
          {
            id: "call_1",
            name: "run_sql",
            input: { sql: `SELECT * FROM "Report" WHERE "Notes" = 'no limit applied'` },
          },
        ],
      },
      { text: "Done." },
    ]);
    const toolMessage = client.requests[1].messages.find((m) => m.role === "tool");
    assert.doesNotMatch((toolMessage as { content: string }).content, /arbitrary subset/);
  });
});
