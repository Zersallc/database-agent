/**
 * Quoting a value the database never returned.
 *
 * Asked "by who" about an observation it had just described, the agent answered
 * `Employee Name: "Ahmed Al-Maktoum"` — a real-looking name, correctly
 * formatted, for a row whose reporter it had never queried. It ran no tool that
 * turn, and every existing check passed: a name carries no digit for
 * `statesUngroundedFigure` to weigh, it presented no ```table, and it promised
 * nothing it failed to do.
 *
 * So these tests come in pairs. The fabrication has to be caught, and the far
 * more common thing that looks identical to a detector — quoting a column name,
 * a category the schema lists, the reader's own words — has to be left alone.
 * A detector that retries every well-formatted answer is worse than the bug.
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

/**
 * A schema with the two things that must vouch for a quoted value: the
 * identifiers, and the values a column is known to hold.
 */
const connection = {
  id: "conn_obs",
  name: "Observations",
  engine: "postgres",
  schema: [
    {
      schema: "public",
      name: "Observation",
      columns: [
        { name: "id", data_type: "text", primary_key: true, nullable: false },
        { name: "Employee Name", data_type: "text", primary_key: false, nullable: true },
        {
          name: "HSE Observation SubClassification",
          data_type: "text",
          primary_key: false,
          nullable: true,
          distinct_values: {
            list: ["Health or Hygiene or Ergonomic Hazards", "Unsafe Act"],
            complete: true,
          },
        },
      ],
    },
  ],
  execute: async () => ({
    queryId: "qry_1",
    result: {
      columns: [{ name: "id", data_type: "text" }],
      rows: [["6d24bef9"]],
      row_count: 1,
      truncated: false,
      duration_ms: 1,
    },
  }),
};

async function run(
  turns: { text: string; toolCalls?: ToolCall[] }[],
  question = "by who?",
  history: { role: "user" | "assistant"; content: string }[] = []
) {
  const client = scriptedClient(turns);
  const events: AgentEvent[] = [];
  for await (const event of runAgent({
    question,
    history,
    playbookContext: "",
    responseDetail: "balanced",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    connections: [connection as any],
    client,
    reportGenerator: null,
  })) {
    events.push(event);
  }
  return { events, client };
}

describe("a quoted value with no query behind it", () => {
  test("the reported fabrication is retried, with the tool made mandatory", async () => {
    const { events, client } = await run([
      { text: 'The observation was made by Employee Name: "Ahmed Al-Maktoum".' },
    ]);

    assert.equal(client.requests.length, 2, "the turn should be asked twice");
    assert.equal(client.requests[0].toolChoice, "auto");
    assert.equal(client.requests[1].toolChoice, "required");
    assert.ok(
      events.some((e) => e.type === "reset"),
      "the invented name must be withdrawn from the stream"
    );
  });

  test("it is retried once, not argued with twice", async () => {
    const { client } = await run([{ text: 'Reported by "Ahmed Al-Maktoum".' }]);
    assert.equal(client.requests.length, 2);
  });

  test("a curly-quoted value counts too — the model writes both", async () => {
    const { client } = await run([{ text: "Reported by “Ahmed Al-Maktoum”." }]);
    assert.equal(client.requests.length, 2);
  });
});

describe("what it must not retry", () => {
  test("a column name the schema shows is not a fabricated value", async () => {
    const { client } = await run([
      { text: 'That is recorded in "HSE Observation SubClassification", which is empty here.' },
    ]);
    assert.equal(client.requests.length, 1, "quoting the schema is not inventing data");
  });

  test("a category the schema lists for a column is grounded by the schema", async () => {
    const { client } = await run([
      { text: 'Those are filed under "Health or Hygiene or Ergonomic Hazards".' },
    ]);
    assert.equal(client.requests.length, 1);
  });

  test("a shorter way of naming a real value still counts as naming it", async () => {
    // Substring, in this direction only: the model is naming something real in
    // fewer words, which is not the failure this exists for.
    const { client } = await run([{ text: 'Those are the "health or hygiene" ones.' }]);
    assert.equal(client.requests.length, 1);
  });

  test("the reader's own words are theirs to quote back", async () => {
    const { client } = await run(
      [{ text: 'You asked about "pressure test leaks" — nothing in the schema records that.' }],
      "any observations about pressure test leaks?"
    );
    assert.equal(client.requests.length, 1);
  });

  test("a value an earlier turn already said out loud is grounded", async () => {
    const { client } = await run([{ text: 'Yes, "Wadi Laithem" is the camp in question.' }], "where?", [
      { role: "assistant", content: "The observation was at Camp - Wadi Laithem." },
    ]);
    assert.equal(client.requests.length, 1);
  });

  test("a turn that actually ran a query is never second-guessed", async () => {
    // The whole check is about answering with no query. Once one has run, the
    // rows are in the transcript and this is not the layer that reads them.
    const { client } = await run([
      {
        text: "",
        toolCalls: [
          { id: "call_1", name: "run_sql", input: { sql: "SELECT id FROM public.\"Observation\"" } },
        ],
      },
      { text: 'Reported by "Ahmed Al-Maktoum".' },
    ]);
    assert.equal(client.requests.length, 2, "one query, one answer, no retry");
    assert.equal(client.requests[1].toolChoice, "auto");
  });

  test("small talk with nothing quoted is untouched", async () => {
    const { client } = await run([{ text: "Hello! How can I help?" }], "hi");
    assert.equal(client.requests.length, 1);
  });

  test("a quoted figure is left to the figure check, which reads numbers properly", async () => {
    const { client } = await run([{ text: 'The reader asked for the "2026" totals.' }], "2026 totals?");
    assert.equal(client.requests.length, 1);
  });
});
