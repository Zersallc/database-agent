/**
 * Drives one eval case through the real agent loop against a real model.
 *
 * Reuses `runAgent` exactly as the Tier A tests do — the only difference is
 * the `ModelClient` behind it is real, so the output being graded is genuine
 * model reasoning over a fixture schema, not a scripted reaction to it.
 */

import { runAgent, type AgentConnection, type AgentEvent } from "@/lib/agent";
import { environmentClient } from "@/lib/services/model-providers";
import type { ModelClient, ModelRequest, ModelStreamEvent } from "@/lib/agent/providers/types";

import type { EvalCase, EvalOutcome, ExecutedQuery, GradeResult, RunFailure } from "./types";

/**
 * The real client configured for this environment, or a clear failure.
 *
 * `environmentClient()` returns null for several distinct reasons (no preset,
 * no key, no model) that a raw SDK error would not distinguish — this turns
 * that into one message pointing at the fix, since an eval run with no
 * credentials configured is a setup mistake, not a finding.
 */
export function buildRealClient(): { client: ModelClient; label: string } {
  const resolved = environmentClient();
  if (!resolved) {
    throw new Error(
      "No model provider is configured for evals. Set ANTHROPIC_API_KEY " +
        "(or MODEL_PROVIDER + MODEL_API_KEY + AGENT_MODEL) in .env.local or the environment."
    );
  }
  return { client: resolved.client, label: resolved.label };
}

/** Wraps a real client so every request it was sent can be inspected afterward. */
function recordingClient(client: ModelClient): ModelClient & { requests: ModelRequest[] } {
  const requests: ModelRequest[] = [];
  return {
    kind: client.kind,
    model: client.model,
    requests,
    async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
      // Copied, not referenced: the loop appends to the same `messages` array
      // across turns, so a stored reference would show later turns' additions.
      requests.push({ ...request, messages: [...request.messages] });
      yield* client.stream(request);
    },
    probe: () => client.probe(),
  };
}

/** One run of one case against a real model. */
export async function runCase(kase: EvalCase, client: ModelClient): Promise<EvalOutcome> {
  // Before anything else: a scripted fixture is only scripted for the first
  // repeat unless it is put back. See `EvalCase.reset`.
  kase.reset?.();

  const executedSql: ExecutedQuery[] = [];

  const connections: AgentConnection[] = kase.connections.map((conn, i) => ({
    id: `eval_conn_${i}`,
    name: conn.name,
    engine: conn.engine,
    schema: conn.schema,
    execute: async (sql: string) => {
      executedSql.push({ connection: conn.name, sql });
      const result = await conn.execute(sql);
      return { queryId: `eval_qry_${executedSql.length}`, result };
    },
  }));

  const wrapped = recordingClient(client);
  const events: AgentEvent[] = [];
  for await (const event of runAgent({
    question: kase.question,
    history: kase.history ?? [],
    playbookContext: "",
    responseDetail: kase.responseDetail ?? "balanced",
    connections,
    client: wrapped,
    reportGenerator: null,
    now: kase.now,
  })) {
    events.push(event);
  }

  const completed = events.find((e) => e.type === "completed");
  const finalText = completed && completed.type === "completed" ? completed.content : "";

  const failed = events.find((e) => e.type === "failed");
  const failure: RunFailure | null =
    failed && failed.type === "failed"
      ? {
          code: failed.error.code,
          message: failed.error.message,
          retryAfter: failed.error.retryAfter ?? null,
        }
      : null;

  return { events, requests: wrapped.requests, finalText, executedSql, failure };
}

/**
 * Real model output is not deterministic, so one run is not a verdict — a
 * pass rate over several is. Grading runs sequentially: cases share a rate
 * limit, and the point is a stable number, not raw throughput.
 *
 * A run that failed is reported as a failed run rather than graded. Handing a
 * provider error to a grader produces a confident sentence about model
 * behavior — "no queries ran", "the answer never names X" — for a request the
 * model never received, and `failure` is returned so the caller can stop
 * rather than spend the rest of the suite proving the same 404 fifty more
 * times.
 *
 * A rate limit is the exception, and waiting it out is the whole point of
 * telling the two apart: the shared server pushes back partway through a
 * suite, which is not a broken configuration and not a case worth abandoning.
 */
export async function runCaseNTimes(
  kase: EvalCase,
  client: ModelClient,
  n: number
): Promise<{ passRate: number; results: GradeResult[]; failure: RunFailure | null }> {
  const results: GradeResult[] = [];
  let failure: RunFailure | null = null;

  for (let i = 0; i < n; i++) {
    let outcome = await runCase(kase, client);

    for (let attempt = 1; outcome.failure?.retryAfter && attempt < RATE_LIMIT_ATTEMPTS; attempt++) {
      await sleep(outcome.failure.retryAfter * 1000 * attempt);
      outcome = await runCase(kase, client);
    }

    if (outcome.failure) {
      failure = outcome.failure;
      results.push({
        pass: false,
        reason: `the run failed before any answer — ${outcome.failure.code}: ${outcome.failure.message}`,
      });
      break;
    }

    results.push(await kase.grade(outcome, client));
  }

  const passRate = results.filter((r) => r.pass).length / results.length;
  return { passRate, results, failure };
}

/** How many times a rate-limited run is waited out before the suite gives up on it. */
const RATE_LIMIT_ATTEMPTS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
