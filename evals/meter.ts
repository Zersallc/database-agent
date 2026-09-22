/**
 * Counting and pacing what an eval sends to the model.
 *
 * Both are done at the client, under the agent loop, for the same reason: the
 * loop reports its own usage on its `completed` event, but a judge call and a
 * request the provider turned away never appear there, and the loop rewrites a
 * provider's error into a sentence before anyone downstream can read its status.
 *
 * The gateway the evals run against is shared with the live site and limits each
 * token to 60 requests a minute. A0 ran at close to that, and a run that hits it
 * is not a measurement. `pacedClient` keeps well under it, and `meteredClient`
 * counts the ones that get through anyway so they can be reported separately
 * instead of being folded into a pass rate.
 */

import type { ModelClient, ModelRequest, ModelStreamEvent } from "@/lib/agent/providers/types";

import { providerErrorOf, type ProviderError } from "./classify";

export type Meter = {
  /** Requests sent, including ones the provider turned away. Load on the server. */
  calls: number;
  input_tokens: number;
  output_tokens: number;
  /** Requests answered with HTTP 429. */
  rate_limited: number;
  /** Requests that failed for any other reason. */
  errors: number;
};

export const emptyMeter = (): Meter => ({ calls: 0, input_tokens: 0, output_tokens: 0, rate_limited: 0, errors: 0 });
export const copyMeter = (m: Meter): Meter => ({ ...m });
export const diffMeter = (after: Meter, before: Meter): Meter => ({
  calls: after.calls - before.calls,
  input_tokens: after.input_tokens - before.input_tokens,
  output_tokens: after.output_tokens - before.output_tokens,
  rate_limited: after.rate_limited - before.rate_limited,
  errors: after.errors - before.errors,
});

/**
 * Counts what a run really sends to and gets back from the model, and keeps the
 * last provider error so a failed run can be classified from its status.
 *
 * A judge call is told apart from an agent call by having no tools, which is how
 * `judge.ts` makes them.
 */
export function meteredClient(client: ModelClient) {
  const agent = emptyMeter();
  const judge = emptyMeter();
  let lastError: ProviderError | null = null;

  const metered: ModelClient = {
    kind: client.kind,
    model: client.model,
    probe: () => client.probe(),
    async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
      const bucket = request.tools.length > 0 ? agent : judge;
      bucket.calls += 1;
      try {
        for await (const event of client.stream(request)) {
          if (event.type === "turn" && event.turn.usage) {
            bucket.input_tokens += event.turn.usage.input_tokens;
            bucket.output_tokens += event.turn.usage.output_tokens;
          }
          yield event;
        }
      } catch (error) {
        lastError = providerErrorOf(error);
        if (lastError.status === 429) bucket.rate_limited += 1;
        else bucket.errors += 1;
        throw error;
      }
    },
  };

  return {
    client: metered,
    agent,
    judge,
    /** The most recent error a request threw, or null if none has since `clearError`. */
    lastError: () => lastError,
    clearError: () => {
      lastError = null;
    },
  };
}

export type Clock = { now: () => number; sleep: (ms: number) => Promise<void> };

const realClock: Clock = { now: () => Date.now(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) };

/**
 * A client that never starts more than `maxPerMinute` requests in any sliding
 * minute. Requests are made in order and one at a time by the harness, so this
 * only ever delays; it never reorders or drops.
 */
export function pacedClient(client: ModelClient, maxPerMinute: number, clock: Clock = realClock): ModelClient {
  const started: number[] = [];
  return {
    kind: client.kind,
    model: client.model,
    probe: () => client.probe(),
    async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
      for (;;) {
        const now = clock.now();
        while (started.length > 0 && now - started[0] >= 60_000) started.shift();
        if (started.length < maxPerMinute) break;
        await clock.sleep(started[0] + 60_000 - now + 5);
      }
      started.push(clock.now());
      yield* client.stream(request);
    },
  };
}
