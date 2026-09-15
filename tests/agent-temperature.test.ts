/**
 * The sampling the agent asks for.
 *
 * Sending nothing — which is what this did — is not the neutral choice it looks
 * like. It hands the answer's variance to whatever `generation_config.json` the
 * server happened to load, so the same question answered twice diverged further
 * than a reasoning pass explains and nothing in this repo had a say in it.
 *
 * The values are Qwen3's own published recommendations, and they differ by mode
 * on purpose: what keeps a non-thinking answer tight sends a thinking one into
 * repetition.
 */

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import { runAgent } from "@/lib/agent";
import type {
  ModelClient,
  ModelRequest,
  ModelStreamEvent,
} from "@/lib/agent/providers/types";

function scriptedClient(): ModelClient & { requests: ModelRequest[] } {
  const requests: ModelRequest[] = [];
  return {
    kind: "openai_compatible",
    model: "test-model",
    requests,
    async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
      requests.push({ ...request, messages: [...request.messages] });
      yield { type: "text_delta", text: "Hello." };
      yield {
        type: "turn",
        turn: {
          text: "Hello.",
          toolCalls: [],
          stopReason: "end_turn",
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

async function requestFor(enableThinking: boolean): Promise<ModelRequest> {
  const client = scriptedClient();
  // Drained for its side effect: the request the loop built.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for await (const event of runAgent({
    question: "hi",
    history: [],
    playbookContext: "",
    responseDetail: "balanced",
    enableThinking,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    connections: [connection as any],
    client,
    reportGenerator: null,
  })) {
    // No assertion on the events here; the request is what this file is about.
  }
  return client.requests[0];
}

afterEach(() => {
  delete process.env.AGENT_TEMPERATURE;
  delete process.env.AGENT_TOP_P;
});

describe("sampling per thinking mode", () => {
  test("thinking on asks for Qwen3's thinking values", async () => {
    const request = await requestFor(true);
    assert.equal(request.temperature, 0.6);
    assert.equal(request.topP, 0.95);
  });

  test("thinking off asks for its non-thinking values", async () => {
    const request = await requestFor(false);
    assert.equal(request.temperature, 0.7);
    assert.equal(request.topP, 0.8);
  });

  test("something is always asked for — never left to the server's own default", async () => {
    for (const mode of [true, false]) {
      const request = await requestFor(mode);
      assert.notEqual(request.temperature, null);
      assert.notEqual(request.topP, null);
    }
  });
});

describe("the environment override", () => {
  test("a configured value wins over the mode default, in both modes", async () => {
    process.env.AGENT_TEMPERATURE = "0.2";
    process.env.AGENT_TOP_P = "0.9";
    assert.equal((await requestFor(true)).temperature, 0.2);
    assert.equal((await requestFor(false)).temperature, 0.2);
    assert.equal((await requestFor(true)).topP, 0.9);
  });

  test("zero is a value, not an absent one", async () => {
    process.env.AGENT_TEMPERATURE = "0";
    assert.equal((await requestFor(false)).temperature, 0);
  });

  test("`default` means send the field at all — for a provider that rejects one", async () => {
    process.env.AGENT_TEMPERATURE = "default";
    const request = await requestFor(false);
    assert.equal(request.temperature, null);
    assert.equal(request.topP, 0.8, "the other field is unaffected");
  });

  test("nonsense falls back to the mode default rather than sending NaN", async () => {
    process.env.AGENT_TEMPERATURE = "warm";
    assert.equal((await requestFor(false)).temperature, 0.7);
  });

  test("an empty variable is the same as an unset one", async () => {
    process.env.AGENT_TEMPERATURE = "";
    assert.equal((await requestFor(false)).temperature, 0.7);
  });
});
