/**
 * The agent loop with document libraries: what a model can and cannot do with
 * them, and what happens around a failed search.
 *
 * The model is scripted, on purpose. These are not tests of whether a model
 * behaves well (that is what the evals measure). They are tests that even when
 * a model behaves badly, by naming a library it was not given, by putting a
 * tenant id or a token in a tool call, or by hitting a search that errors, the
 * loop does the safe thing: nothing outside the authorized set is reached and
 * nothing about a failure's real cause is repeated to the model or the reader.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { runAgent, type AgentEvent } from "@/lib/agent";
import {
  DOCUMENT_SEARCH_MESSAGES,
  DocumentSearchError,
  type AgentLibrary,
  type DocumentSearchResult,
} from "@/lib/agent/libraries";
import type { ModelClient, ModelRequest, ModelStreamEvent, ToolCall } from "@/lib/agent/providers/types";

function scriptedClient(turns: { text: string; toolCalls?: ToolCall[] }[]): ModelClient & { requests: ModelRequest[] } {
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

const PASSAGES: DocumentSearchResult = {
  passages: [{ source: "contract_03.pdf", text: "Either party may terminate on 30 days' notice.", found_by: ["keyword", "vector"] }],
  coverage: { searched: 10, matched: 3, returned: 1 },
  what_this_means: "These passages CONTAIN or RESEMBLE the words asked about.",
};

/** A library that records what it was asked, and hides `sealed` where a model could never reach it. */
function libraryNamed(name: string, options: { description?: string | null; sealed?: string; fails?: unknown } = {}) {
  const asked: string[] = [];
  const sealed = options.sealed ?? `sealed-key-for-${name}`;
  const library: AgentLibrary = {
    name,
    description: options.description ?? null,
    search: async (query: string) => {
      asked.push(query);
      void sealed;
      if (options.fails !== undefined) throw options.fails;
      return PASSAGES;
    },
  };
  return { library, asked, sealed };
}

function search(id: string, input: Record<string, unknown>): ToolCall {
  return { id, name: "search_documents", input };
}

function runSql(id: string, input: Record<string, unknown>): ToolCall {
  return { id, name: "run_sql", input };
}

function databaseNamed(name: string) {
  const calls: string[] = [];
  return {
    calls,
    connection: {
      id: `conn_${name}`,
      name,
      engine: "postgres",
      schema: null,
      execute: async (sql: string) => {
        calls.push(sql);
        return { queryId: `qry_${calls.length}`, result: { columns: [], rows: [], row_count: 0, truncated: false, duration_ms: 1 } };
      },
    },
  };
}

async function runWith(options: {
  libraries?: AgentLibrary[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  connections?: any[];
  turns: { text: string; toolCalls?: ToolCall[] }[];
  question?: string;
}) {
  const client = scriptedClient(options.turns);
  const events: AgentEvent[] = [];
  for await (const event of runAgent({
    question: options.question ?? "what does the contract say about termination?",
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
  return { events, client };
}

const steps = (events: AgentEvent[]) => events.flatMap((e) => (e.type === "step" ? [e.step] : []));

/** The tool result the model was given after its first turn. */
function toolResult(client: { requests: ModelRequest[] }, requestIndex = 1) {
  const message = client.requests[requestIndex].messages.filter((m) => m.role === "tool").at(-1);
  return message && message.role === "tool" ? message : null;
}

describe("what the model is offered", () => {
  test("no libraries means no search tool at all", async () => {
    const { client } = await runWith({ connections: [databaseNamed("Sales").connection], turns: [{ text: "Hello." }] });
    assert.deepEqual(client.requests[0].tools.map((t) => t.name), ["run_sql"]);
  });

  test("libraries add search_documents beside run_sql", async () => {
    const { client } = await runWith({
      connections: [databaseNamed("Sales").connection],
      libraries: [libraryNamed("Contracts").library],
      turns: [{ text: "Hello." }],
    });
    assert.deepEqual(client.requests[0].tools.map((t) => t.name), ["run_sql", "search_documents"]);
  });

  test("one library has no selector; several do", async () => {
    const one = await runWith({ libraries: [libraryNamed("Contracts").library], turns: [{ text: "Hi." }] });
    const many = await runWith({ libraries: [libraryNamed("Contracts").library, libraryNamed("HR").library], turns: [{ text: "Hi." }] });
    const properties = (r: typeof one) => Object.keys((r.client.requests[0].tools[0].parameters as { properties: object }).properties);
    assert.deepEqual(properties(one), ["query"]);
    assert.deepEqual(properties(many), ["library", "query"]);
  });

  test("the prompt names each library and what it holds, and nothing that says where it is", async () => {
    const contracts = libraryNamed("Contracts", { description: "Supplier and customer contracts.", sealed: "sealed-alias-XYZ-123" });
    const { client } = await runWith({
      libraries: [contracts.library, libraryNamed("HR Policies").library],
      turns: [{ text: "Hi." }],
    });
    const system = client.requests[0].system;
    assert.match(system, /## Document libraries/);
    assert.match(system, /- "Contracts": Supplier and customer contracts\./);
    assert.match(system, /- "HR Policies"/);
    assert.ok(!system.includes("sealed-alias-XYZ-123"), "a library's key must not be in the prompt");
    assert.ok(!JSON.stringify(client.requests[0].tools).includes("sealed-alias-XYZ-123"));
  });
});

describe("authorization: the model names, the application decides", () => {
  test("a library it was not given is refused, reaches nothing, and the refusal lists only what it has", async () => {
    const contracts = libraryNamed("Contracts");
    const hr = libraryNamed("HR Policies");
    const { client, events } = await runWith({
      libraries: [contracts.library, hr.library],
      turns: [{ text: "", toolCalls: [search("c1", { library: "Board Minutes", query: "quarterly results" })] }, { text: "I cannot search that." }],
    });
    assert.deepEqual(contracts.asked, []);
    assert.deepEqual(hr.asked, []);
    const result = toolResult(client);
    assert.equal(result?.isError, true);
    assert.match(String(result?.content), /No document library named "Board Minutes"/);
    assert.match(String(result?.content), /Available: Contracts, HR Policies\./);
    assert.ok(!steps(events).some((s) => s.label.startsWith("Searched")), "no search step for a refused call");
  });

  test("with a choice to make, a call with no library is refused", async () => {
    const contracts = libraryNamed("Contracts");
    const hr = libraryNamed("HR Policies");
    const { client } = await runWith({
      libraries: [contracts.library, hr.library],
      turns: [{ text: "", toolCalls: [search("c1", { query: "termination" })] }, { text: "Done." }],
    });
    assert.deepEqual([contracts.asked, hr.asked], [[], []]);
    assert.match(String(toolResult(client)?.content), /Say which library to search/);
  });

  test("the right library is searched, once, and only that one", async () => {
    const contracts = libraryNamed("Contracts");
    const hr = libraryNamed("HR Policies");
    const { events } = await runWith({
      libraries: [contracts.library, hr.library],
      turns: [{ text: "", toolCalls: [search("c1", { library: "hr policies", query: "parental leave" })] }, { text: "Done." }],
    });
    assert.deepEqual(hr.asked, ["parental leave"]);
    assert.deepEqual(contracts.asked, []);
    assert.ok(steps(events).some((s) => s.label === 'Searched "HR Policies": parental leave'));
  });

  test("a tenant id, a key, a token or an address in the call is ignored, and the search receives the question only", async () => {
    const contracts = libraryNamed("Contracts");
    const { client } = await runWith({
      libraries: [contracts.library],
      turns: [
        {
          text: "",
          toolCalls: [
            search("c1", {
              query: "termination",
              tenant_id: "some-other-tenant",
              alias_id: "some-other-alias",
              library_id: "lib_other",
              token: "Bearer stolen",
              base_url: "http://evil.invalid",
              endpoint: "http://evil.invalid/api/v1",
              headers: { "X-Syslab-Tenant": "evil" },
            }),
          ],
        },
        { text: "Done." },
      ],
    });
    assert.deepEqual(contracts.asked, ["termination"], "the search got the question and nothing else");
    assert.equal(toolResult(client)?.isError, false);
    // The model's own call is part of the conversation and so is echoed in its
    // history; what must not carry anything it supplied is the tool result.
    assert.ok(!String(toolResult(client)?.content).includes("evil"), "nothing the model supplied comes back in the result");
  });

  test("with a single library a name the model volunteers changes nothing", async () => {
    const contracts = libraryNamed("Contracts");
    const { events } = await runWith({
      libraries: [contracts.library],
      turns: [{ text: "", toolCalls: [search("c1", { library: "Something Else Entirely", query: "termination" })] }, { text: "Done." }],
    });
    assert.deepEqual(contracts.asked, ["termination"]);
    assert.ok(steps(events).some((s) => s.label === "Searched documents: termination"));
  });

  test("two libraries with the same name are refused rather than one picked for the model", async () => {
    const first = libraryNamed("Contracts");
    const second = libraryNamed("contracts");
    const other = libraryNamed("HR Policies");
    const { client } = await runWith({
      libraries: [first.library, second.library, other.library],
      turns: [{ text: "", toolCalls: [search("c1", { library: "Contracts", query: "termination" })] }, { text: "Done." }],
    });
    assert.deepEqual([first.asked, second.asked, other.asked], [[], [], []]);
    assert.match(String(toolResult(client)?.content), /More than one library is named/);
  });

  test("with no libraries at all, calling search_documents anyway reaches nothing", async () => {
    const { client } = await runWith({
      connections: [databaseNamed("Sales").connection],
      turns: [{ text: "", toolCalls: [search("c1", { query: "termination" })] }, { text: "Done." }],
    });
    assert.equal(toolResult(client)?.isError, true);
    assert.match(String(toolResult(client)?.content), /not available in this workspace/);
  });

  test("an empty question is refused before any search", async () => {
    const contracts = libraryNamed("Contracts");
    await runWith({
      libraries: [contracts.library],
      turns: [{ text: "", toolCalls: [search("c1", { query: "   " })] }, { text: "Done." }],
    });
    assert.deepEqual(contracts.asked, []);
  });
});

describe("when a search fails", () => {
  const categories = ["not_configured", "not_linked", "auth", "unavailable", "timeout"] as const;

  for (const category of categories) {
    test(`${category}: the model and the reader get one fixed sentence`, async () => {
      const failing = libraryNamed("Contracts", { fails: new DocumentSearchError(category) });
      const { client, events } = await runWith({
        libraries: [failing.library],
        turns: [{ text: "", toolCalls: [search("c1", { query: "termination" })] }, { text: "I could not search the documents." }],
      });
      const sentence = DOCUMENT_SEARCH_MESSAGES[category];
      const result = toolResult(client);
      assert.equal(result?.isError, true);
      assert.equal(result?.content, `Document search failed: ${sentence} Do not guess what the documents say.`);
      const failed = steps(events).find((s) => s.status === "failed");
      assert.equal(failed?.detail, sentence);
      assert.equal(failed?.label, "Searching documents: termination");
    });
  }

  test("an unexpected error, however informative, is never repeated to the model or the reader", async () => {
    const leaky = new Error("connect ECONNREFUSED http://10.20.30.40:8080/api/v1/retrieve (Authorization: Bearer sk-live-abc123, tenant key-for-acme)");
    const failing = libraryNamed("Contracts", { fails: leaky });
    const { client, events } = await runWith({
      libraries: [failing.library],
      turns: [{ text: "", toolCalls: [search("c1", { query: "termination" })] }, { text: "I could not search the documents." }],
    });
    const everything = JSON.stringify(events) + JSON.stringify(client.requests.flatMap((r) => r.messages));
    for (const secret of ["10.20.30.40", "sk-live-abc123", "ECONNREFUSED", "key-for-acme", "Authorization"]) {
      assert.ok(!everything.includes(secret), `'${secret}' must not reach the model or the reader`);
    }
    assert.match(String(toolResult(client)?.content), new RegExp(DOCUMENT_SEARCH_MESSAGES.unknown));
  });

  test("the run still completes, and the answer can say the search was unavailable", async () => {
    const failing = libraryNamed("Contracts", { fails: new DocumentSearchError("unavailable") });
    const { events } = await runWith({
      libraries: [failing.library],
      turns: [{ text: "", toolCalls: [search("c1", { query: "termination" })] }, { text: "The document service is unavailable, so I cannot say." }],
    });
    const completed = events.find((e) => e.type === "completed");
    assert.ok(completed && completed.type === "completed");
    assert.match(completed.content, /unavailable/);
  });

  test("with several libraries the failed step says which one", async () => {
    const failing = libraryNamed("HR Policies", { fails: new DocumentSearchError("not_linked") });
    const { events } = await runWith({
      libraries: [libraryNamed("Contracts").library, failing.library],
      turns: [{ text: "", toolCalls: [search("c1", { library: "HR Policies", query: "leave" })] }, { text: "Done." }],
    });
    assert.equal(steps(events).find((s) => s.status === "failed")?.label, 'Searching "HR Policies": leave');
  });
});

describe("one source, another, or both", () => {
  test("a question can use the database and a library in the same run, each reaching only its own", async () => {
    const sales = databaseNamed("Sales");
    const contracts = libraryNamed("Contracts");
    const { events } = await runWith({
      connections: [sales.connection],
      libraries: [contracts.library],
      question: "how many orders were late, and what does the contract say about late delivery?",
      turns: [
        { text: "", toolCalls: [runSql("c1", { sql: "SELECT count(*) FROM orders WHERE late", purpose: "count late orders" })] },
        { text: "", toolCalls: [search("c2", { query: "late delivery penalty" })] },
        { text: "Twelve orders were late. The contract allows termination on 30 days' notice." },
      ],
    });
    assert.equal(sales.calls.length, 1);
    assert.deepEqual(contracts.asked, ["late delivery penalty"]);
    const labels = steps(events).map((s) => s.label);
    assert.ok(labels.includes("count late orders"), `steps: ${labels.join(" | ")}`);
    assert.ok(labels.includes("Searched documents: late delivery penalty"));
    assert.ok(!labels.some((l) => /retrying/i.test(l)), "a run that used both must not be retried");
    assert.ok(events.some((e) => e.type === "completed"));
  });

  test("a document answer with figures in it, after a search, is not treated as unbacked and retried", async () => {
    const contracts = libraryNamed("Contracts");
    const { events, client } = await runWith({
      libraries: [contracts.library],
      turns: [
        { text: "", toolCalls: [search("c1", { query: "termination notice" })] },
        { text: "Either party may terminate on 30 days' notice (contract_03.pdf)." },
      ],
    });
    assert.equal(client.requests.length, 2, "one turn to search, one to answer, and no retry");
    assert.ok(!steps(events).some((s) => /retrying/i.test(s.label)));
  });

  test("a run that only searched documents never touches the database it was also given", async () => {
    const sales = databaseNamed("Sales");
    const contracts = libraryNamed("Contracts");
    await runWith({
      connections: [sales.connection],
      libraries: [contracts.library],
      turns: [{ text: "", toolCalls: [search("c1", { query: "termination" })] }, { text: "Done." }],
    });
    assert.deepEqual(sales.calls, []);
  });

  test("a workspace with only libraries is not told to attach a database", async () => {
    const { client } = await runWith({ libraries: [libraryNamed("Contracts").library], turns: [{ text: "Hi." }] });
    const system = client.requests[0].system;
    assert.ok(!/explain that a connection needs to be selected/.test(system));
    assert.match(system, /No database is attached to this conversation, so you cannot run queries\. Answer from the document libraries/);
    assert.deepEqual(client.requests[0].tools.map((t) => t.name), ["search_documents"]);
  });

  test("with only libraries, run_sql is not offered, and a model that calls it anyway is told no database is attached", async () => {
    const { client } = await runWith({
      libraries: [libraryNamed("Contracts").library],
      turns: [{ text: "", toolCalls: [runSql("c1", { sql: "SELECT 1", purpose: "x" })] }, { text: "Done." }],
    });
    assert.match(String(toolResult(client)?.content), /No database is attached/);
  });
});
