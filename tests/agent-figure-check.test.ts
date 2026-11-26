/**
 * A figure stated after querying that nothing backs.
 *
 * Gemma 4 ranks hospitals correctly and then adds the total in prose, slipping
 * a digit in about 1 answer in 20: 6,445 or 5,345 for a top-5 total of 5,445,
 * 6,245 for a six-row total of 6,256 (trap-fence-after-prose,
 * trap-preamble-bypass).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { numericColumnsOf, runAgent, unbackedFigureAfterQueries } from "@/lib/agent";
import type { ModelClient, ModelMessage, ModelRequest, ModelStreamEvent, ToolCall } from "@/lib/agent/providers/types";

const ROWS = [
  ["Thornbury Hospital", 1288],
  ["Ashgrove Hospital", 1175],
  ["Kestrel Bay Hospital", 1093],
  ["Umzimvubu Valley Hospital", 987],
  ["Lindiwe Ridge Hospital", 902],
  ["Okavango Point Hospital", 811],
];
const TOOL: ModelMessage = {
  role: "tool",
  toolCallId: "c1",
  toolName: "run_sql",
  content: JSON.stringify({ columns: ["hospital", "removals"], rows: ROWS, row_count: 6 }),
  isError: false,
};
const columns = numericColumnsOf(ROWS);
const check = (text: string, grounded: string[] = []) => unbackedFigureAfterQueries(text, [TOOL], grounded, columns);

describe("figures an answer may state after querying", () => {
  test("the slipped totals from the evals are caught", () => {
    assert.equal(check("Thornbury leads; the top five come to 6,445 removals."), 6445);
    assert.equal(check("Together they account for 5,345."), 5345);
    assert.equal(check("All six total 6,245 removals."), 6245);
  });

  test("values from the rows, real totals, gaps and the mean are backed", () => {
    assert.equal(check("Thornbury leads at 1,288, 113 ahead of Ashgrove at 1,175."), null);
    assert.equal(check("The top five come to 5,445 of 6,256 in all."), null);
    assert.equal(check("The average is about 1,043 per hospital."), null);
  });

  test("percentages, years, round approximations, ids and small numbers are not judged", () => {
    assert.equal(check("Thornbury is 21% of the total, in 2026, at over 1,000 removals; 3 of 6 are Coastline."), null);
    assert.equal(check("Observation 6d24bef9 is the one."), null);
  });

  test("a figure the reader or an earlier turn gave is backed", () => {
    assert.equal(check("Against your target of 7,250 that is short.", ["our target is 7,250"]), null);
  });

  test("figures inside a fenced block are the model's composition, not a claim", () => {
    assert.equal(check("```chart\n{\"data\":[6445]}\n```\nThornbury leads at 1,288."), null);
  });
});

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

const connection = {
  id: "conn_1",
  name: "Hospital Waste",
  engine: "postgres",
  schema: null,
  execute: async () => ({
    queryId: "qry_1",
    result: {
      columns: [{ name: "hospital", data_type: "text" }, { name: "removals", data_type: "bigint" }],
      rows: ROWS.slice(0, 5),
      row_count: 5,
      truncated: false,
      duration_ms: 1,
    },
  }),
};

async function run(turns: { text: string; toolCalls?: ToolCall[] }[]) {
  const { client, requests } = scriptedClient(turns);
  const events = [];
  for await (const event of runAgent({
    question: "list me top 5 hospitals from report",
    history: [],
    playbookContext: "",
    responseDetail: "balanced",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    connections: [connection as any],
    client,
    reportGenerator: null,
  })) {
    events.push(event);
  }
  return { events, requests };
}

const query = { text: "", toolCalls: [{ id: "c1", name: "run_sql", input: { sql: 'SELECT * FROM "Report"', purpose: "top 5" } }] };

describe("the correction in the loop", () => {
  test("a slipped total is sent back once, with the figure named, and not forced", async () => {
    const { events, requests } = await run([query, { text: "Thornbury leads; the five total 6,445." }, { text: "Thornbury leads at 1,288; the five total 5,445." }]);
    assert.equal(requests.length, 3);
    const correction = requests[2].messages.at(-1);
    assert.equal(correction?.role, "user");
    assert.match(String(correction?.content), /states 6,445/);
    assert.equal(requests[2].toolChoice, "auto");
    const done = events.find((e) => e.type === "completed");
    assert.match(done && done.type === "completed" ? done.content : "", /5,445/);
  });

  test("it is spent once: a second slip goes out as written", async () => {
    const { requests } = await run([query, { text: "The five total 6,445." }, { text: "The five total 6,445." }]);
    assert.equal(requests.length, 3);
  });

  test("a backed answer is left alone", async () => {
    const { requests } = await run([query, { text: "Thornbury leads at 1,288; the five total 5,445." }]);
    assert.equal(requests.length, 2);
  });
});
