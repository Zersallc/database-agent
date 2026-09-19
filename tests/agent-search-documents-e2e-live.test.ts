/**
 * The Agent-E2E test: drives the REAL runAgent() loop, with a REAL
 * documentSearch wired to a REAL syslab-server deployment, through a REAL
 * network call — the only thing scripted is the model's two turns, the same
 * way every other agent test in this suite (agent-retry.test.ts and
 * friends) drives runAgent() with a fake ModelClient rather than a live LLM.
 * Scripting the model is not a shortcut on the thing being tested here: the
 * question is whether the AGENT LOOP's tool dispatch, not the model's
 * judgement, correctly reaches syslab-server and folds a real hybrid result
 * back into the conversation.
 *
 * Skipped entirely unless RETRIEVAL_BASE_URL/RETRIEVAL_TOKEN/
 * RETRIEVAL_TEST_TENANT are set.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { runAgent, type AgentEvent } from "@/lib/agent";
import type { ModelClient, ModelStreamEvent, ModelTurn } from "@/lib/agent/providers";
import { RetrievalClient } from "@/lib/services/retrieval-client";

const BASE_URL = process.env.RETRIEVAL_BASE_URL;
const TOKEN = process.env.RETRIEVAL_TOKEN;
const TENANT = process.env.RETRIEVAL_TEST_TENANT;

const PARAPHRASE_QUERY = "if somebody else gets a sweeter deal later do we automatically get it too";

/** Two scripted turns: call search_documents, then answer using its result. */
function scriptedModelClient(finalAnswer: (toolResultText: string) => string): ModelClient {
  let step = 0;
  let capturedToolResult = "";
  return {
    kind: "anthropic",
    model: "scripted-test-model",
    async probe() {
      return { ok: true, latency_ms: 0, detail: null, model_available: null };
    },
    async *stream(request): AsyncIterable<ModelStreamEvent> {
      step += 1;
      if (step === 1) {
        const turn: ModelTurn = {
          text: "",
          toolCalls: [{ id: "call_1", name: "search_documents", input: { query: PARAPHRASE_QUERY } }],
          stopReason: "tool_use",
          model: "scripted-test-model",
          usage: { input_tokens: 100, output_tokens: 20 },
          refusalDetail: null,
        };
        yield { type: "turn", turn };
        return;
      }
      // Second call: the tool result is now the last message. Capture it so
      // the "final answer" can prove it actually saw real retrieved content,
      // not just that a second turn happened.
      const lastMessage = request.messages[request.messages.length - 1];
      capturedToolResult = lastMessage.role === "tool" ? lastMessage.content : "";
      const text = finalAnswer(capturedToolResult);
      yield { type: "text_delta", text };
      const turn: ModelTurn = {
        text,
        toolCalls: [],
        stopReason: "end_turn",
        model: "scripted-test-model",
        usage: { input_tokens: 150, output_tokens: 40 },
        refusalDetail: null,
      };
      yield { type: "turn", turn };
    },
  };
}

test("database-agent -> search_documents -> syslab-server -> hybrid retrieval -> context returned", async (t) => {
  if (!BASE_URL || !TOKEN || !TENANT) {
    t.skip("RETRIEVAL_BASE_URL/RETRIEVAL_TOKEN/RETRIEVAL_TEST_TENANT not set — this test only runs live");
    return;
  }

  const retrievalClient = new RetrievalClient({ baseUrl: BASE_URL, token: TOKEN });
  let capturedRawToolResult = "";

  const client = scriptedModelClient((toolResultText) => {
    capturedRawToolResult = toolResultText;
    const parsed = JSON.parse(toolResultText);
    const vectorHit = parsed.passages.find((p: { found_by: string[] }) => p.found_by.includes("vector"));
    return vectorHit
      ? `Based on the retrieved passages, found a relevant clause in ${vectorHit.source} (found_by: ${vectorHit.found_by.join(", ")}).`
      : "No relevant passages were found.";
  });

  const events: AgentEvent[] = [];
  let completed: Extract<AgentEvent, { type: "completed" }> | null = null;

  for await (const event of runAgent({
    question: "Do we have a most-favored-nation style clause anywhere?",
    history: [],
    playbookContext: "",
    responseDetail: "balanced",
    connections: [],
    client,
    reportGenerator: null,
    documentSearch: {
      search: async (query: string) => {
        const result = await retrievalClient.retrieve(query, TENANT, { k: 5 });
        return {
          passages: result.passages.map((p) => ({ source: p.source, text: p.text, found_by: p.found_by })),
          coverage: result.coverage,
          what_this_means: result.what_this_means,
        };
      },
    },
  })) {
    events.push(event);
    if (event.type === "completed") completed = event;
  }

  // 1. The tool step actually ran and was reported to the caller.
  const searchStep = events.find(
    (e) => e.type === "step" && e.step.label.startsWith("Searched documents")
  );
  assert.ok(searchStep, `expected a "Searched documents" step; got: ${events.map((e) => e.type).join(", ")}`);

  // 2. The raw tool result the model received contains real syslab-server
  // output, not a stub — proven by parsing it and checking for the
  // found_by/coverage shape only the real API returns.
  const parsedToolResult = JSON.parse(capturedRawToolResult);
  assert.ok(Array.isArray(parsedToolResult.passages));
  assert.ok(parsedToolResult.coverage);
  const anyVector = parsedToolResult.passages.some((p: { found_by: string[] }) => p.found_by.includes("vector"));
  assert.ok(anyVector, `expected at least one passage found_by vector; got: ${capturedRawToolResult.slice(0, 500)}`);

  // 3. The final answer text — produced by the second scripted turn from
  // that real content — reached the completed event database-agent itself
  // would render to the user.
  assert.ok(completed, "expected a completed event");
  assert.match(completed!.content, /found_by: .*vector/);

  console.log(`  tool result passages: ${parsedToolResult.passages.length}`);
  console.log(`  final answer: ${completed!.content}`);
});

test("a retrieval failure surfaces as a tool error, not a crashed run", async (t) => {
  if (!BASE_URL || !TENANT) {
    t.skip("RETRIEVAL_BASE_URL/RETRIEVAL_TEST_TENANT not set — this test only runs live");
    return;
  }

  // Deliberately wrong token against the real, configured box — a real rejection.
  const brokenClient = new RetrievalClient({ baseUrl: BASE_URL, token: "wrong" });

  const client = scriptedModelClient(() => "Document retrieval was unavailable, so I cannot answer that from documents.");
  let completed: Extract<AgentEvent, { type: "completed" }> | null = null;
  const events: AgentEvent[] = [];

  for await (const event of runAgent({
    question: "Search the documents for a clause.",
    history: [],
    playbookContext: "",
    responseDetail: "balanced",
    connections: [],
    client,
    reportGenerator: null,
    documentSearch: {
      search: async (query: string) => {
        const result = await brokenClient.retrieve(query, TENANT);
        return { passages: result.passages, coverage: result.coverage, what_this_means: result.what_this_means };
      },
    },
  })) {
    events.push(event);
    if (event.type === "completed") completed = event;
  }

  const failedStep = events.find((e) => e.type === "step" && e.step.status === "failed");
  assert.ok(failedStep, "expected a failed step for the broken retrieval call");
  assert.ok(completed, "the run must still complete rather than crash");
  assert.match(completed!.content, /unavailable/i);
});
