/**
 * How much of a result goes back into the model's context.
 *
 * A row cap is not a size cap, and the difference took the agent down. Asked
 * what observations were available for August, the model ran `SELECT *`; 100
 * rows of a wide table with narrative text columns came back as ~188,000
 * characters of tool result, and the next request — prompt plus that — was
 * about twice the model's 32,768-token window. It never reached generation.
 * The provider rejected it with an error about the 32,000 output tokens the
 * request reserved, which was true and not the problem: the reservation only
 * failed because the prompt had already eaten the window.
 *
 * So these assert on size, not on row counts, and on the reader keeping
 * everything: the table is rendered from the query record, and nothing here
 * touches that.
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

/** An incident report, the kind of free-text column that blew the window. */
const NARRATIVE =
  "Observation: found during routine inspection of the pump cabin. The guard " +
  "rail on the eastern walkway was found to be loose at two fixing points, and " +
  "the surrounding area showed signs of hydraulic fluid seepage. Housekeeping " +
  "in the immediate vicinity was poor, with rags and offcuts left on the deck. " +
  "Crew were briefed on site and the area was cordoned pending repair. ".repeat(3);

/** 100 rows of a wide table — what `SELECT *` on this schema actually returns. */
const WIDE_ROWS = Array.from({ length: 100 }, (_, i) => [
  `obs-${i}`,
  "2026-08-14T04:00:00.000Z",
  "HSE Observation",
  "Unsafe Condition",
  `${NARRATIVE} (row ${i})`,
  "Closed",
  "Nizwa Base",
]);

const WIDE_COLUMNS = [
  "id",
  "Date",
  "Category",
  "Classification",
  "Observation or Finding",
  "Status",
  "Location",
];

function connectionReturning(rows: unknown[][]) {
  return {
    id: "conn_obs",
    name: "Observations",
    engine: "postgres",
    schema: null,
    execute: async () => ({
      queryId: "qry_1",
      result: {
        columns: WIDE_COLUMNS.map((name) => ({ name, data_type: "text" })),
        rows,
        row_count: rows.length,
        truncated: false,
        duration_ms: 3,
      },
    }),
  };
}

async function runSelectStar(rows: unknown[][]) {
  const client = scriptedClient([
    {
      text: "",
      toolCalls: [
        {
          id: "call_1",
          name: "run_sql",
          input: { sql: 'SELECT * FROM "Observations DB"', purpose: "August observations" },
        },
      ],
    },
    { text: "Here is the shape of August." },
  ]);
  const events: AgentEvent[] = [];
  for await (const event of runAgent({
    question: "what observations are available for august",
    history: [],
    playbookContext: "",
    responseDetail: "balanced",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    connections: [connectionReturning(rows) as any],
    client,
    reportGenerator: null,
  })) {
    events.push(event);
  }
  const toolMessage = client.requests[1]?.messages.find((m) => m.role === "tool");
  assert.ok(toolMessage, "the tool result should reach the next request");
  const content = (toolMessage as { content: string }).content;
  return { events, client, content, payload: JSON.parse(content) };
}

describe("a result too large for the context window", () => {
  test("the reported failure no longer produces an oversized tool result", async () => {
    const { content } = await runSelectStar(WIDE_ROWS);
    // The whole result is ~188,000 characters. Anything near that is the bug.
    assert.ok(
      content.length < 20000,
      `the tool result was ${content.length} characters; it must stay well under the window`
    );
  });

  test("it still sends rows, just not all of them", async () => {
    const { payload } = await runSelectStar(WIDE_ROWS);
    assert.ok(payload.rows.length >= 1, "the model must see the shape of the result");
    assert.ok(payload.rows.length < 100, "it must not send all 100 wide rows");
    assert.equal(payload.row_count, 100, "the true count is still reported");
    assert.equal(payload.rows_shown, payload.rows.length);
    assert.equal(payload.truncated, true);
  });

  test("holding rows back is stated, not done quietly", async () => {
    const { payload } = await runSelectStar(WIDE_ROWS);
    assert.match(payload.sampling, /Not every matching row is here/);
  });

  test("a long cell says it was shortened, so it is never quoted as complete", async () => {
    const { payload } = await runSelectStar(WIDE_ROWS);
    const narrative = payload.rows[0][WIDE_COLUMNS.indexOf("Observation or Finding")];
    assert.match(narrative, /truncated, \d+ characters in full/);
    assert.ok(narrative.length < 600, "a trimmed cell should be short");
  });

  test("one row over budget on its own is still sent", async () => {
    // Better to see one row's shape than none at all.
    const { payload } = await runSelectStar([WIDE_ROWS[0]]);
    assert.equal(payload.rows.length, 1);
  });

  test("a narrow result is untouched — all 100 rows, nothing trimmed", async () => {
    const narrow = Array.from({ length: 100 }, (_, i) => [`Category ${i}`, i * 3]);
    const client = scriptedClient([
      {
        text: "",
        toolCalls: [
          {
            id: "call_1",
            name: "run_sql",
            input: { sql: "SELECT category, count(*) FROM obs GROUP BY category", purpose: "mix" },
          },
        ],
      },
      { text: "Done." },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const event of runAgent({
      question: "category mix?",
      history: [],
      playbookContext: "",
      responseDetail: "balanced",
      connections: [
        {
          id: "c",
          name: "Observations",
          engine: "postgres",
          schema: null,
          execute: async () => ({
            queryId: "q",
            result: {
              columns: [
                { name: "category", data_type: "text" },
                { name: "count", data_type: "bigint" },
              ],
              rows: narrow,
              row_count: 100,
              truncated: false,
              duration_ms: 1,
            },
          }),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      ],
      client,
      reportGenerator: null,
    })) {
      // Drained for the request it builds.
    }
    const toolMessage = client.requests[1].messages.find((m) => m.role === "tool");
    const payload = JSON.parse((toolMessage as { content: string }).content);
    assert.equal(payload.rows.length, 100, "a narrow result loses nothing");
    assert.equal(payload.truncated, false);
    assert.equal(payload.sampling, undefined, "and needs no caveat");
  });
});
