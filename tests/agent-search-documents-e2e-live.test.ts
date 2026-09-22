/**
 * The Agent-E2E test: drives the REAL runAgent() loop, with a library built by
 * the REAL resolveSources() from a media connection record, searching a REAL
 * syslab-server deployment through a REAL network call. The only thing scripted
 * is the model's two turns, the same way every other agent test in this suite
 * (agent-retry.test.ts and friends) drives runAgent() with a fake ModelClient
 * rather than a live LLM. Scripting the model is not a shortcut on the thing
 * being tested here: the question is whether the path from a connection record
 * to syslab-server, and back into the conversation, works as built, not what a
 * model decides to do with it.
 *
 * Skipped entirely unless RETRIEVAL_BASE_URL/RETRIEVAL_TOKEN/
 * RETRIEVAL_TEST_TENANT are set. RETRIEVAL_TEST_TENANT is the syslab key of a
 * test library; it becomes the connection's `alias_id`, so the test selects it
 * explicitly and nothing in the application knows it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { runAgent, type AgentEvent } from "@/lib/agent";
import { DOCUMENT_SEARCH_MESSAGES } from "@/lib/agent/libraries";
import { asLiteralMarkdown } from "@/lib/agent/provenance";
import type { ModelClient, ModelStreamEvent, ModelTurn } from "@/lib/agent/providers";
import { stores } from "@/lib/providers";
import type { MediaConnectionDoc } from "@/lib/services/connections";
import { resolveSources } from "@/lib/services/sources";

const BASE_URL = process.env.RETRIEVAL_BASE_URL;
const TOKEN = process.env.RETRIEVAL_TOKEN;
const TENANT = process.env.RETRIEVAL_TEST_TENANT;

const PARAPHRASE_QUERY = "if somebody else gets a sweeter deal later do we automatically get it too";

/** Two scripted turns: call search_documents, then answer using its result. */
function scriptedModelClient(finalAnswer: (toolResultText: string) => string): ModelClient {
  let step = 0;
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
      const text = finalAnswer(lastMessage.role === "tool" ? lastMessage.content : "");
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

let counter = 0;

/** A workspace with one media connection whose key is `alias`, and the environment that reaches the real box. */
async function workspaceWithLibrary(alias: string, token: string | undefined) {
  const tenantId = `ten_live_${++counter}_${Date.now()}`;
  const now = new Date().toISOString();
  const connection: MediaConnectionDoc = {
    id: `conn_live_${counter}`,
    object: "connection",
    kind: "media",
    engine: "media",
    name: "Contracts",
    description: "Supplier and customer contracts.",
    status: "unknown",
    status_checked_at: null,
    status_detail: null,
    media: { alias_id: alias, library_ref: null, server_ref: "default" },
    created_at: now,
    updated_at: now,
  };
  await stores().documents.put("connections", tenantId, connection);
  const env = {
    MEDIA_CONNECTIONS_ENABLED: "true",
    RETRIEVAL_BASE_URL: BASE_URL,
    ...(token === undefined ? {} : { RETRIEVAL_TOKEN: token }),
  };
  const { databases, libraries } = await resolveSources({ tenantId, userId: "usr_live" }, { env });
  return { databases, libraries };
}

async function run(libraries: Awaited<ReturnType<typeof workspaceWithLibrary>>["libraries"], client: ModelClient) {
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
    libraries,
  })) {
    events.push(event);
    if (event.type === "completed") completed = event;
  }
  return { events, completed };
}

test("database-agent -> media connection -> search_documents -> syslab-server -> hybrid retrieval -> context returned", async (t) => {
  if (!BASE_URL || !TOKEN || !TENANT) {
    t.skip("RETRIEVAL_BASE_URL/RETRIEVAL_TOKEN/RETRIEVAL_TEST_TENANT not set — this test only runs live");
    return;
  }

  const { libraries } = await workspaceWithLibrary(TENANT, TOKEN);
  assert.equal(libraries.length, 1, "the media connection must resolve to exactly one library");
  assert.equal(libraries[0].name, "Contracts");

  let capturedRawToolResult = "";
  let citedFile = "";
  const client = scriptedModelClient((toolResultText) => {
    capturedRawToolResult = toolResultText;
    const parsed = JSON.parse(toolResultText);
    const vectorHit = parsed.passages.find((p: { found_by: string[] }) => p.found_by.includes("vector"));
    if (!vectorHit) return "No relevant passages were found.";
    citedFile = vectorHit.source;
    // The model cites the file syslab really returned and one it made up.
    return (
      `Based on the retrieved passages, found a relevant clause in ${vectorHit.source} (found_by: ${vectorHit.found_by.join(", ")}).` +
      `\n\nSources:\n${vectorHit.source}\nmade_up_by_the_model.pdf`
    );
  });

  const { events, completed } = await run(libraries, client);

  // 1. The tool step actually ran and was reported to the caller.
  const searchStep = events.find((e) => e.type === "step" && e.step.label.startsWith("Searched documents"));
  assert.ok(searchStep, `expected a "Searched documents" step; got: ${events.map((e) => e.type).join(", ")}`);

  // 2. The raw tool result the model received contains real syslab-server
  // output, not a stub — proven by parsing it and checking for the
  // found_by/coverage shape only the real API returns.
  const parsedToolResult = JSON.parse(capturedRawToolResult);
  assert.ok(Array.isArray(parsedToolResult.passages));
  assert.ok(parsedToolResult.coverage);
  const anyVector = parsedToolResult.passages.some((p: { found_by: string[] }) => p.found_by.includes("vector"));
  assert.ok(anyVector, `expected at least one passage found_by vector; got: ${capturedRawToolResult.slice(0, 500)}`);

  // 3. Nothing about where the search went reached the model.
  assert.ok(!capturedRawToolResult.includes(BASE_URL), "the server address must not be in the tool result");
  assert.ok(!capturedRawToolResult.includes(TOKEN), "the token must not be in the tool result");
  assert.ok(!capturedRawToolResult.includes(TENANT), "the library's key must not be in the tool result");

  // 4. The final answer text — produced by the second scripted turn from
  // that real content — reached the completed event database-agent itself
  // would render to the user.
  assert.ok(completed, "expected a completed event");
  assert.match(completed!.content, /found_by: .*vector/);

  // 5. Provenance against the real service: the file name syslab returned is
  // what the ledger holds, so the cited file survives and the invented one
  // does not.
  assert.ok(citedFile, "a vector hit names its source file");
  assert.ok(completed!.content.endsWith(asLiteralMarkdown(citedFile)), `the block should end with the real file: ${completed!.content.slice(-200)}`);
  assert.ok(!completed!.content.includes("made_up_by_the_model"), "an invented file must not survive the check");

  console.log(`  tool result passages: ${parsedToolResult.passages.length}`);
  console.log(`  final answer: ${completed!.content}`);
});

test("a rejected credential surfaces as one fixed message, and nothing about the server leaks", async (t) => {
  if (!BASE_URL || !TENANT) {
    t.skip("RETRIEVAL_BASE_URL/RETRIEVAL_TEST_TENANT not set — this test only runs live");
    return;
  }

  // Deliberately wrong token against the real, configured box — a real 401.
  const { libraries } = await workspaceWithLibrary(TENANT, "wrong-token-for-live-test");
  let toolResult = "";
  const client = scriptedModelClient((text) => {
    toolResult = text;
    return "Document retrieval was unavailable, so I cannot answer that from documents.";
  });

  const { events, completed } = await run(libraries, client);

  const failedStep = events.find((e) => e.type === "step" && e.step.status === "failed");
  assert.ok(failedStep && failedStep.type === "step", "expected a failed step for the rejected search");
  assert.equal(failedStep.step.detail, DOCUMENT_SEARCH_MESSAGES.auth);
  assert.match(toolResult, new RegExp(DOCUMENT_SEARCH_MESSAGES.auth));

  const everythingShown = JSON.stringify(events) + toolResult;
  assert.ok(!everythingShown.includes(BASE_URL), "the server address must not reach the model or the reader");
  assert.ok(!everythingShown.includes("wrong-token-for-live-test"), "the token must not reach the model or the reader");

  assert.ok(completed, "the run must still complete rather than crash");
  assert.match(completed!.content, /unavailable/i);
});

test("a library whose key is not linked is reported as not linked", async (t) => {
  if (!BASE_URL || !TOKEN) {
    t.skip("RETRIEVAL_BASE_URL/RETRIEVAL_TOKEN not set — this test only runs live");
    return;
  }

  // A key nothing has linked: the real server answers 404, as it does for any unknown id.
  const { libraries } = await workspaceWithLibrary("live-test-key-nobody-linked", TOKEN);
  const { events } = await run(libraries, scriptedModelClient(() => "I could not search that library."));

  const failedStep = events.find((e) => e.type === "step" && e.step.status === "failed");
  assert.ok(failedStep && failedStep.type === "step", "expected a failed step");
  assert.equal(failedStep.step.detail, DOCUMENT_SEARCH_MESSAGES.not_linked);
});
