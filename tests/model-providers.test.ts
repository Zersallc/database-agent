/**
 * Translation between the normalized agent vocabulary and each provider's wire
 * format.
 *
 * This is where a provider swap breaks quietly. Every failure here produces a
 * request the provider accepts and answers *wrongly*: tool results split across
 * messages so the model stops making parallel calls, a stop reason misread so
 * the loop exits before running the query, a tool call whose arguments arrived
 * in fragments and got concatenated in the wrong order. None of it throws.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { toAnthropicMessages } from "@/lib/agent/providers/anthropic";
import {
  mapFinishReason,
  readServerSentEvents,
  toOpenAiMessages,
  toOpenAiTool,
} from "@/lib/agent/providers/openai-compatible";
import { findPreset, kindFor, resolveBaseUrl } from "@/lib/agent/providers/presets";
import type { ModelMessage } from "@/lib/agent/providers/types";

const TOOL_CALL = { id: "call_1", name: "run_sql", input: { sql: "SELECT 1", purpose: "count" } };

describe("toAnthropicMessages", () => {
  test("passes a user turn through", () => {
    assert.deepEqual(toAnthropicMessages([{ role: "user", content: "hi" }]), [
      { role: "user", content: "hi" },
    ]);
  });

  test("replays assistant content blocks verbatim when raw is present", () => {
    const raw = [{ type: "thinking", thinking: "", signature: "sig" }, { type: "text", text: "hi" }];
    const messages: ModelMessage[] = [
      { role: "assistant", content: "hi", toolCalls: [], raw },
    ];
    // Reconstructing these would drop the signature and the API would reject
    // the turn, so the original array has to survive untouched.
    assert.deepEqual(toAnthropicMessages(messages), [{ role: "assistant", content: raw }]);
  });

  test("rebuilds assistant blocks when raw is missing", () => {
    const messages: ModelMessage[] = [
      { role: "assistant", content: "checking", toolCalls: [TOOL_CALL] },
    ];
    assert.deepEqual(toAnthropicMessages(messages), [
      {
        role: "assistant",
        content: [
          { type: "text", text: "checking" },
          { type: "tool_use", id: "call_1", name: "run_sql", input: TOOL_CALL.input },
        ],
      },
    ]);
  });

  test("collapses consecutive tool results into one user message", () => {
    const messages: ModelMessage[] = [
      { role: "assistant", content: "", toolCalls: [], raw: [] },
      { role: "tool", toolCallId: "a", toolName: "run_sql", content: "1", isError: false },
      { role: "tool", toolCallId: "b", toolName: "run_sql", content: "2", isError: false },
    ];
    const out = toAnthropicMessages(messages);

    // Splitting these across two user messages tells Claude its parallel calls
    // went unanswered, and it stops making them.
    assert.equal(out.length, 2);
    assert.equal(out[1].role, "user");
    assert.equal(out[1].content.length, 2);
    assert.deepEqual(
      out[1].content.map((block: { tool_use_id: string }) => block.tool_use_id),
      ["a", "b"]
    );
  });

  test("marks a failed tool result with is_error", () => {
    const messages: ModelMessage[] = [
      { role: "tool", toolCallId: "a", toolName: "run_sql", content: "boom", isError: true },
    ];
    const [message] = toAnthropicMessages(messages);
    assert.equal(message.content[0].is_error, true);
  });

  test("omits is_error on a successful result rather than sending false", () => {
    const messages: ModelMessage[] = [
      { role: "tool", toolCallId: "a", toolName: "run_sql", content: "ok", isError: false },
    ];
    const [message] = toAnthropicMessages(messages);
    assert.equal("is_error" in message.content[0], false);
  });

  test("flushes pending results before a following user turn", () => {
    const messages: ModelMessage[] = [
      { role: "tool", toolCallId: "a", toolName: "run_sql", content: "1", isError: false },
      { role: "user", content: "and now?" },
    ];
    const out = toAnthropicMessages(messages);
    assert.equal(out.length, 2);
    assert.equal(out[0].content[0].type, "tool_result");
    assert.equal(out[1].content, "and now?");
  });
});

describe("toOpenAiMessages", () => {
  test("puts the system prompt first, as a message", () => {
    const out = toOpenAiMessages("be helpful", [{ role: "user", content: "hi" }]);
    assert.deepEqual(out[0], { role: "system", content: "be helpful" });
    assert.deepEqual(out[1], { role: "user", content: "hi" });
  });

  test("serializes tool call arguments as a JSON string", () => {
    const out = toOpenAiMessages("s", [
      { role: "assistant", content: "checking", toolCalls: [TOOL_CALL] },
    ]);
    assert.deepEqual(out[1], {
      role: "assistant",
      content: "checking",
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          // A JSON *string*, not an object — the Chat Completions format is
          // specific about this and providers reject the object form.
          function: { name: "run_sql", arguments: JSON.stringify(TOOL_CALL.input) },
        },
      ],
    });
  });

  test("gives each tool result its own message", () => {
    const out = toOpenAiMessages("s", [
      { role: "tool", toolCallId: "a", toolName: "run_sql", content: "1", isError: false },
      { role: "tool", toolCallId: "b", toolName: "run_sql", content: "2", isError: false },
    ]);
    assert.equal(out.length, 3);
    assert.deepEqual(out[1], { role: "tool", tool_call_id: "a", content: "1" });
    assert.deepEqual(out[2], { role: "tool", tool_call_id: "b", content: "2" });
  });

  test("never emits an assistant message with neither content nor tool calls", () => {
    const out = toOpenAiMessages("s", [{ role: "assistant", content: "", toolCalls: [] }]);
    assert.deepEqual(out[1], { role: "assistant", content: "" });
  });

  test("omits empty content when there are tool calls", () => {
    const out = toOpenAiMessages("s", [
      { role: "assistant", content: "", toolCalls: [TOOL_CALL] },
    ]);
    assert.equal("content" in out[1], false);
    assert.equal(out[1].tool_calls.length, 1);
  });
});

describe("toOpenAiTool", () => {
  test("wraps the schema in the function envelope", () => {
    const parameters = { type: "object", properties: {}, required: [] };
    assert.deepEqual(toOpenAiTool({ name: "run_sql", description: "d", parameters }), {
      type: "function",
      function: { name: "run_sql", description: "d", parameters },
    });
  });
});

describe("mapFinishReason", () => {
  test("maps the documented reasons", () => {
    assert.equal(mapFinishReason("tool_calls", true), "tool_use");
    assert.equal(mapFinishReason("function_call", true), "tool_use");
    assert.equal(mapFinishReason("length", false), "max_tokens");
    assert.equal(mapFinishReason("content_filter", false), "refusal");
    assert.equal(mapFinishReason("stop", false), "end_turn");
  });

  test("trusts observed tool calls when finish_reason is missing", () => {
    // Some providers omit finish_reason on the chunk carrying tool calls.
    // Reading that as end_turn strands the run with the query never executed.
    assert.equal(mapFinishReason(null, true), "tool_use");
    assert.equal(mapFinishReason(null, false), "end_turn");
  });

  test("treats an unrecognized reason as a completed turn", () => {
    assert.equal(mapFinishReason("something_new", false), "end_turn");
  });
});

/** Builds a byte stream from string chunks, so boundaries can be placed exactly. */
function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const out: string[] = [];
  for await (const event of readServerSentEvents(stream)) out.push(event);
  return out;
}

describe("readServerSentEvents", () => {
  test("reads whole events", async () => {
    assert.deepEqual(await collect(streamOf(['data: {"a":1}\n\n', 'data: {"b":2}\n\n'])), [
      '{"a":1}',
      '{"b":2}',
    ]);
  });

  test("reassembles an event split across chunk boundaries", async () => {
    // The network splits wherever it likes; a parser that assumes whole events
    // drops half the answer under load and nowhere else.
    assert.deepEqual(await collect(streamOf(['data: {"a', '":1}\n', "\n"])), ['{"a":1}']);
  });

  test("stops at [DONE] and ignores anything after it", async () => {
    assert.deepEqual(
      await collect(streamOf(['data: {"a":1}\n\n', "data: [DONE]\n\n", 'data: {"b":2}\n\n'])),
      ['{"a":1}']
    );
  });

  test("skips comment and event-name lines", async () => {
    assert.deepEqual(
      await collect(streamOf([': keep-alive\n\n', 'event: message\ndata: {"a":1}\n\n'])),
      ['{"a":1}']
    );
  });

  test("joins multi-line data fields", async () => {
    assert.deepEqual(await collect(streamOf(['data: {"a":\ndata: 1}\n\n'])), ['{"a":1}']);
  });
});

describe("presets", () => {
  test("routes each preset to the right wire format", () => {
    assert.equal(kindFor("anthropic"), "anthropic");
    assert.equal(kindFor("qwen"), "openai_compatible");
    assert.equal(kindFor("openai"), "openai_compatible");
  });

  test("treats an unknown provider as OpenAI-compatible", () => {
    // The realistic unknown is a new OpenAI-compatible endpoint, so that is the
    // useful default; guessing Anthropic would fail on every request.
    assert.equal(kindFor("something-new"), "openai_compatible");
  });

  test("an explicit base URL wins over the preset default", () => {
    assert.equal(
      resolveBaseUrl("qwen", "https://dashscope.aliyuncs.com/compatible-mode/v1"),
      "https://dashscope.aliyuncs.com/compatible-mode/v1"
    );
  });

  test("falls back to the preset default when none is configured", () => {
    assert.equal(resolveBaseUrl("openai", null), "https://api.openai.com/v1");
    assert.equal(resolveBaseUrl("openai", "   "), "https://api.openai.com/v1");
  });

  test("strips trailing slashes so paths do not double up", () => {
    assert.equal(resolveBaseUrl("custom", "https://example.com/v1/"), "https://example.com/v1");
  });

  test("anthropic has no base URL, deferring to the SDK", () => {
    assert.equal(resolveBaseUrl("anthropic", null), null);
  });

  test("custom requires a base URL and qwen does not", () => {
    assert.equal(findPreset("custom")?.requiresBaseUrl, true);
    assert.equal(findPreset("qwen")?.requiresBaseUrl, false);
  });

  test("only local runtimes make the key optional", () => {
    assert.equal(findPreset("ollama")?.keyOptional, true);
    assert.equal(findPreset("qwen")?.keyOptional, false);
    assert.equal(findPreset("anthropic")?.keyOptional, false);
  });
});
