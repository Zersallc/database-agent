/**
 * The eval harness's own machinery, with scripted clients.
 *
 * The evals measure a real model, and what they report is only as good as the
 * equipment: whether a run that the gateway turned away is counted as the model
 * failing, whether the pacing really holds under the provider's limit, whether a
 * fixture library behaves like the real one where it matters. None of that needs
 * a model to check, and a mistake in it would move every number the evals
 * produce without anyone noticing, so it is tested here.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { classifyRun, providerErrorOf } from "@/evals/classify";
import { runCaseRepeated, toolCallsIn } from "@/evals/harness";
import { buildFixtureLibraries, searchFixture } from "@/evals/libraries";
import { CONTRACTS, HR_POLICIES, salesDatabase } from "@/evals/media-fixtures";
import { emptyMeter, meteredClient, pacedClient } from "@/evals/meter";
import { fisherExact, wilson } from "@/evals/stats";
import type { EvalCase } from "@/evals/types";
import type { ModelClient, ModelRequest, ModelStreamEvent, ToolCall } from "@/lib/agent/providers/types";
import { ModelProviderError } from "@/lib/agent/providers/types";

describe("classifyRun: which runs are the model's to pass or fail", () => {
  const failure = (retryAfter: number | null = null) => ({ code: "upstream_model_error", message: "x", retryAfter });

  test("a run with no failure is valid", () => {
    assert.equal(classifyRun(null, null).status, "valid");
  });

  test("HTTP 429 is rate limiting, whatever the loop said", () => {
    assert.equal(classifyRun(failure(), { status: 429, message: "slow down" }).status, "rate_limited");
    assert.equal(classifyRun(failure(10), null).status, "rate_limited");
  });

  test("a server error, a timeout, a reset connection and a stream that ends early are infrastructure", () => {
    for (const status of [500, 502, 503, 504, 408, undefined]) {
      assert.equal(classifyRun(failure(), { status, message: "x" }).status, "infrastructure", String(status));
    }
  });

  test("a rejected key or an unknown model is a setup failure that would repeat every time", () => {
    for (const status of [401, 403, 404]) {
      const result = classifyRun(failure(), { status, message: "x" });
      assert.equal(result.status, "execution_failure");
      assert.equal(result.setup, true, String(status));
    }
  });

  test("any other rejection of the request is an execution failure, not the network's and not a setup mistake", () => {
    for (const status of [400, 413, 422]) {
      const result = classifyRun(failure(), { status, message: "x" });
      assert.equal(result.status, "execution_failure");
      assert.equal(result.setup, false);
    }
  });

  test("a loop that failed with no provider error (a refusal, a cut-off reply) is an execution failure", () => {
    assert.equal(classifyRun(failure(), null).status, "execution_failure");
  });

  test("the status is read from the error, not from wording", () => {
    assert.deepEqual(providerErrorOf(new ModelProviderError("The provider did not respond", undefined)), {
      status: undefined,
      message: "The provider did not respond",
    });
    assert.equal(providerErrorOf(new ModelProviderError("rate limiting? no, a 500", 500)).status, 500);
    assert.equal(providerErrorOf("plain string").status, undefined);
  });
});

/** A client that plays scripted behavior, one entry per request. */
type Step = { text: string; toolCalls?: ToolCall[] } | { throws: number | "network" };

function scripted(steps: Step[]): ModelClient & { requests: ModelRequest[] } {
  const requests: ModelRequest[] = [];
  let index = 0;
  return {
    kind: "openai_compatible",
    model: "test-model",
    requests,
    async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
      requests.push({ ...request, messages: [...request.messages] });
      const step = steps[Math.min(index, steps.length - 1)];
      index += 1;
      if ("throws" in step) {
        throw new ModelProviderError(step.throws === "network" ? "connect ECONNRESET" : `HTTP ${step.throws}`, step.throws === "network" ? undefined : step.throws);
      }
      yield { type: "text_delta", text: step.text };
      yield {
        type: "turn",
        turn: {
          text: step.text,
          toolCalls: step.toolCalls ?? [],
          stopReason: step.toolCalls?.length ? "tool_use" : "end_turn",
          refusalDetail: null,
          usage: { input_tokens: 100, output_tokens: 10 },
          model: "test-model",
        },
      };
    },
    async probe() {
      return { ok: true, latency_ms: 1, detail: null, model_available: true };
    },
  } as ModelClient & { requests: ModelRequest[] };
}

describe("meteredClient", () => {
  test("counts requests and tokens, and tells a judge call from an agent call by its tools", async () => {
    const meter = meteredClient(scripted([{ text: "hi" }]));
    for await (const event of meter.client.stream({ system: "s", messages: [], tools: [{ name: "t", description: "", parameters: {} }], maxTokens: 1, effort: "low", enableThinking: false, temperature: null, topP: null })) void event;
    for await (const event of meter.client.stream({ system: "s", messages: [], tools: [], maxTokens: 1, effort: "low", enableThinking: false, temperature: null, topP: null })) void event;
    assert.equal(meter.agent.calls, 1);
    assert.equal(meter.judge.calls, 1);
    assert.equal(meter.agent.input_tokens, 100);
    assert.equal(meter.judge.output_tokens, 10);
  });

  test("counts a 429 apart from other errors and keeps the last status", async () => {
    const limited = meteredClient(scripted([{ throws: 429 }]));
    await assert.rejects(async () => {
      for await (const event of limited.client.stream({ system: "s", messages: [], tools: [{ name: "t", description: "", parameters: {} }], maxTokens: 1, effort: "low", enableThinking: false, temperature: null, topP: null })) void event;
    });
    assert.equal(limited.agent.rate_limited, 1);
    assert.equal(limited.agent.errors, 0);
    assert.equal(limited.lastError()?.status, 429);
    limited.clearError();
    assert.equal(limited.lastError(), null);

    const broken = meteredClient(scripted([{ throws: 500 }]));
    await assert.rejects(async () => {
      for await (const event of broken.client.stream({ system: "s", messages: [], tools: [{ name: "t", description: "", parameters: {} }], maxTokens: 1, effort: "low", enableThinking: false, temperature: null, topP: null })) void event;
    });
    assert.equal(broken.agent.errors, 1);
    assert.equal(broken.agent.rate_limited, 0);
  });

  test("a fresh meter is all zeros", () => {
    assert.deepEqual(emptyMeter(), { calls: 0, input_tokens: 0, output_tokens: 0, rate_limited: 0, errors: 0 });
  });
});

describe("pacedClient: never more than the limit in any minute", () => {
  test("the request over the limit waits until the oldest has aged out", async () => {
    let now = 1_000_000;
    const sleeps: number[] = [];
    const clock = {
      now: () => now,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        now += ms;
      },
    };
    const paced = pacedClient(scripted([{ text: "x" }]), 3, clock);
    const request: ModelRequest = { system: "s", messages: [], tools: [], maxTokens: 1, effort: "low", enableThinking: false, temperature: null, topP: null };
    const starts: number[] = [];
    for (let i = 0; i < 5; i++) {
      for await (const event of paced.stream(request)) void event;
      starts.push(now);
      now += 1000;
    }
    assert.equal(sleeps.length >= 1, true, "the fourth request had to wait");
    // No sliding 60 s window ever holds more than 3 request starts.
    for (const at of starts) {
      const inWindow = starts.filter((other) => other <= at && at - other < 60_000).length;
      assert.ok(inWindow <= 3, `${inWindow} starts within a minute ending at ${at}`);
    }
  });

  test("under the limit it never waits", async () => {
    let now = 0;
    const sleeps: number[] = [];
    const paced = pacedClient(scripted([{ text: "x" }]), 40, { now: () => now, sleep: async (ms) => void sleeps.push(ms) });
    const request: ModelRequest = { system: "s", messages: [], tools: [], maxTokens: 1, effort: "low", enableThinking: false, temperature: null, topP: null };
    for (let i = 0; i < 10; i++) {
      for await (const event of paced.stream(request)) void event;
      now += 100;
    }
    assert.deepEqual(sleeps, []);
  });
});

describe("statistics", () => {
  test("Wilson interval behaves at the ends, where the plain one does not", () => {
    const all = wilson(10, 10);
    assert.ok(all.high === 1 && Math.abs(all.low - 0.7225) < 0.001, JSON.stringify(all));
    const none = wilson(0, 10);
    assert.ok(none.low === 0 && Math.abs(none.high - 0.2775) < 0.001, JSON.stringify(none));
  });

  test("Fisher exact: ten of ten against eight of ten is not evidence of a difference", () => {
    assert.ok(Math.abs(fisherExact({ pass: 10, n: 10 }, { pass: 8, n: 10 }) - 0.4737) < 0.001);
  });

  test("Fisher exact: ten of ten against three of ten is", () => {
    assert.ok(fisherExact({ pass: 10, n: 10 }, { pass: 3, n: 10 }) < 0.01);
  });

  test("identical groups give p = 1", () => {
    assert.equal(fisherExact({ pass: 7, n: 10 }, { pass: 7, n: 10 }), 1);
  });
});

describe("the fixture retriever behaves like the real one where it matters", () => {
  test("a relevant question returns the passage, and only matching passages", () => {
    const result = searchFixture(CONTRACTS, "what notice period applies to termination");
    assert.deepEqual(result.passages.map((p) => p.source), ["contract_03.pdf"]);
    assert.equal(result.coverage.matched, 1);
    assert.ok(/CONTAIN or RESEMBLE/.test(result.what_this_means));
  });

  test("a paraphrase finds the passage through its aliases, as semantic search would", () => {
    const result = searchFixture(CONTRACTS, "if somebody else gets a cheaper deal do we get it too");
    assert.ok(result.passages.some((p) => p.source === "contract_11.pdf"));
  });

  test("nothing matching returns an empty list and the real service's sentence, word for word", () => {
    const result = searchFixture(HR_POLICIES, "quarterly semiconductor tariffs");
    assert.deepEqual(result.passages, []);
    assert.equal(result.coverage.matched, 0);
    assert.match(result.what_this_means, /^Nothing in this customer's indexed passages matched those words\. That is not evidence the material does not discuss it/);
  });

  test("a search is logged with the files it returned, so grades come from what was really returned", async () => {
    const log: import("@/evals/types").SearchRecord[] = [];
    const [contracts] = buildFixtureLibraries([CONTRACTS], log);
    await contracts.search("late delivery penalty");
    assert.equal(log.length, 1);
    assert.equal(log[0].library, "Contracts");
    assert.deepEqual(log[0].returned, ["contract_07.pdf"]);
  });
});

describe("toolCallsIn: what the model did, in order", () => {
  const search = (id: string, input: Record<string, unknown>): ToolCall => ({ id, name: "search_documents", input });
  const sql = (id: string, input: Record<string, unknown>): ToolCall => ({ id, name: "run_sql", input });

  test("keeps the order, resolves the target, and marks a refused call", () => {
    const messages: ModelRequest["messages"] = [
      { role: "user", content: "q" },
      { role: "assistant", content: "", toolCalls: [sql("a", { sql: "select 1" }), search("b", { library: " contracts ", query: "x" })] },
      { role: "tool", toolCallId: "a", toolName: "run_sql", content: "ok", isError: false },
      { role: "tool", toolCallId: "b", toolName: "search_documents", content: "ok", isError: false },
      { role: "assistant", content: "", toolCalls: [search("c", { library: "Board Minutes", query: "y" })] },
      { role: "tool", toolCallId: "c", toolName: "search_documents", content: "No document library named", isError: true },
    ];
    const calls = toolCallsIn(messages, ["Sales"], ["Contracts", "HR Policies"]);
    assert.deepEqual(
      calls.map((call) => [call.name, call.ok, call.database, call.library]),
      [
        ["run_sql", true, "Sales", null],
        ["search_documents", true, null, "Contracts"],
        ["search_documents", false, null, "Board Minutes"],
      ]
    );
  });

  test("with one library the model's own spelling is irrelevant", () => {
    const messages: ModelRequest["messages"] = [
      { role: "assistant", content: "", toolCalls: [search("a", { library: "whatever", query: "x" })] },
      { role: "tool", toolCallId: "a", toolName: "search_documents", content: "ok", isError: false },
    ];
    assert.equal(toolCallsIn(messages, [], ["Contracts"])[0].library, "Contracts");
  });
});

describe("runCaseRepeated: what becomes of each scheduled run", () => {
  const search: ToolCall = { id: "s1", name: "search_documents", input: { query: "termination notice" } };

  const kase: EvalCase = {
    id: "probe",
    description: "what notice does the supplier contract require?",
    family: "media-only",
    question: "What notice period does the supplier contract require for termination?",
    connections: [],
    libraries: [CONTRACTS],
    sources: { required: ["lib:Contracts"] },
    grade: (outcome) => ({ pass: /thirty/i.test(outcome.finalText), reason: "mentions thirty days", category: "answer" }),
  };
  const fast = { backoff: { rateLimitedMs: 0, infrastructureMs: 0 }, sleep: async () => {} };

  test("a run that answers is graded and recorded in full", async () => {
    const meter = meteredClient(scripted([{ text: "", toolCalls: [search] }, { text: "Thirty (30) days.\n\nSources:\ncontract_03.pdf" }]));
    const { runs } = await runCaseRepeated(kase, meter, 1, fast);
    const [run] = runs;
    assert.equal(run.status, "valid");
    assert.equal(run.attempts, 1);
    assert.equal(run.grade?.pass, true);
    assert.deepEqual(run.tools, ["search_documents"]);
    assert.equal(run.documents_retrieved, true);
    assert.equal(run.delivered_block, true);
    assert.equal(run.provenance_retry, false);
    assert.deepEqual(run.unnecessary_sources, []);
    assert.deepEqual(run.missing_sources, []);
    assert.equal(run.requests, 2);
    assert.equal(run.input_tokens, 200);
  });

  test("a rate limit is waited out and retried, and is not counted against the model", async () => {
    const meter = meteredClient(scripted([{ throws: 429 }, { text: "The notice period is thirty days." }]));
    const { runs } = await runCaseRepeated(kase, meter, 1, fast);
    assert.equal(runs[0].status, "valid");
    assert.equal(runs[0].attempts, 2);
    assert.equal(runs[0].rate_limited_requests, 1);
    assert.equal(runs[0].grade?.pass, true);
  });

  test("a run that stays rate limited is recorded as such, never graded, and the next run goes ahead", async () => {
    const meter = meteredClient(scripted([{ throws: 429 }, { throws: 429 }, { throws: 429 }, { text: "The notice period is thirty days." }]));
    const { runs } = await runCaseRepeated(kase, meter, 2, fast);
    assert.equal(runs[0].status, "rate_limited");
    assert.equal(runs[0].grade, null, "a run that never reached the model has no grade");
    assert.equal(runs[0].attempts, 3);
    assert.equal(runs[1].status, "valid");
  });

  test("an unreachable server is infrastructure, not a model failure", async () => {
    const meter = meteredClient(scripted([{ throws: "network" }]));
    const { runs } = await runCaseRepeated(kase, meter, 1, { ...fast, maxAttempts: 2 });
    assert.equal(runs[0].status, "infrastructure");
    assert.equal(runs[0].grade, null);
    assert.equal(runs[0].attempts, 2);
  });

  test("a server error is infrastructure too", async () => {
    const meter = meteredClient(scripted([{ throws: 503 }]));
    const { runs } = await runCaseRepeated(kase, meter, 1, { ...fast, maxAttempts: 1 });
    assert.equal(runs[0].status, "infrastructure");
    assert.equal(runs[0].failure?.http_status, 503);
  });

  test("a rejected request is an execution failure and is not retried", async () => {
    const meter = meteredClient(scripted([{ throws: 400 }]));
    const { runs } = await runCaseRepeated(kase, meter, 1, fast);
    assert.equal(runs[0].status, "execution_failure");
    assert.equal(runs[0].attempts, 1);
  });

  test("a rejected key stops the case at once, since every later run would fail the same way", async () => {
    const meter = meteredClient(scripted([{ throws: 401 }]));
    const result = await runCaseRepeated(kase, meter, 10, fast);
    assert.equal(result.runs.length, 1);
    assert.ok(result.setupFailure);
    assert.match(result.stopped ?? "", /setup failure/);
  });

  test("a case that keeps failing is given up on rather than spending every scheduled run", async () => {
    const meter = meteredClient(scripted([{ throws: 500 }]));
    const result = await runCaseRepeated(kase, meter, 10, { ...fast, maxAttempts: 1, maxConsecutiveFailures: 3 });
    assert.equal(result.runs.length, 3);
    assert.match(result.stopped ?? "", /3 runs in a row/);
  });

  test("a valid run resets the count of consecutive failures", async () => {
    const meter = meteredClient(scripted([{ throws: 500 }, { text: "The notice period is thirty days." }, { throws: 500 }, { text: "The notice period is thirty days." }]));
    const result = await runCaseRepeated(kase, meter, 4, { ...fast, maxAttempts: 1, maxConsecutiveFailures: 2 });
    assert.equal(result.runs.length, 4);
    assert.equal(result.stopped, null);
  });

  test("a judge call that is rate limited is the equipment failing, not the answer failing the grade", async () => {
    const judged: EvalCase = {
      ...kase,
      grade: async (_outcome, client) => {
        for await (const event of client.stream({ system: "j", messages: [], tools: [], maxTokens: 1, effort: "low", enableThinking: false, temperature: 0, topP: 1 })) void event;
        return { pass: true, reason: "judged" };
      },
    };
    const meter = meteredClient(scripted([{ text: "The notice period is thirty days." }, { throws: 429 }]));
    const { runs } = await runCaseRepeated(judged, meter, 1, { ...fast, maxAttempts: 1 });
    assert.equal(runs[0].status, "rate_limited");
    assert.equal(runs[0].grade, null);
  });

  test("a source the question did not need is recorded even when the answer is right", async () => {
    const wrong: EvalCase = { ...kase, libraries: [CONTRACTS, HR_POLICIES], sources: { required: ["lib:Contracts"] } };
    const meter = meteredClient(
      scripted([
        { text: "", toolCalls: [{ id: "a", name: "search_documents", input: { library: "Contracts", query: "termination notice" } }, { id: "b", name: "search_documents", input: { library: "HR Policies", query: "leave" } }] },
        { text: "The notice period is thirty days." },
      ])
    );
    const { runs } = await runCaseRepeated(wrong, meter, 1, fast);
    assert.deepEqual(runs[0].unnecessary_sources, ["lib:HR Policies"]);
    assert.deepEqual(runs[0].missing_sources, []);
  });

  test("libraries added to a case that never asked for them make any search an unnecessary call", async () => {
    const legacy: EvalCase = {
      id: "legacy-probe",
      description: "a SQL question",
      question: "How many orders were delivered late?",
      connections: [salesDatabase()],
      grade: () => ({ pass: true, reason: "ok" }),
    };
    const meter = meteredClient(
      scripted([
        { text: "", toolCalls: [{ id: "a", name: "run_sql", input: { sql: "select count(*) from orders" } }, search] },
        { text: "12." },
      ])
    );
    const { runs } = await runCaseRepeated(legacy, meter, 1, { ...fast, extraLibraries: [CONTRACTS] });
    assert.deepEqual(runs[0].unnecessary_sources, ["lib:Contracts"]);
  });
});
