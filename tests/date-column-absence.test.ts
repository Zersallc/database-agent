/**
 * An absence reported from one date column of several.
 *
 * The incident: asked to open "the September 11 one" — a row the previous turn
 * had listed under that date — the agent filtered `"Date"` to September 11, got
 * nothing, and told the reader no such observation existed. The row was real
 * and already on screen. Its `"Date"` is the 10th; only its `"Timestamp"` is
 * the 11th, and that is the column the listing had sorted and labelled by.
 *
 * Nothing was misspelled and nothing was mistyped, which is why every check
 * that existed stayed silent: the query was well-formed, the literal was a
 * date, and the row count really was zero. As everywhere else here, the cases
 * that must NOT fire carry the weight — a genuine empty finding that gets
 * argued with is worse than the bug being fixed.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { runAgent, type AgentEvent } from "@/lib/agent";
import { comparesADate, otherDateColumnsNote, unqueriedDateColumns } from "@/lib/agent/evidence";
import { buildSystemPrompt } from "@/lib/agent/prompt";
import type {
  ModelClient,
  ModelRequest,
  ModelStreamEvent,
  ToolCall,
} from "@/lib/agent/providers/types";

/** The four ways the observations table dates one row. */
const DATES = ["Timestamp", "Date", "Last Edited DateTime", "Closer DateTime"];

/** The query that produced the incident. */
const FAILING_SQL = `SELECT * FROM public."Observations DB" WHERE "Date" >= '2026-09-11' AND "Date" < '2026-09-12'`;

describe("whether a query pinned anything to a calendar date", () => {
  test("a half-open range does", () => {
    assert.equal(comparesADate(FAILING_SQL), true);
  });

  test("BETWEEN does", () => {
    assert.equal(comparesADate(`SELECT * FROM o WHERE "Date" BETWEEN '2026-08-01' AND '2026-08-31'`), true);
  });

  test("a filter on a category does not", () => {
    assert.equal(comparesADate(`SELECT * FROM o WHERE "Status" = 'Open'`), false);
  });

  test("a bare year is not a date-shaped literal", () => {
    // '2026' alone is as likely a reference number as a date, and reading it as
    // one would fire this on filters that have nothing to do with the calendar.
    assert.equal(comparesADate(`SELECT * FROM o WHERE "Unit" = '2026'`), false);
  });
});

describe("a date filter that asked one column of several", () => {
  test("the incident query is caught", () => {
    assert.deepEqual(unqueriedDateColumns(FAILING_SQL, DATES), {
      filtered: ["Date"],
      others: ["Timestamp", "Last Edited DateTime", "Closer DateTime"],
    });
  });

  test("a truncation spells the comparison differently and is caught the same", () => {
    const sql = `SELECT * FROM o WHERE DATE_TRUNC('day', "Date") = '2026-09-11'`;
    assert.deepEqual(unqueriedDateColumns(sql, DATES)?.filtered, ["Date"]);
  });

  test("a cast is caught the same", () => {
    const sql = `SELECT * FROM o WHERE "Date"::date = '2026-09-11'`;
    assert.deepEqual(unqueriedDateColumns(sql, DATES)?.filtered, ["Date"]);
  });

  test("the column name is matched however the query cased it", () => {
    const sql = `select * from o where "TIMESTAMP" >= '2026-09-11'`;
    assert.deepEqual(unqueriedDateColumns(sql, DATES)?.filtered, ["Timestamp"]);
  });

  test("a table with one date column has no other column to have meant", () => {
    assert.equal(unqueriedDateColumns(FAILING_SQL, ["Date"]), null);
  });

  test("a query that filtered no date at all is not about this", () => {
    // It found nothing for some other reason, and pointing at date columns it
    // never used would send the model off after the wrong thing entirely.
    assert.equal(unqueriedDateColumns(`SELECT * FROM o WHERE "Status" = 'Pending'`, DATES), null);
  });

  test("a query that already spans every date column has nothing left to try", () => {
    const sql = `SELECT * FROM o WHERE "Timestamp" >= '2026-09-11' OR "Date" >= '2026-09-11'
                 OR "Last Edited DateTime" >= '2026-09-11' OR "Closer DateTime" >= '2026-09-11'`;
    assert.equal(unqueriedDateColumns(sql, DATES), null);
  });

  test("a table with no date columns at all is silent", () => {
    assert.equal(unqueriedDateColumns(FAILING_SQL, []), null);
  });
});

describe("what the note tells the model", () => {
  const note = otherDateColumnsNote(["Date"], ["Timestamp", "Closer DateTime"]);

  test("it names the column that was asked and the ones that were not", () => {
    assert.match(note, /"Date"/);
    assert.match(note, /"Timestamp", "Closer DateTime"/);
  });

  test("it says the empty result is that column's answer, not the table's", () => {
    assert.match(note, /not the table's/);
  });

  test("it points back at the key of a row already shown", () => {
    // The cheapest correct move, and the one the incident skipped: the row was
    // already on screen with its id next to it.
    assert.match(note, /identifier/i);
  });
});

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

function column(name: string, data_type: string) {
  return { name, data_type, nullable: true, primary_key: false, description: null };
}

const OBSERVATIONS_SCHEMA = [
  {
    schema: "public",
    name: "Observations DB",
    description: null,
    row_estimate: 500,
    columns: [
      column("ID", "text"),
      column("Timestamp", "timestamp without time zone"),
      column("Date", "timestamp without time zone"),
      column("Last Edited DateTime", "timestamp without time zone"),
      column("Closer DateTime", "timestamp without time zone"),
      column("Status", "text"),
    ],
  },
];

/** A connection over the observations schema, returning `rowCounts` in call order. */
function observationsReturning(...rowCounts: number[]) {
  let call = 0;
  return {
    id: "conn_obs",
    name: "Observations",
    engine: "postgres",
    schema: OBSERVATIONS_SCHEMA,
    execute: async () => {
      const row_count = rowCounts[Math.min(call, rowCounts.length - 1)];
      call += 1;
      return {
        queryId: `qry_${call}`,
        result: {
          columns: [{ name: "ID", data_type: "text" }],
          rows: Array.from({ length: row_count }, (_, i) => [`row_${i}`]),
          row_count,
          truncated: false,
          duration_ms: 1,
        },
      };
    },
  };
}

function queryTurn(sql: string): { text: string; toolCalls: ToolCall[] } {
  return {
    text: "",
    toolCalls: [
      { id: "call_1", name: "run_sql", input: { sql, purpose: "Find the September 11 observation" } },
    ],
  };
}

async function run(
  conn: ReturnType<typeof observationsReturning>,
  turns: { text: string; toolCalls?: ToolCall[] }[],
  question = "show me details of sept 11 one"
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

const RETRY_LABEL = /one date column of several/;

function labels(events: AgentEvent[]): string[] {
  return events.filter((e) => e.type === "step").map((e) => e.step.label);
}

function finalText(events: AgentEvent[]): string {
  const completed = events.find((e) => e.type === "completed");
  return completed && completed.type === "completed" ? completed.content : "";
}

describe("the loop, when an answer rests on the wrong date column", () => {
  test("the empty result carries the other date columns back to the model", async () => {
    const { client } = await run(observationsReturning(0), [
      queryTurn(FAILING_SQL),
      { text: "No observations were found for September 11." },
      { text: "It is observation 6d24bef9, recorded on the 11th." },
    ]);

    const toolResults = client.requests
      .flatMap((request) => request.messages)
      .filter((message) => message.role === "tool")
      .map((message) => String(message.content));

    assert.ok(
      toolResults.some((content) => content.includes("other_date_columns")),
      "the empty result should tell the model which date columns it did not ask"
    );
  });

  test("an absence claimed from one date column is retried, with the tool made mandatory", async () => {
    const { events, client } = await run(observationsReturning(0), [
      queryTurn(FAILING_SQL),
      { text: "No observations were found for September 11." },
      { text: "It is observation 6d24bef9, recorded on the 11th." },
    ]);

    assert.ok(labels(events).some((label) => RETRY_LABEL.test(label)));
    assert.equal(client.requests.at(-1)?.toolChoice, "required");
    assert.equal(finalText(events), "It is observation 6d24bef9, recorded on the 11th.");
  });

  test("the correction reaches the model as a message, not just as a step", async () => {
    const { client } = await run(observationsReturning(0), [
      queryTurn(FAILING_SQL),
      { text: "No observations were found for September 11." },
      { text: "It is observation 6d24bef9, recorded on the 11th." },
    ]);

    const lastUserMessage = client.requests
      .at(-1)
      ?.messages.filter((message) => message.role === "user")
      .at(-1);
    assert.match(String(lastUserMessage?.content), /"Timestamp"/);
    assert.match(String(lastUserMessage?.content), /which ones you tried/);
  });

  test("it argues once, then accepts a verified absence", async () => {
    // The model checked and the row really is not there. Saying so a second
    // time is the outcome this is trying to produce, not something to keep
    // pushing back on.
    const { events } = await run(observationsReturning(0), [
      queryTurn(FAILING_SQL),
      { text: "No observations were found for September 11." },
      queryTurn(`SELECT * FROM public."Observations DB" WHERE "Timestamp" >= '2026-09-11'`),
      { text: "No observations were found for September 11 on any of its date columns." },
    ]);

    assert.equal(labels(events).filter((label) => RETRY_LABEL.test(label)).length, 1);
    assert.match(finalText(events), /No observations were found/);
  });
});

describe("the loop, when it must leave the answer alone", () => {
  test("a query that found rows is never second-guessed about which column it asked", async () => {
    const { events } = await run(observationsReturning(3), [
      queryTurn(FAILING_SQL),
      { text: "Three observations fall on September 11." },
    ]);

    assert.ok(!labels(events).some((label) => RETRY_LABEL.test(label)));
  });

  test("an empty result the answer does not call an absence is left alone", async () => {
    // The model came back empty and went on to say something else useful about
    // it. Forcing another query here would be noise.
    const { events } = await run(observationsReturning(0), [
      queryTurn(FAILING_SQL),
      { text: "That date falls outside the reporting period this table covers." },
    ]);

    assert.ok(!labels(events).some((label) => RETRY_LABEL.test(label)));
  });

  test("an absence from a query that filtered no date is not this check's business", async () => {
    const { events } = await run(observationsReturning(0), [
      queryTurn(`SELECT * FROM public."Observations DB" WHERE "Status" = 'Escalated'`),
      { text: "No observations have that status." },
    ]);

    assert.ok(!labels(events).some((label) => RETRY_LABEL.test(label)));
  });
});

describe("what the prompt tells the model before any of this fires", () => {
  const rendered = buildSystemPrompt({
    playbookContext: "",
    responseDetail: "balanced",
    connections: [],
    now: new Date("2026-09-15T00:00:00Z"),
  });

  test("it says to name the date column an answer was dated by", () => {
    assert.match(rendered, /which column a date in your answer came from/i);
  });

  test("it says a follow-up about a row on screen is found by its key", () => {
    assert.match(rendered, /the second one|that observation/i);
    assert.match(rendered, /primary key, which cannot miss/i);
  });
});
