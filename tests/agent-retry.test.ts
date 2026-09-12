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
  id: "conn_test",
  name: "Test",
  engine: "postgres",
  schema: null,
  execute: async () => ({
    queryId: "qry_1",
    result: { columns: [], rows: [], row_count: 0, truncated: false, duration_ms: 1 },
  }),
};

/** A connection whose queries return `rowCount` rows, in call order. */
function connectionReturning(...rowCounts: number[]) {
  let call = 0;
  return {
    id: "conn_rows",
    name: "Test",
    engine: "postgres",
    schema: null,
    execute: async () => {
      const row_count = rowCounts[Math.min(call, rowCounts.length - 1)];
      call += 1;
      return {
        queryId: `qry_${call}`,
        result: {
          columns: [{ name: "n", data_type: "text" }],
          rows: Array.from({ length: row_count }, (_, i) => [`row ${i}`]),
          row_count,
          truncated: false,
          duration_ms: 1,
        },
      };
    },
  };
}

async function runWith(
  conn: ReturnType<typeof connectionReturning>,
  turns: { text: string; toolCalls?: ToolCall[] }[],
  question = "what is under that category?"
) {
  const client = scriptedClient(turns);
  const events: AgentEvent[] = [];
  for await (const event of runAgent({
    question,
    history: [],
    playbookContext: "",
    responseDetail: "balanced",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    connections: [conn as any],
    client,
    reportGenerator: null,
  })) {
    events.push(event);
  }
  return { events, client };
}

async function run(
  turns: { text: string; toolCalls?: ToolCall[] }[],
  question = "show me the plan mix",
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

/**
 * Prose fabrication, which the fenced-block check above cannot see. The rule is
 * about substance rather than shape: a figure is grounded when the model could
 * have read it somewhere, and invented when it could not.
 */
describe("a figure with nothing behind it", () => {
  test("a count stated in prose with no query is retried", async () => {
    const { client } = await run([
      { text: "In August there were 52 unsafe conditions and 45 quality observations." },
    ]);
    assert.equal(client.requests.length, 2, "a figure from nowhere is still fabrication");
    assert.equal(client.requests[1].toolChoice, "required");
  });

  test("a figure the reader supplied is not fabrication", async () => {
    const { client } = await run(
      [{ text: "Yes — 52 is the count you mentioned; I have not checked it." }],
      "is 52 the right number of unsafe conditions?"
    );
    assert.equal(client.requests.length, 1, "it came from the question");
  });

  test("a figure an earlier turn established is not re-chased", async () => {
    // The summarise-what-we-just-found turn. Forcing a query here would re-run
    // work the conversation already did.
    const { client } = await run(
      [{ text: "Unsafe Condition at 52 leads, with Quality and CI at 45 behind it." }],
      "summarize those risks",
      [
        { role: "user", content: "what are the risk types for August?" },
        { role: "assistant", content: "Unsafe Condition 52, Quality and CI 45 — both in the table." },
      ]
    );
    assert.equal(client.requests.length, 1, "the figures were already on the record");
  });

  test("a numbered list is numbering, not a quantity", async () => {
    const { client } = await run([
      { text: "Two things to know:\n\n1. The schema has no weight column.\n2. Ask the owner." },
    ]);
    assert.equal(client.requests.length, 1, "list markers must not read as figures");
  });

  test("numbers inside a query the user asked for do not count", async () => {
    // Same false positive the withdrawn retry died on, now via the figure rule.
    const { client } = await run(
      [{ text: "Sure:\n```sql\nSELECT * FROM t WHERE id = 52 LIMIT 10;\n```" }],
      "write me that query, do not run it"
    );
    assert.equal(client.requests.length, 1, "a fenced block is composition, not a claim");
  });
});

/**
 * The answer contradicting the rows it just fetched. Checked against the real
 * row count rather than guessed at, so the "does not fire" cases below are the
 * ones that keep a legitimate empty finding sayable.
 */
describe("saying nothing was found while holding rows", () => {
  const query: ToolCall[] = [{ id: "c1", name: "run_sql", input: { sql: "SELECT 1" } }];

  test("three rows back and 'no observations were found' is corrected", async () => {
    const { client, events } = await runWith(connectionReturning(3), [
      { text: "", toolCalls: query },
      { text: "No observations were found for that sub-classification." },
      { text: "Three rows came back; here is what they say." },
    ]);
    assert.equal(client.requests.length, 3, "the contradiction should be put back to the model");
    assert.ok(
      events.some((e) => e.type === "reset"),
      "the contradicted answer must be withdrawn"
    );
    const correction = client.requests[2].messages.at(-1);
    assert.equal(correction?.role, "user");
    assert.match(String(correction?.content), /returned 3 rows/);
  });

  test("the forcing is not used for it — the rows are already in hand", async () => {
    const { client } = await runWith(connectionReturning(3), [
      { text: "", toolCalls: query },
      { text: "No matching records." },
      { text: "Here they are." },
    ]);
    assert.equal(client.requests[2].toolChoice, "auto", "re-querying would fetch the same rows twice");
  });

  test("an empty result really may be reported as empty", async () => {
    const { client } = await runWith(connectionReturning(0), [
      { text: "", toolCalls: query },
      { text: "No observations were found for that sub-classification." },
    ]);
    assert.equal(client.requests.length, 2, "nothing to contradict when nothing came back");
  });

  test("a narrower follow-up that comes back empty is still sayable", async () => {
    // Rows first, then a tighter question that legitimately matches none.
    const { client } = await runWith(connectionReturning(12, 0), [
      { text: "", toolCalls: query },
      { text: "", toolCalls: [{ id: "c2", name: "run_sql", input: { sql: "SELECT 2" } }] },
      { text: "Twelve are open, and no records are overdue." },
    ]);
    assert.equal(client.requests.length, 3, "the last query is the one the claim is about");
  });

  test("reasoning that worked its way to the answer is not the answer", async () => {
    // Qwen-style models emit <think>…</think> inline. "No rows, so let me widen
    // it" is the model reaching the right answer, not telling the reader
    // nothing is there.
    const { client } = await runWith(connectionReturning(3), [
      { text: "", toolCalls: query },
      {
        text:
          "<think>The exact match gave no results, so I widened it and got three.</think>" +
          "Three observations are under that sub-classification.",
      },
    ]);
    assert.equal(client.requests.length, 2, "thinking is not an assertion to the reader");
  });

  test("the correction is spent once", async () => {
    const { client } = await runWith(connectionReturning(3), [
      { text: "", toolCalls: query },
      { text: "No results found." },
      { text: "Still no results found." },
    ]);
    assert.equal(client.requests.length, 3, "one correction, then accept the answer");
  });
});

describe("a promise to run a query", () => {
  test("announcing a query and then stopping is retried", async () => {
    const { client } = await run([{ text: "I will run a query to get those details for you." }]);
    assert.equal(client.requests.length, 2, "a promise is not an answer");
    assert.equal(client.requests[1].toolChoice, "required");
  });

  test("a closing offer is not a promise to query", async () => {
    const { client } = await run(
      [{ text: "That column is not in the schema. Let me know if you want something else." }],
      "what does the weight column hold?"
    );
    assert.equal(client.requests.length, 1, "'let me know' reaches no database");
  });
});
