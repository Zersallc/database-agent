/**
 * Drives one eval case through the real agent loop against a real model.
 *
 * Reuses `runAgent` exactly as the Tier A tests do — the only difference is
 * the `ModelClient` behind it is real, so the output being graded is genuine
 * model reasoning over a fixture schema, not a scripted reaction to it.
 *
 * A run has four possible ends (`RunStatus`) and only one of them is a
 * measurement. The harness classifies each run from what the provider actually
 * answered, waits out and repeats the ones that failed for reasons that will
 * pass, and grades only the runs that produced an answer.
 */

import { runAgent, type AgentConnection, type AgentEvent, type AgentLibrary } from "@/lib/agent";
import { environmentClient } from "@/lib/services/model-providers";
import type { ModelClient, ModelRequest, ModelStreamEvent } from "@/lib/agent/providers/types";

import { classifyRun, providerErrorOf } from "./classify";
import { blockLines, missingSources, unnecessarySources } from "./grade-media";
import { failuresOf } from "./grade";
import { buildFixtureLibraries } from "./libraries";
import { diffMeter, copyMeter, type meteredClient } from "./meter";
import type {
  EvalCase,
  EvalLibrary,
  EvalOutcome,
  ExecutedQuery,
  GradeResult,
  LiveLibrary,
  RunFailure,
  RunRecord,
  SearchRecord,
  SourceExpectation,
  ToolCallRecord,
} from "./types";

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

export type RunOptions = {
  /**
   * Libraries attached to the run in addition to the case's own. This is how the
   * original eleven cases are run "with libraries present" to see whether merely
   * having a library changes how the model handles SQL questions.
   */
  extraLibraries?: EvalLibrary[];
  /** Builds a real syslab library for a case that asks for one. Absent: such a case cannot run. */
  liveLibrary?: (spec: LiveLibrary, log: SearchRecord[]) => Promise<AgentLibrary>;
};

/** The tool calls in a conversation, in order, with whether each was accepted. */
export function toolCallsIn(
  messages: ModelRequest["messages"],
  connectionNames: string[],
  libraryNames: string[]
): ToolCallRecord[] {
  const failed = new Set<string>();
  for (const message of messages) if (message.role === "tool" && message.isError) failed.add(message.toolCallId);

  const records: ToolCallRecord[] = [];
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const call of message.toolCalls) {
      const requested = typeof call.input.database === "string" ? call.input.database.trim() : "";
      const asked = typeof call.input.library === "string" ? call.input.library.trim() : "";

      let database: string | null = null;
      if (call.name === "run_sql") {
        database =
          connectionNames.length === 1
            ? connectionNames[0]
            : connectionNames.find((name) => name.toLowerCase() === requested.toLowerCase()) ?? (requested || null);
      }

      let library: string | null = null;
      if (call.name === "search_documents") {
        library =
          libraryNames.length === 1
            ? libraryNames[0]
            : libraryNames.find((name) => name.toLowerCase() === asked.toLowerCase()) ?? (asked || null);
      }

      records.push({ name: call.name, ok: !failed.has(call.id), library, database });
    }
  }
  return records;
}

/** One run of one case against a real model. */
export async function runCase(kase: EvalCase, client: ModelClient, options: RunOptions = {}): Promise<EvalOutcome> {
  // Before anything else: a scripted fixture is only scripted for the first
  // repeat unless it is put back. See `EvalCase.reset`.
  kase.reset?.();

  const executedSql: ExecutedQuery[] = [];
  const queried = new Map<string, { name: string; engine: string }>();
  const searchLog: SearchRecord[] = [];

  const connections: AgentConnection[] = kase.connections.map((conn, i) => ({
    id: `eval_conn_${i}`,
    name: conn.name,
    engine: conn.engine,
    description: conn.description ?? null,
    schema: conn.schema,
    execute: async (sql: string) => {
      executedSql.push({ connection: conn.name, sql });
      const result = await conn.execute(sql);
      queried.set(conn.name, { name: conn.name, engine: conn.engine });
      return { queryId: `eval_qry_${executedSql.length}`, result };
    },
  }));

  const libraries: AgentLibrary[] = buildFixtureLibraries([...(kase.libraries ?? []), ...(options.extraLibraries ?? [])], searchLog);
  if (kase.live) {
    if (!options.liveLibrary) throw new Error(`Case ${kase.id} needs a live library and none was configured.`);
    libraries.push(await options.liveLibrary(kase.live, searchLog));
  }

  const wrapped = recordingClient(client);
  const events: AgentEvent[] = [];
  let rawAnswer = "";
  for await (const event of runAgent({
    question: kase.question,
    history: kase.history ?? [],
    playbookContext: "",
    responseDetail: kase.responseDetail ?? "balanced",
    connections,
    client: wrapped,
    reportGenerator: null,
    libraries,
    now: kase.now,
  })) {
    events.push(event);
    // What the model wrote last: a reset means the text so far was discarded.
    if (event.type === "delta") rawAnswer += event.text;
    if (event.type === "reset") rawAnswer = "";
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

  const libraryNames = libraries.map((library) => library.name);
  const lastRequest = wrapped.requests[wrapped.requests.length - 1];
  const retrieved = new Map<string, { library: string; file: string }>();
  for (const search of searchLog) {
    for (const file of search.returned) retrieved.set(JSON.stringify([search.library, file]), { library: search.library, file });
  }

  return {
    events,
    requests: wrapped.requests,
    finalText,
    executedSql,
    failure,
    libraries: libraryNames,
    toolCalls: lastRequest ? toolCallsIn(lastRequest.messages, kase.connections.map((c) => c.name), libraryNames) : [],
    searches: searchLog,
    retrieved: [...retrieved.values()],
    queried: [...queried.values()],
    rawAnswer,
    retrySteps: events.flatMap((e) => (e.type === "step" && /retrying/i.test(e.step.label) ? [e.step.label] : [])),
    showLibrary: libraryNames.length > 1,
  };
}

/** How long to wait before starting a failed run again. Overridable so tests need not wait. */
export type Backoff = { rateLimitedMs: number; infrastructureMs: number };

export type RepeatOptions = RunOptions & {
  /** Attempts per scheduled run for failures that may pass on their own (default 3). */
  maxAttempts?: number;
  /** Consecutive scheduled runs that ended without an answer before the case is given up on (default 6). */
  maxConsecutiveFailures?: number;
  backoff?: Backoff;
  sleep?: (ms: number) => Promise<void>;
  /** Called after each scheduled run, for progress output. */
  onRun?: (index: number, record: RunRecord) => void;
};

export type CaseRun = {
  runs: RunRecord[];
  /** Why the case stopped before finishing its scheduled runs, if it did. */
  stopped: string | null;
  /** Set when a run failed in a way every later run would repeat (a rejected key, an unknown model). */
  setupFailure: { code: string; message: string } | null;
};

const DEFAULT_BACKOFF: Backoff = { rateLimitedMs: 15_000, infrastructureMs: 5_000 };
const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** What a case's runs are compared to for "did the question need this source". */
function expectationFor(kase: EvalCase, options: RunOptions): SourceExpectation | undefined {
  if (kase.sources) return kase.sources;
  // A case that declares none, run with libraries attached that it never asked
  // for: its databases are fine to use and any library is a call it did not need.
  if (options.extraLibraries?.length) {
    return { required: [], allowed: kase.connections.map((c) => `db:${c.name}`) };
  }
  return undefined;
}

/**
 * Real model output is not deterministic, so one run is not a verdict — a
 * pass rate over several is. Runs are made one at a time: cases share a rate
 * limit, and the point is a stable number, not raw throughput.
 *
 * A run that failed is never graded. Handing a provider error to a grader
 * produces a confident sentence about model behavior — "no queries ran", "the
 * answer never names X" — for a request the model never received. It is
 * classified instead (`classifyRun`), and if the failure may pass on its own it
 * is started again after a wait. A rate limit is the common case: the shared
 * server pushes back partway through a suite, which is not a broken
 * configuration and not a case worth abandoning. What still fails after its
 * attempts is recorded as a run that did not measure anything, and the next one
 * goes ahead.
 *
 * Only a setup failure stops everything: a rejected key or an unknown model would
 * fail every remaining run the same way.
 */
export async function runCaseRepeated(
  kase: EvalCase,
  meter: ReturnType<typeof meteredClient>,
  n: number,
  options: RepeatOptions = {}
): Promise<CaseRun> {
  const maxAttempts = options.maxAttempts ?? 3;
  const maxConsecutiveFailures = options.maxConsecutiveFailures ?? 6;
  const backoff = options.backoff ?? DEFAULT_BACKOFF;
  const sleep = options.sleep ?? realSleep;
  const expectation = expectationFor(kase, options);

  const runs: RunRecord[] = [];
  let consecutiveFailures = 0;
  let stopped: string | null = null;
  let setupFailure: CaseRun["setupFailure"] = null;

  for (let index = 0; index < n; index++) {
    const before = { agent: copyMeter(meter.agent), judge: copyMeter(meter.judge) };
    const started = Date.now();

    let attempts = 0;
    let outcome: EvalOutcome | null = null;
    let grade: GradeResult | null = null;
    let classification = classifyRun(null, null);
    let failure: RunRecord["failure"] = null;

    for (;;) {
      attempts += 1;
      meter.clearError();
      outcome = null;
      grade = null;

      try {
        outcome = await runCase(kase, meter.client, options);
        classification = classifyRun(outcome.failure, meter.lastError());
        if (classification.status !== "valid" && outcome.failure) {
          failure = { code: outcome.failure.code, message: outcome.failure.message, http_status: classification.http_status };
        }
        // Graded only when there is an answer to grade. A judge call can fail
        // too, and that is the measuring equipment, not the model.
        if (classification.status === "valid") {
          try {
            grade = await kase.grade(outcome, meter.client);
          } catch (error) {
            const provider = providerErrorOf(error);
            classification = classifyRun({ code: "grader_failed", message: provider.message, retryAfter: null }, provider);
            failure = { code: "grader_failed", message: provider.message, http_status: classification.http_status };
          }
        }
      } catch (error) {
        // Something threw outside the agent loop's own error handling, most often
        // a library that could not be built. Nothing about it is the model's.
        const provider = providerErrorOf(error);
        classification = classifyRun({ code: "harness_error", message: provider.message, retryAfter: null }, provider);
        failure = { code: "harness_error", message: provider.message, http_status: classification.http_status };
      }

      if (classification.status === "valid" || classification.setup) break;
      const retryable = classification.status === "rate_limited" || classification.status === "infrastructure";
      if (!retryable || attempts >= maxAttempts) break;
      const wait = classification.status === "rate_limited" ? backoff.rateLimitedMs : backoff.infrastructureMs;
      await sleep(wait * attempts);
    }

    // Agent and judge requests both count: a judge call is load on the same server.
    const agentUsed = diffMeter(meter.agent, before.agent);
    const judgeUsed = diffMeter(meter.judge, before.judge);
    const used = {
      calls: agentUsed.calls + judgeUsed.calls,
      rate_limited: agentUsed.rate_limited + judgeUsed.rate_limited,
      input_tokens: agentUsed.input_tokens + judgeUsed.input_tokens,
      output_tokens: agentUsed.output_tokens + judgeUsed.output_tokens,
    };

    const record = describeRun({
      status: classification.status,
      attempts,
      failure: classification.status === "valid" ? null : failure,
      outcome: classification.status === "valid" ? outcome : null,
      grade: classification.status === "valid" ? grade : null,
      expectation,
      requests: used.calls,
      rateLimitedRequests: used.rate_limited,
      inputTokens: used.input_tokens,
      outputTokens: used.output_tokens,
      durationMs: Date.now() - started,
    });
    runs.push(record);
    options.onRun?.(index, record);

    if (classification.setup && failure) {
      setupFailure = { code: failure.code, message: failure.message };
      stopped = `a setup failure, which every later run would repeat: ${failure.message}`;
      break;
    }

    consecutiveFailures = classification.status === "valid" ? 0 : consecutiveFailures + 1;
    if (consecutiveFailures >= maxConsecutiveFailures) {
      stopped = `${consecutiveFailures} runs in a row ended without an answer`;
      break;
    }
  }

  return { runs, stopped, setupFailure };
}

/** Everything the report says about one scheduled run, from its outcome and its grade. */
export function describeRun(input: {
  status: RunRecord["status"];
  attempts: number;
  failure: RunRecord["failure"];
  outcome: EvalOutcome | null;
  grade: GradeResult | null;
  expectation: SourceExpectation | undefined;
  requests: number;
  rateLimitedRequests: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}): RunRecord {
  const { outcome, grade, expectation } = input;
  const failures = grade ? failuresOf(grade) : [];
  const rawBlock = outcome ? blockLines(outcome.rawAnswer) ?? [] : [];
  const deliveredBlock = outcome ? blockLines(outcome.finalText) ?? [] : [];

  return {
    status: input.status,
    attempts: input.attempts,
    failure: input.failure,
    grade,
    failure_categories: [...new Set(failures.map((f) => f.category))],
    unnecessary_sources: outcome && expectation ? unnecessarySources(outcome, expectation) : null,
    missing_sources: outcome && expectation ? missingSources(outcome, expectation) : null,
    tools: outcome ? outcome.toolCalls.map((call) => call.name) : [],
    answered_without_tools: outcome ? outcome.toolCalls.length === 0 : false,
    ended_in_question: outcome ? /\?\s*$/.test(outcome.finalText.trim()) : false,
    documents_retrieved: outcome ? outcome.retrieved.length > 0 : false,
    provenance_retry: outcome ? outcome.retrySteps.some((label) => /sources/i.test(label)) : false,
    other_retry: outcome ? outcome.retrySteps.some((label) => !/sources/i.test(label)) : false,
    delivered_block: deliveredBlock.length > 0,
    lines_removed: Math.max(0, rawBlock.length - deliveredBlock.length),
    requests: input.requests,
    rate_limited_requests: input.rateLimitedRequests,
    input_tokens: input.inputTokens,
    output_tokens: input.outputTokens,
    duration_ms: input.durationMs,
  };
}
