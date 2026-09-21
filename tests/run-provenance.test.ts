/**
 * Provenance from the model to the reader's screen.
 *
 * The agent loop is tested in agent-provenance.test.ts. This follows its
 * answer the rest of the way: through the run service, the server-sent event
 * stream the browser reads, the stored message and the run record, and finally
 * the component that draws it. The point is the acceptance criterion the
 * provenance design was approved with: what the reader ends up looking at is
 * the checked answer, not the text the model streamed on the way there.
 *
 * Everything real except the network. The model endpoint and the syslab
 * retrieval endpoint are one replaced `fetch`; the model is a script that
 * misbehaves (cites a file nothing returned) and the retrieval endpoint returns
 * a fixed passage from one real-looking file. The run service, the source
 * resolver, the OpenAI-compatible adapter, the agent loop and the stores are the
 * ones the application runs.
 */

import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { stores } from "@/lib/providers";
import type { MediaConnectionDoc } from "@/lib/services/connections";
import { conversationHistory, createConversation } from "@/lib/services/conversations";
import { requireRun, runToCompletion, runToSseStream } from "@/lib/services/runs";

import { renderAnswer, tagsIn, visibleLines } from "./helpers/render-answer";

const MODEL_BASE = "http://model.test.invalid/v1";
const RETRIEVAL_BASE = "http://media.test.invalid:8080/api/v1";

const ENVIRONMENT: Record<string, string> = {
  MEDIA_CONNECTIONS_ENABLED: "true",
  RETRIEVAL_BASE_URL: RETRIEVAL_BASE,
  RETRIEVAL_TOKEN: "test-token-not-a-real-credential-0123456789",
  MODEL_PROVIDER: "custom",
  MODEL_BASE_URL: MODEL_BASE,
  MODEL_API_KEY: "test-model-key-not-real",
  AGENT_MODEL: "test-model",
};

type Turn = { text: string; toolCalls?: { id: string; name: string; input: Record<string, unknown> }[] };

const RETRIEVAL = {
  query: "q",
  retrievers: ["keyword"],
  retrievers_unavailable: {},
  passages: [
    { chunk_id: "c1", source: "contract_03.pdf", text: "Either party may terminate on thirty days' notice.", start: 0, end: 50, tokens: 10, rank: 1, found_by: ["keyword"] },
  ],
  coverage: { searched: 10, matched: 1, returned: 1 },
  tokens_returned: 10,
  truncated: false,
  what_this_means: "These passages CONTAIN or RESEMBLE the words asked about.",
};

/** One model turn as an OpenAI-style server-sent event stream, the text split so it really streams. */
function modelStream(turn: Turn): Response {
  const chunks: unknown[] = [];
  const third = Math.ceil(turn.text.length / 3);
  for (let at = 0; at < turn.text.length; at += third) {
    chunks.push({ choices: [{ delta: { content: turn.text.slice(at, at + third) } }] });
  }
  if (turn.toolCalls?.length) {
    chunks.push({
      choices: [
        {
          delta: {
            tool_calls: turn.toolCalls.map((call, index) => ({
              index,
              id: call.id,
              type: "function",
              function: { name: call.name, arguments: JSON.stringify(call.input) },
            })),
          },
        },
      ],
    });
  }
  chunks.push({
    choices: [{ delta: {}, finish_reason: turn.toolCalls?.length ? "tool_calls" : "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  });
  const body = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
}

let turns: Turn[] = [];
let modelRequests = 0;
const realFetch = globalThis.fetch;
const savedEnvironment: Record<string, string | undefined> = {};

before(() => {
  for (const [name, value] of Object.entries(ENVIRONMENT)) {
    savedEnvironment[name] = process.env[name];
    process.env[name] = value;
  }
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith(`${MODEL_BASE}/chat/completions`)) {
      const turn = turns[Math.min(modelRequests, turns.length - 1)];
      modelRequests += 1;
      return modelStream(turn);
    }
    if (url === `${RETRIEVAL_BASE}/retrieve`) return Response.json(RETRIEVAL);
    throw new Error(`unexpected request to ${url}`);
  }) as typeof fetch;
});

after(() => {
  globalThis.fetch = realFetch;
  for (const [name, value] of Object.entries(savedEnvironment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

beforeEach(() => {
  turns = [];
  modelRequests = 0;
});

let counter = 0;

async function workspace(options: { withLibrary: boolean }) {
  const tenantId = `ten_prov_${++counter}`;
  const now = new Date(Date.UTC(2026, 8, 1)).toISOString();
  if (options.withLibrary) {
    const doc: MediaConnectionDoc = {
      id: "conn_media_1",
      object: "connection",
      kind: "media",
      engine: "media",
      name: "Contracts",
      status: "unknown",
      status_checked_at: null,
      status_detail: null,
      media: { alias_id: "key-for-contracts", library_ref: null, server_ref: "default" },
      created_at: now,
      updated_at: now,
    };
    await stores().documents.put("connections", tenantId, doc);
  }
  const conversation = await createConversation(tenantId, { userId: "usr_test" });
  return { tenantId, conversation };
}

type SseEvent = {
  event: string;
  payload: { run?: { id: string; content: string | null; steps: { label: string }[] }; delta?: string };
};

async function askOverSse(options: { withLibrary: boolean }) {
  const { tenantId, conversation } = await workspace(options);
  const response = runToSseStream(
    tenantId,
    "usr_test",
    conversation,
    { content: "what does the contract say about termination?", responseDetail: "balanced", enableThinking: false },
    "req_test"
  );
  const raw = await response.text();
  const events: SseEvent[] = raw
    .split("\n\n")
    .filter((block) => block.trim().length > 0)
    .map((block) => {
      const lines = block.split("\n");
      return {
        event: lines.find((line) => line.startsWith("event:"))!.slice(6).trim(),
        payload: JSON.parse(lines.find((line) => line.startsWith("data:"))!.slice(5).trim()),
      };
    });
  return { tenantId, conversation, events };
}

/**
 * What the chat shows for the assistant's message once the stream is over.
 *
 * This mirrors `send()` in components/chat/ChatWorkspace.tsx, event for event,
 * and the last test in this file fails if that component stops doing what is
 * copied here. Deltas build up text, a reset empties it, and `run.completed`
 * replaces it with the run's own content.
 */
function whatTheChatShows(events: SseEvent[]) {
  let streamed = "";
  let shown = "";
  for (const { event, payload } of events) {
    if (event === "run.content_reset") streamed = "";
    else if (event === "run.content_delta") streamed += payload.delta ?? "";
    else if (event === "run.completed") shown = payload.run?.content ?? streamed;
  }
  return { streamed, shown };
}

const search = { id: "s1", name: "search_documents", input: { query: "termination" } };

describe("the reader's answer is the checked one", () => {
  test("a file the search never returned is not in what the chat shows, what is stored, or what the run record holds", async () => {
    turns = [
      { text: "", toolCalls: [search] },
      { text: "Either party may terminate on 30 days' notice.\n\nSources:\ncontract_03.pdf\nboard_minutes_2019.pdf" },
    ];
    const { tenantId, conversation, events } = await askOverSse({ withLibrary: true });

    const { streamed, shown } = whatTheChatShows(events);
    assert.ok(shown.length > 0, "the run completed with an answer");
    assert.ok(!shown.includes("board_minutes_2019"), shown);
    assert.match(shown, /contract_03\.pdf/);

    // The stream is only how the answer arrives. It carried the model's own
    // words, and the chat replaces them with the run's content when it
    // completes; that swap is what this whole design leans on.
    assert.notEqual(streamed, shown);

    const completed = events.find((event) => event.event === "run.completed");
    assert.equal(completed?.payload.run?.content, shown);

    const stored = (await conversationHistory(tenantId, conversation.id)).filter((message) => message.role === "assistant");
    assert.equal(stored.length, 1);
    assert.equal(stored[0].content, shown, "a reload shows the same answer");
    assert.ok(!stored[0].content.includes("board_minutes_2019"));

    const record = await requireRun(tenantId, completed!.payload.run!.id);
    assert.equal(record.content, shown);
  });

  test("the drawn answer shows the real source on its own line and nothing invented", async () => {
    turns = [
      { text: "", toolCalls: [search] },
      { text: "Either party may terminate on 30 days' notice.\n\nSources:\ncontract_03.pdf\nboard_minutes_2019.pdf" },
    ];
    const { events } = await askOverSse({ withLibrary: true });
    const html = renderAnswer(whatTheChatShows(events).shown);

    assert.deepEqual(visibleLines(html), ["Either party may terminate on 30 days' notice.", "Sources:", "contract_03.pdf"]);
    for (const tag of tagsIn(html)) assert.ok(["div", "p", "br"].includes(tag), `unexpected <${tag}>`);
    assert.ok(!html.includes("board_minutes"), html);
  });

  test("when the model forgets the block the reader gets the corrected answer, and the discarded one is reset", async () => {
    turns = [
      { text: "", toolCalls: [search] },
      { text: "Either party may terminate on 30 days' notice." },
      { text: "Either party may terminate on 30 days' notice.\n\nSources:\ncontract_03.pdf" },
    ];
    const { events } = await askOverSse({ withLibrary: true });

    assert.equal(modelRequests, 3);
    assert.equal(events.filter((event) => event.event === "run.content_reset").length, 1);

    const { shown } = whatTheChatShows(events);
    assert.deepEqual(visibleLines(renderAnswer(shown)), ["Either party may terminate on 30 days' notice.", "Sources:", "contract_03.pdf"]);

    const completed = events.find((event) => event.event === "run.completed");
    assert.ok(completed?.payload.run?.steps.some((step) => /without listing sources — retrying/.test(step.label)), "the trace records the retry");
  });

  test("the run that is fetched later, and the run that is not streamed, carry the same checked answer", async () => {
    turns = [
      { text: "", toolCalls: [search] },
      { text: "Answer.\n\nSources:\ncontract_03.pdf\nmade_up.pdf" },
    ];
    const { tenantId, conversation } = await workspace({ withLibrary: true });
    const run = await runToCompletion(tenantId, "usr_test", conversation, {
      content: "what does the contract say about termination?",
      responseDetail: "balanced",
      enableThinking: false,
    });
    assert.equal(run.content, "Answer.\n\nSources:  \ncontract_03.pdf");
  });

  test("a workspace with no libraries gets the model's answer exactly as it wrote it", async () => {
    const answer = "Nothing to look up here.\n\nSources:\nmade_up.pdf";
    turns = [{ text: answer }];
    const { events } = await askOverSse({ withLibrary: false });
    assert.equal(whatTheChatShows(events).shown, answer);
    assert.equal(modelRequests, 1);
  });
});

describe("the chat really does what these tests assume of it", () => {
  const source = readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "components", "chat", "ChatWorkspace.tsx"),
    "utf8"
  );
  // The handlers, without the whitespace they happen to be indented with.
  const squeezed = source.replace(/\s+/g, " ");

  test("a reset empties what was streamed", () => {
    assert.match(squeezed, /event === "run\.content_reset"\) \{[^}]*finalContent = "";/);
  });

  test("a delta is appended", () => {
    assert.match(squeezed, /event === "run\.content_delta"\) \{ finalContent \+= payload\.delta;/);
  });

  test("completion replaces what was streamed with the run's own content", () => {
    assert.match(squeezed, /event === "run\.completed"\) \{ updateLocalMessage\(conversationId, assistantMessageId, \{ content: payload\.run\.content \?\? finalContent,/);
  });

  test("the message is drawn by the Markdown component these tests render through", () => {
    const bubble = readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "components", "chat", "MessageBubble.tsx"),
      "utf8"
    );
    assert.match(bubble, /<Markdown\b/);
  });
});
