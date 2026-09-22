/**
 * Provenance through the agent loop.
 *
 * The model is scripted and behaves badly on purpose: it cites files no search
 * returned, cites a database whose query failed, files a real document under
 * the wrong library, forgets the Sources block, and writes one in workspaces
 * that were never asked for it. What is under test is not whether a model
 * behaves well (that is what the evals measure) but that the loop's ledger is
 * built only from real tool results, that `completed.content` is what the
 * ledger backs, and that the one corrective retry is spent when it should be
 * and not otherwise.
 *
 * `completed.content` is the authoritative answer: the client replaces what it
 * streamed with it and it is what is stored. tests/run-provenance.test.ts
 * follows it through the run service and the renderer.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { runAgent, type AgentEvent } from "@/lib/agent";
import type { AgentLibrary, DocumentSearchResult } from "@/lib/agent/libraries";
import type { ModelClient, ModelRequest, ModelStreamEvent, ToolCall } from "@/lib/agent/providers/types";

type Turn = { text: string; toolCalls?: ToolCall[] };

/** Plays the turns in order and repeats the last one when it runs out. */
function scriptedClient(turns: Turn[]): ModelClient & { requests: ModelRequest[] } {
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

function found(files: string[]): DocumentSearchResult {
  return {
    passages: files.map((source) => ({ source, text: `What ${source} says.`, found_by: ["keyword"] })),
    coverage: { searched: 10, matched: files.length, returned: files.length },
    what_this_means: "These passages CONTAIN or RESEMBLE the words asked about.",
  };
}

function libraryNamed(name: string, options: { files?: string[]; fails?: boolean } = {}): AgentLibrary {
  return {
    name,
    description: null,
    search: async () => {
      if (options.fails) throw new Error("boom");
      return found(options.files ?? ["contract_03.pdf"]);
    },
  };
}

function databaseNamed(name: string, options: { fails?: boolean; engine?: string } = {}) {
  return {
    id: `conn_${name}`,
    name,
    engine: options.engine ?? "postgres",
    schema: null,
    execute: async () => {
      if (options.fails) throw new Error("relation does not exist");
      return { queryId: "qry_1", result: { columns: [], rows: [], row_count: 0, truncated: false, duration_ms: 1 } };
    },
  };
}

const search = (id: string, input: Record<string, unknown> = { query: "termination" }): ToolCall => ({ id, name: "search_documents", input });
const runSql = (id: string, database?: string): ToolCall => ({
  id,
  name: "run_sql",
  input: { sql: "SELECT 1", purpose: "check", ...(database ? { database } : {}) },
});

/** A block as the application writes it: two trailing spaces end every line but the last. */
const written = (...lines: string[]) =>
  ["Sources:", ...lines].map((line, index, all) => (index < all.length - 1 ? `${line}  ` : line)).join("\n");

async function run(options: {
  libraries?: AgentLibrary[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  connections?: any[];
  turns: Turn[];
}) {
  const client = scriptedClient(options.turns);
  const events: AgentEvent[] = [];
  for await (const event of runAgent({
    question: "what does the contract say about termination?",
    history: [],
    playbookContext: "",
    responseDetail: "balanced",
    connections: options.connections ?? [],
    client,
    reportGenerator: null,
    libraries: options.libraries,
  })) {
    events.push(event);
  }
  const completed = events.find((event) => event.type === "completed");
  assert.ok(completed && completed.type === "completed", "the run completed");
  return {
    events,
    client,
    content: completed.content,
    steps: events.flatMap((event) => (event.type === "step" ? [event.step] : [])),
    resets: events.filter((event) => event.type === "reset").length,
  };
}

describe("a Sources block is checked against what the run really retrieved", () => {
  test("a file no search returned is removed, and the block is written by the application", async () => {
    const { content, client } = await run({
      libraries: [libraryNamed("Contracts")],
      turns: [
        { text: "", toolCalls: [search("s1")] },
        { text: "Either party may terminate on 30 days' notice.\n\nSources:\ncontract_03.pdf\nboard_minutes_2019.pdf" },
      ],
    });
    assert.equal(content, `Either party may terminate on 30 days' notice.\n\n${written("contract_03.pdf")}`);
    assert.ok(!content.includes("board_minutes_2019"));
    assert.equal(client.requests.length, 2, "nothing needed a retry");
  });

  test("the agreed format, byte for byte", async () => {
    const { content } = await run({
      libraries: [libraryNamed("Contracts")],
      connections: [databaseNamed("Sales")],
      turns: [
        { text: "", toolCalls: [runSql("q1"), search("s1")] },
        { text: "Revenue rose and the contract allows it.\n\nSources:\nPostgreSQL — Sales\ncontract_03.pdf" },
      ],
    });
    assert.equal(content, "Revenue rose and the contract allows it.\n\nSources:  \nPostgreSQL — Sales  \ncontract_03.pdf");
  });

  test("with several libraries each file is written with its library", async () => {
    const { content } = await run({
      libraries: [libraryNamed("Contracts", { files: ["contract_03.pdf"] }), libraryNamed("Policies", { files: ["policy_12.pdf"] })],
      turns: [
        { text: "", toolCalls: [search("s1", { library: "Contracts", query: "notice" }), search("s2", { library: "Policies", query: "notice" })] },
        { text: "Answer.\n\nSources:\ncontract_03.pdf (Contracts)\npolicy_12.pdf (Policies)" },
      ],
    });
    assert.equal(content, `Answer.\n\n${written("contract_03.pdf (Contracts)", "policy_12.pdf (Policies)")}`);
  });

  test("the library is written as its administrator named it, however the model spelled it in the call", async () => {
    const { content } = await run({
      libraries: [libraryNamed("Contracts", { files: ["contract_03.pdf"] }), libraryNamed("Policies", { files: ["policy_12.pdf"] })],
      turns: [
        { text: "", toolCalls: [search("s1", { library: "  contracts ", query: "notice" })] },
        { text: "Answer.\n\nSources:\ncontract_03.pdf (Contracts)" },
      ],
    });
    assert.equal(content, `Answer.\n\n${written("contract_03.pdf (Contracts)")}`);
  });

  test("a real file filed under the wrong library is removed", async () => {
    const { content } = await run({
      libraries: [libraryNamed("Contracts", { files: ["contract_03.pdf"] }), libraryNamed("Policies", { files: ["policy_12.pdf"] })],
      turns: [
        { text: "", toolCalls: [search("s1", { library: "Contracts", query: "notice" })] },
        { text: "Answer.\n\nSources:\ncontract_03.pdf (Contracts)\npolicy_12.pdf (Policies)\ncontract_03.pdf (Policies)" },
      ],
    });
    assert.equal(content, `Answer.\n\n${written("contract_03.pdf (Contracts)")}`, "policy_12.pdf was never returned by anything");
  });

  test("a file returned by one search is citable after a later search that returned others", async () => {
    let calls = 0;
    const library: AgentLibrary = {
      name: "Contracts",
      description: null,
      search: async () => found(calls++ === 0 ? ["first.pdf"] : ["second.pdf"]),
    };
    const { content } = await run({
      libraries: [library],
      turns: [
        { text: "", toolCalls: [search("s1")] },
        { text: "", toolCalls: [search("s2", { query: "again" })] },
        { text: "Answer.\n\nSources:\nfirst.pdf\nsecond.pdf" },
      ],
    });
    assert.equal(content, `Answer.\n\n${written("first.pdf", "second.pdf")}`);
  });

  test("a library the model was not given never reaches the ledger, so its files cannot be cited", async () => {
    const { content, client } = await run({
      libraries: [libraryNamed("Contracts", { files: ["contract_03.pdf"] }), libraryNamed("Policies", { files: ["policy_12.pdf"] })],
      turns: [
        { text: "", toolCalls: [search("s1", { library: "Board Minutes", query: "notice" })] },
        { text: "Answer.\n\nSources:\nboard_minutes_2019.pdf (Board Minutes)" },
      ],
    });
    assert.equal(content, "Answer.");
    assert.equal(client.requests.length, 2, "nothing was retrieved, so there is nothing to ask a retry about");
  });
});

describe("PostgreSQL sources", () => {
  test("a database that was queried may be cited and one that was not is removed", async () => {
    const { content } = await run({
      libraries: [libraryNamed("Contracts")],
      connections: [databaseNamed("Sales"), databaseNamed("Payroll")],
      turns: [
        { text: "", toolCalls: [runSql("q1", "Sales")] },
        { text: "Revenue was 5.\n\nSources:\nPostgreSQL — Sales\nPostgreSQL — Payroll" },
      ],
    });
    assert.equal(content, `Revenue was 5.\n\n${written("PostgreSQL — Sales")}`);
  });

  test("a query that failed does not make its database citable", async () => {
    const { content } = await run({
      libraries: [libraryNamed("Contracts")],
      connections: [databaseNamed("Sales", { fails: true })],
      turns: [
        { text: "", toolCalls: [runSql("q1")] },
        { text: "I could not read the figures.\n\nSources:\nPostgreSQL — Sales" },
      ],
    });
    assert.equal(content, "I could not read the figures.");
  });

  test("another engine is named for what it is", async () => {
    const { content } = await run({
      libraries: [libraryNamed("Contracts")],
      connections: [databaseNamed("Ops", { engine: "mysql" })],
      turns: [{ text: "", toolCalls: [runSql("q1")] }, { text: "Answer.\n\nSources:\nMySQL — Ops\nPostgreSQL — Ops" }],
    });
    assert.equal(content, `Answer.\n\n${written("MySQL — Ops")}`);
  });

  test("an answer that used only SQL is left alone: no block is required and none is added", async () => {
    const { content, client } = await run({
      libraries: [libraryNamed("Contracts")],
      connections: [databaseNamed("Sales")],
      turns: [{ text: "", toolCalls: [runSql("q1")] }, { text: "Revenue was 5." }],
    });
    assert.equal(content, "Revenue was 5.");
    assert.equal(client.requests.length, 2, "SQL only is not a reason to retry");
  });

  test("a cross-source answer lists both, in the order the model gave", async () => {
    const { content } = await run({
      libraries: [libraryNamed("Contracts", { files: ["contract_03.pdf", "contract_07.pdf"] })],
      connections: [databaseNamed("Sales")],
      turns: [
        { text: "", toolCalls: [runSql("q1"), search("s1")] },
        { text: "Answer.\n\nSources:\ncontract_07.pdf\nPostgreSQL — Sales\ncontract_03.pdf" },
      ],
    });
    assert.equal(content, `Answer.\n\n${written("contract_07.pdf", "PostgreSQL — Sales", "contract_03.pdf")}`);
  });
});

describe("the one corrective retry", () => {
  const RETRIEVED = { text: "", toolCalls: [search("s1")] };

  test("documents came back and the answer has no block: one retry, told what may be cited", async () => {
    const { content, client, steps, resets } = await run({
      libraries: [libraryNamed("Contracts")],
      turns: [
        RETRIEVED,
        { text: "Either party may terminate on 30 days' notice." },
        { text: "Either party may terminate on 30 days' notice.\n\nSources:\ncontract_03.pdf" },
      ],
    });

    assert.equal(client.requests.length, 3);
    assert.equal(resets, 1, "the streamed answer is discarded, as with every other retry");
    assert.ok(steps.some((step) => /without listing sources — retrying/.test(step.label)));

    const last = client.requests[2].messages.at(-1);
    assert.ok(last && last.role === "user");
    assert.match(last.content as string, /Sources:/);
    assert.match(last.content as string, /\ncontract_03\.pdf\n/);
    assert.equal(content, `Either party may terminate on 30 days' notice.\n\n${written("contract_03.pdf")}`);
  });

  test("a block whose every line was removed counts as no block, and is retried", async () => {
    const { content, client } = await run({
      libraries: [libraryNamed("Contracts")],
      turns: [RETRIEVED, { text: "Answer.\n\nSources:\nmade_up.pdf" }, { text: "Answer.\n\nSources:\ncontract_03.pdf" }],
    });
    assert.equal(client.requests.length, 3);
    assert.equal(content, `Answer.\n\n${written("contract_03.pdf")}`);
  });

  test("the retry is spent once: a second answer without a block goes out as it is", async () => {
    const { content, client, resets } = await run({
      libraries: [libraryNamed("Contracts")],
      turns: [RETRIEVED, { text: "First answer." }, { text: "Second answer." }],
    });
    assert.equal(client.requests.length, 3, "no third request");
    assert.equal(resets, 1);
    assert.equal(content, "Second answer.");
  });

  test("a retry that comes back with a made-up block is cleaned and not retried again", async () => {
    const { content, client } = await run({
      libraries: [libraryNamed("Contracts")],
      turns: [RETRIEVED, { text: "First answer." }, { text: "Second answer.\n\nSources:\nmade_up.pdf" }],
    });
    assert.equal(client.requests.length, 3);
    assert.equal(content, "Second answer.");
  });

  test("a search that returned nothing is not a retrieval, so there is nothing to cite and no retry", async () => {
    const empty: AgentLibrary = { name: "Contracts", description: null, search: async () => found([]) };
    const { content, client } = await run({
      libraries: [empty],
      turns: [RETRIEVED, { text: "The documents do not cover it." }],
    });
    assert.equal(client.requests.length, 2);
    assert.equal(content, "The documents do not cover it.");
  });

  test("a search that failed is not a retrieval either", async () => {
    const { content, client } = await run({
      libraries: [libraryNamed("Contracts", { fails: true })],
      turns: [RETRIEVED, { text: "The document service could not be reached." }],
    });
    assert.equal(client.requests.length, 2);
    assert.equal(content, "The document service could not be reached.");
  });

  test("when SQL and documents both ran and the answer lists only the database, that is a block and is not retried", async () => {
    const { content, client } = await run({
      libraries: [libraryNamed("Contracts")],
      connections: [databaseNamed("Sales")],
      turns: [{ text: "", toolCalls: [runSql("q1"), search("s1")] }, { text: "Revenue was 5.\n\nSources:\nPostgreSQL — Sales" }],
    });
    assert.equal(client.requests.length, 2);
    assert.equal(content, `Revenue was 5.\n\n${written("PostgreSQL — Sales")}`);
  });

  test("the retry can search again, and what that finds is citable", async () => {
    let calls = 0;
    const library: AgentLibrary = {
      name: "Contracts",
      description: null,
      search: async () => found(calls++ === 0 ? ["first.pdf"] : ["second.pdf"]),
    };
    const { content } = await run({
      libraries: [library],
      turns: [RETRIEVED, { text: "Answer." }, { text: "", toolCalls: [search("s2", { query: "more" })] }, { text: "Answer.\n\nSources:\nsecond.pdf" }],
    });
    assert.equal(content, `Answer.\n\n${written("second.pdf")}`);
  });
});

describe("a workspace that was never asked for a Sources block", () => {
  test("with no libraries the answer is left exactly as the model wrote it", async () => {
    const answer = "Revenue was 5.\n\nSources:\nmade_up.pdf\nPostgreSQL — Payroll\n";
    const { content, client } = await run({
      connections: [databaseNamed("Sales")],
      turns: [{ text: "", toolCalls: [runSql("q1")] }, { text: answer }],
    });
    assert.equal(content, answer.trim());
    assert.equal(client.requests.length, 2, "no retry either");
  });

  test("its prompt says nothing about Sources", async () => {
    const { client } = await run({ connections: [databaseNamed("Sales")], turns: [{ text: "Hello." }] });
    assert.ok(!/## Sources/.test(client.requests[0].system));
  });
});

describe("the prompt asks for the block only where there are libraries", () => {
  test("the block is asked for as what follows a search, not as a rule about answers that use documents", async () => {
    // Measured against the real model: "When your answer uses what a document says, ..." made it decide
    // before searching whether documents would be used, and it sometimes said they did not cover the
    // question without searching. The framing below did not. See renderSources in lib/agent/prompt.ts.
    const { client } = await run({
      libraries: [libraryNamed("Contracts")],
      connections: [databaseNamed("Sales")],
      turns: [{ text: "Hello." }],
    });
    const system = client.requests[0].system;
    assert.match(system, /After search_documents returns passages, finish your answer with a Sources block/);
    assert.ok(!/uses what a document says/.test(system));
    assert.ok(!/If your answer uses no document/.test(system));
  });

  test("one library, one database", async () => {
    const { client } = await run({
      libraries: [libraryNamed("Contracts")],
      connections: [databaseNamed("Sales")],
      turns: [{ text: "Hello." }],
    });
    const system = client.requests[0].system;
    assert.match(system, /## Sources/);
    assert.match(system, /"PostgreSQL — Sales"/);
    assert.ok(!/file name \(library name\)/.test(system), "one library needs no library beside the file");
  });

  test("several libraries: the library is written beside the file", async () => {
    const { client } = await run({
      libraries: [libraryNamed("Contracts"), libraryNamed("Policies")],
      turns: [{ text: "Hello." }],
    });
    const system = client.requests[0].system;
    assert.match(system, /file name \(library name\)/);
    assert.ok(!/A database is written/.test(system), "no database, so nothing about database lines");
  });
});

describe("running out of steps", () => {
  test("the answer that is left is checked like any other", async () => {
    const turns: Turn[] = [
      { text: "", toolCalls: [search("s1")] },
      ...Array.from({ length: 11 }, (_, index): Turn => ({ text: "", toolCalls: [search(`s${index + 2}`)] })),
    ];
    // The last round before the limit carries the text that will be left over.
    turns[11] = { text: "Partial answer.\n\nSources:\ncontract_03.pdf\nmade_up.pdf", toolCalls: [search("last")] };
    const { content, steps } = await run({ libraries: [libraryNamed("Contracts")], turns });
    assert.ok(steps.some((step) => /Stopped after the maximum number of steps/.test(step.label)));
    assert.equal(content, `Partial answer.\n\n${written("contract_03.pdf")}`);
  });
});
