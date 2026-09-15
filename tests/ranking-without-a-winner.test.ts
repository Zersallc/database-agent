/**
 * A most-common value named over a ranking that has no winner in it.
 *
 * The incident: asked for "the most used observation", the agent grouped
 * `"Observation or Finding"` — free text, one narrative sentence per record —
 * counted the groups, ordered by the count descending, took the first, and
 * answered "the most used observation is 'Acid plant motor complete rusted and
 * need repaint with acid coated special paint,' which was recorded once". With
 * the rows ordered by count descending, a top count of 1 makes 1 the maximum:
 * every value occurs once, and the row that came back is whichever tie the
 * engine reached first. The same question over a wider window returned a NULL
 * key with a count of 1, and that answer went on to generalise from the single
 * group to "the data is incomplete".
 *
 * Nothing was misspelled, nothing was empty, and nothing was invented, which is
 * why every existing check stayed silent: the query ran, it returned a row, the
 * value in the answer came out of that row and the figure was a real 1. As
 * everywhere else here, the cases that must NOT fire carry the weight — a
 * genuine ranking that gets argued with is worse than the bug being fixed.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { runAgent, type AgentEvent } from "@/lib/agent";
import { noWinnerNote, ranksByCount, rankingWithoutAWinner } from "@/lib/agent/evidence";
import { buildSystemPrompt } from "@/lib/agent/prompt";
import type {
  ModelClient,
  ModelRequest,
  ModelStreamEvent,
  ToolCall,
} from "@/lib/agent/providers/types";

/** The query that produced the incident. */
const FAILING_SQL =
  `SELECT "Observation or Finding", COUNT(*) AS count FROM "Observations DB" ` +
  `WHERE "Date" >= CURRENT_DATE - INTERVAL '2 months' GROUP BY "Observation or Finding" ` +
  `ORDER BY count DESC LIMIT 1`;

const FINDING = "Acid plant motor complete rusted and need repaint with acid coated special paint";

const RANKING_COLUMNS = ["Observation or Finding", "count"];

describe("whether a query ranks its groups by count", () => {
  test("the incident query does", () => {
    assert.equal(ranksByCount(FAILING_SQL), true);
  });

  test("a grouped count with no ordering does not — nothing was ranked", () => {
    const sql = `SELECT "Status", COUNT(*) FROM o GROUP BY "Status"`;
    assert.equal(ranksByCount(sql), false);
  });

  test("an ordering with no aggregate does not — the newest row is not the commonest", () => {
    const sql = `SELECT * FROM o GROUP BY "ID" ORDER BY "Date" DESC LIMIT 1`;
    assert.equal(ranksByCount(sql), false);
  });

  test("the keywords inside a string literal do not count as keywords", () => {
    const sql = `SELECT * FROM o WHERE "Notes" = 'group by count(*) order by it desc'`;
    assert.equal(ranksByCount(sql), false);
  });

  test("a column named for the keywords does not count either", () => {
    const sql = `SELECT "Group By Area" FROM o ORDER BY "Count Desc" DESC`;
    assert.equal(ranksByCount(sql), false);
  });
});

describe("a ranking whose top row is not the winner it looks like", () => {
  test("the incident result is caught, and says nothing repeats", () => {
    const finding = rankingWithoutAWinner(FAILING_SQL, RANKING_COLUMNS, [[FINDING, 1]]);
    assert.deepEqual(finding, {
      count: 1,
      tied: 1,
      groupedBy: "Observation or Finding",
      topKeyIsNull: false,
      nothingRepeats: true,
    });
  });

  test("a count the driver typed as a bigint string is still a count", () => {
    // node-postgres hands back `count(*)` as "1", not 1.
    const finding = rankingWithoutAWinner(FAILING_SQL, RANKING_COLUMNS, [[FINDING, "1"]]);
    assert.equal(finding?.nothingRepeats, true);
  });

  test("the NULL-key variant of the same incident is caught as both", () => {
    const finding = rankingWithoutAWinner(FAILING_SQL, RANKING_COLUMNS, [[null, 1]]);
    assert.equal(finding?.nothingRepeats, true);
    assert.equal(finding?.topKeyIsNull, true);
  });

  test("a tie above 1 is caught, without claiming nothing repeats", () => {
    const sql = `SELECT "Status", COUNT(*) AS count FROM o GROUP BY "Status" ORDER BY count DESC LIMIT 5`;
    const finding = rankingWithoutAWinner(sql, ["Status", "count"], [
      ["Open", 40],
      ["Closed", 40],
      ["Pending", 12],
    ]);
    assert.equal(finding?.tied, 2);
    assert.equal(finding?.count, 40);
    assert.equal(finding?.nothingRepeats, false);
  });

  test("a ranking with a real winner is left alone", () => {
    const sql = `SELECT "Status", COUNT(*) AS count FROM o GROUP BY "Status" ORDER BY count DESC`;
    assert.equal(
      rankingWithoutAWinner(sql, ["Status", "count"], [
        ["Open", 12],
        ["Closed", 7],
        ["Pending", 3],
      ]),
      null
    );
  });

  test("an ordinal ORDER BY is read the same as a named one", () => {
    const sql = `SELECT "Observation or Finding", COUNT(*) FROM o GROUP BY 1 ORDER BY 2 DESC LIMIT 1`;
    assert.equal(rankingWithoutAWinner(sql, RANKING_COLUMNS, [[FINDING, 1]])?.nothingRepeats, true);
  });

  test("a result ranked by a date is not a frequency ranking, whatever it counts alongside", () => {
    // One row, one observation on it, ordered newest first. The 1 is real and
    // means nothing about which value is commonest.
    const sql =
      `SELECT "Date", COUNT(*) AS count FROM o GROUP BY "Date" ORDER BY "Date" DESC LIMIT 1`;
    assert.equal(rankingWithoutAWinner(sql, ["Date", "count"], [["2026-09-11", 1]]), null);
  });

  test("a result with no tally in it is not judged", () => {
    const sql = `SELECT "Status", MAX("Notes") AS notes FROM o GROUP BY "Status" ORDER BY notes DESC`;
    assert.equal(rankingWithoutAWinner(sql, ["Status", "notes"], [["Open", "zz"]]), null);
  });

  test("an empty result has no top row to misread", () => {
    assert.equal(rankingWithoutAWinner(FAILING_SQL, RANKING_COLUMNS, []), null);
  });

  test("a query that ranked nothing is not this check's business", () => {
    const sql = `SELECT * FROM o WHERE "Status" = 'Open'`;
    assert.equal(rankingWithoutAWinner(sql, ["ID"], [["row_1"]]), null);
  });
});

describe("what the note tells the model", () => {
  const degenerate = noWinnerNote({
    count: 1,
    tied: 1,
    groupedBy: "Observation or Finding",
    topKeyIsNull: false,
    nothingRepeats: true,
  });

  test("it names the column and says no value of it occurs twice", () => {
    assert.match(degenerate, /"Observation or Finding"/);
    assert.match(degenerate, /occurs twice/);
  });

  test("it says the top row is an arbitrary tie-break rather than a winner", () => {
    assert.match(degenerate, /whichever of the ties/);
  });

  test("it closes the escape route of stating the count of 1 alongside", () => {
    // The incident answer did exactly that — "which was recorded once" — and
    // read as a hedge while still naming a winner.
    assert.match(degenerate, /count of 1 stated alongside/);
  });

  test("it offers the column that would answer the question instead", () => {
    assert.match(degenerate, /category, type, status, location or person/);
    assert.match(degenerate, /say which one you used/);
  });

  test("a NULL key is called missing data, not the most common value", () => {
    const note = noWinnerNote({
      count: 1,
      tied: 1,
      groupedBy: "Observation or Finding",
      topKeyIsNull: true,
      nothingRepeats: true,
    });
    assert.match(note, /IS NOT NULL/);
    assert.match(note, /not evidence that the field is unpopulated/);
  });

  test("a tie above 1 is reported as a tie, not as nothing repeating", () => {
    const note = noWinnerNote({
      count: 40,
      tied: 2,
      groupedBy: "Status",
      topKeyIsNull: false,
      nothingRepeats: false,
    });
    assert.match(note, /top 2 groups all hold 40 rows/);
    assert.match(note, /2-way tie/);
    assert.doesNotMatch(note, /no winner in it/);
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
      column("Date", "timestamp without time zone"),
      column("Observation or Finding", "text"),
      column("Observation Type", "text"),
      column("Status", "text"),
    ],
  },
];

/** A connection over the observations schema, returning `results` in call order. */
function observationsReturning(...results: { columns: string[]; rows: unknown[][] }[]) {
  let call = 0;
  return {
    id: "conn_obs",
    name: "Observations",
    engine: "postgres",
    schema: OBSERVATIONS_SCHEMA,
    execute: async () => {
      const shape = results[Math.min(call, results.length - 1)];
      call += 1;
      return {
        queryId: `qry_${call}`,
        result: {
          columns: shape.columns.map((name) => ({ name, data_type: null })),
          rows: shape.rows,
          row_count: shape.rows.length,
          truncated: false,
          duration_ms: 1,
        },
      };
    },
  };
}

/** The incident's result: one free-text group, holding one row. */
const NO_WINNER = { columns: RANKING_COLUMNS, rows: [[FINDING, 1]] };

function queryTurn(sql: string): { text: string; toolCalls: ToolCall[] } {
  return {
    text: "",
    toolCalls: [
      { id: "call_1", name: "run_sql", input: { sql, purpose: "Find the most used observation" } },
    ],
  };
}

async function run(
  conn: ReturnType<typeof observationsReturning>,
  turns: { text: string; toolCalls?: ToolCall[] }[],
  question = "give me the most used observation within the last two months"
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

const RETRY_LABEL = /nothing repeats/;

function labels(events: AgentEvent[]): string[] {
  return events.filter((e) => e.type === "step").map((e) => e.step.label);
}

function finalText(events: AgentEvent[]): string {
  const completed = events.find((e) => e.type === "completed");
  return completed && completed.type === "completed" ? completed.content : "";
}

function toolResults(client: { requests: ModelRequest[] }): string[] {
  return client.requests
    .flatMap((request) => request.messages)
    .filter((message) => message.role === "tool")
    .map((message) => String(message.content));
}

/** The incident answer, verbatim in shape: a winner named, its count of 1 alongside. */
const NAMES_A_WINNER =
  `The most used observation within the last two months is "${FINDING}," which was recorded once.`;

const CORRECTED = "No observation text repeats — every one of them is recorded once.";

describe("the loop, when an answer names a most-common value that does not exist", () => {
  test("the result carries the finding back to the model before any answer exists", async () => {
    const { client } = await run(observationsReturning(NO_WINNER), [
      queryTurn(FAILING_SQL),
      { text: NAMES_A_WINNER },
      { text: CORRECTED },
    ]);

    assert.ok(
      toolResults(client).some((content) => content.includes("ranking_has_no_winner")),
      "the ranking should tell the model its top row is a tie-break, next to the row"
    );
  });

  test("an answer that names a winner anyway is retried", async () => {
    const { events } = await run(observationsReturning(NO_WINNER), [
      queryTurn(FAILING_SQL),
      { text: NAMES_A_WINNER },
      { text: CORRECTED },
    ]);

    assert.ok(labels(events).some((label) => RETRY_LABEL.test(label)));
    assert.equal(finalText(events), CORRECTED);
  });

  test("the retry does not force another query — the better answer may need none", async () => {
    const { client } = await run(observationsReturning(NO_WINNER), [
      queryTurn(FAILING_SQL),
      { text: NAMES_A_WINNER },
      { text: CORRECTED },
    ]);

    assert.equal(client.requests.at(-1)?.toolChoice, "auto");
  });

  test("the correction reaches the model as a message, not just as a step", async () => {
    const { client } = await run(observationsReturning(NO_WINNER), [
      queryTurn(FAILING_SQL),
      { text: NAMES_A_WINNER },
      { text: CORRECTED },
    ]);

    const lastUserMessage = client.requests
      .at(-1)
      ?.messages.filter((message) => message.role === "user")
      .at(-1);
    assert.match(String(lastUserMessage?.content), /"Observation or Finding"/);
    assert.match(String(lastUserMessage?.content), /which column you grouped by/);
  });

  test("the NULL-key variant is retried the same way", async () => {
    const { events } = await run(
      observationsReturning({ columns: RANKING_COLUMNS, rows: [[null, 1]] }),
      [
        queryTurn(FAILING_SQL),
        { text: "The most used observation this year is not available as the field is null." },
        { text: CORRECTED },
      ],
      "give me the most used observation in this year"
    );

    assert.ok(labels(events).some((label) => RETRY_LABEL.test(label)));
  });

  test("the corrected answer is not then argued with for denying the rows", async () => {
    // The answer this asked for is a negation about the rows — "no observation
    // text repeats" — and the contradiction check would otherwise read it as
    // denying a result that returned 1 row, pushing the model straight back to
    // the claim it had just withdrawn.
    const { events } = await run(observationsReturning(NO_WINNER), [
      queryTurn(FAILING_SQL),
      { text: NAMES_A_WINNER },
      { text: CORRECTED },
    ]);

    assert.ok(!labels(events).some((label) => /nothing was found when rows came back/.test(label)));
    assert.equal(finalText(events), CORRECTED);
  });

  test("it argues once, then accepts the second answer", async () => {
    const { events } = await run(observationsReturning(NO_WINNER), [
      queryTurn(FAILING_SQL),
      { text: NAMES_A_WINNER },
      { text: NAMES_A_WINNER },
    ]);

    assert.equal(labels(events).filter((label) => RETRY_LABEL.test(label)).length, 1);
  });
});

describe("the loop, when it must leave the answer alone", () => {
  test("an answer that already says nothing repeats is not argued with", async () => {
    const { events } = await run(observationsReturning(NO_WINNER), [
      queryTurn(FAILING_SQL),
      {
        text:
          "There is no most used observation: every finding in the last two months is recorded " +
          "once, so the text column has no most common value.",
      },
    ]);

    assert.ok(!labels(events).some((label) => RETRY_LABEL.test(label)));
  });

  test("a ranking with a real winner is never touched", async () => {
    const { events, client } = await run(
      observationsReturning({
        columns: ["Observation Type", "count"],
        rows: [
          ["Unsafe Condition", 12],
          ["Unsafe Act", 7],
        ],
      }),
      [
        queryTurn(
          `SELECT "Observation Type", COUNT(*) AS count FROM "Observations DB" ` +
            `GROUP BY "Observation Type" ORDER BY count DESC`
        ),
        { text: "The most common observation type is Unsafe Condition, with 12 of the 19." },
      ]
    );

    assert.ok(!labels(events).some((label) => RETRY_LABEL.test(label)));
    assert.ok(!toolResults(client).some((content) => content.includes("ranking_has_no_winner")));
  });

  test("a tie above 1 is noted for the model but never retried", async () => {
    // Which of two 40-row categories to lead with is a judgment call, and the
    // note next to the rows is the right weight for it.
    const { events, client } = await run(
      observationsReturning({
        columns: ["Observation Type", "count"],
        rows: [
          ["Unsafe Condition", 40],
          ["Unsafe Act", 40],
        ],
      }),
      [
        queryTurn(
          `SELECT "Observation Type", COUNT(*) AS count FROM "Observations DB" ` +
            `GROUP BY "Observation Type" ORDER BY count DESC LIMIT 5`
        ),
        { text: "The most common observation type is Unsafe Condition, with 40." },
      ]
    );

    assert.ok(toolResults(client).some((content) => content.includes("ranking_has_no_winner")));
    assert.ok(!labels(events).some((label) => RETRY_LABEL.test(label)));
  });

  test("an answer that claims no superlative is left alone", async () => {
    const { events } = await run(observationsReturning(NO_WINNER), [
      queryTurn(FAILING_SQL),
      { text: "One observation was logged in that window, on the acid plant motor." },
    ]);

    assert.ok(!labels(events).some((label) => RETRY_LABEL.test(label)));
  });

  test("ordinary uses of \"most\" are not frequency claims", async () => {
    const { events } = await run(observationsReturning(NO_WINNER), [
      queryTurn(FAILING_SQL),
      { text: "Most of the findings in that window are still open." },
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

  test("it says a most-common question needs a column whose values repeat", () => {
    assert.match(rendered, /only has an answer over a column whose\s+values repeat/);
    assert.match(rendered, /top count in a ranking ordered by count is 1/);
  });

  test("it asks for the denominator a ranking is read against", () => {
    assert.match(rendered, /COUNT\(\*\) OVER \(\)/);
    assert.match(rendered, /long tail where the leader is barely ahead/);
  });

  test("it says a NULL group is missing data, not an answer", () => {
    assert.match(rendered, /A GROUP BY key of NULL is not a value/);
    assert.match(rendered, /not evidence that a field is unfilled/);
  });

  test("it says a calendar period keeps its own bounds", () => {
    assert.match(rendered, /"this year" runs from January 1 of this year up to January 1 of next year/);
    assert.match(rendered, /not the year cut off at the end of the current month/);
  });
});
