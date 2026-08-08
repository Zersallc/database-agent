/**
 * The agent loop.
 *
 * A question comes in, the model reads the schema and the workspace playbook,
 * writes SQL, runs it through the connector, reads the rows, and answers. The
 * loop yields events as it goes so a streaming client can show the work
 * happening instead of a spinner.
 *
 * Why a manual loop rather than the SDK's tool runner: every tool call here has
 * to become two externally visible things — a `RunStep` in the trace and a
 * persisted `Query` row the reader can open later. That bookkeeping sits
 * naturally in an explicit loop and awkwardly in the runner's per-turn hooks.
 *
 * The SDK is an optional dependency, like every other provider. A deployment
 * without a model key still serves the workspace; it just answers with the
 * setup notice.
 */

import { ApiError } from "@/lib/api/errors";
import type { QueryResult, SchemaTable } from "@/lib/connectors";
import { optionalModule } from "@/lib/providers/optional-module";
import { DEMO_REPLY } from "./demo-reply";
import { buildSystemPrompt, type ResponseDetail } from "./prompt";

/* eslint-disable @typescript-eslint/no-explicit-any -- the SDK is loaded at runtime */

/**
 * Model defaults.
 *
 * Opus 5 with adaptive thinking: the work is multi-step (read schema, write
 * SQL, read an error, fix it) and that is exactly where thinking earns its
 * cost. `high` effort is the floor for anything intelligence-sensitive, and
 * writing correct SQL against an unfamiliar schema qualifies.
 */
const MODEL = process.env.AGENT_MODEL ?? "claude-opus-5";
const EFFORT = process.env.AGENT_EFFORT ?? "high";
const MAX_TOKENS = 32000;

/** Ceiling on model↔tool round trips, so a confused run cannot spin forever. */
const MAX_ITERATIONS = 12;

/** Rows handed back to the model per query. The full result still reaches the user. */
const ROWS_IN_CONTEXT = 100;

export type AgentStep = {
  label: string;
  status: "pending" | "active" | "done" | "failed";
  detail: string | null;
  query_id: string | null;
};

export type AgentEvent =
  | { type: "step"; step: AgentStep }
  | { type: "delta"; text: string }
  | {
      type: "completed";
      content: string;
      steps: AgentStep[];
      model: string | null;
      usage: { input_tokens: number; output_tokens: number } | null;
    }
  | { type: "failed"; error: ApiError; steps: AgentStep[] };

export type AgentConnection = {
  name: string;
  engine: string;
  schema: SchemaTable[] | null;
  /**
   * Runs SQL and persists it. Owned by the caller so connector lifecycle and
   * query records stay in the service layer, where the transaction boundaries
   * and tenancy live.
   */
  execute: (sql: string) => Promise<{ queryId: string; result: QueryResult }>;
};

export type AgentRunInput = {
  question: string;
  /** Prior turns, oldest first. Excludes the current question. */
  history: { role: "user" | "assistant"; content: string }[];
  playbookContext: string;
  responseDetail: ResponseDetail;
  connection: AgentConnection | null;
};

export function isModelConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim() || process.env.ANTHROPIC_AUTH_TOKEN?.trim());
}

const RUN_SQL_TOOL = {
  name: "run_sql",
  description:
    "Run a read-only SQL query against the connected database and get the rows back. " +
    "Call this before stating any figure — never answer from memory or from the schema alone. " +
    "One statement per call. If it errors, read the message, fix the query, and call again.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      sql: {
        type: "string",
        description: "A single read-only SQL statement in the connection's dialect.",
      },
      purpose: {
        type: "string",
        description: "One short phrase describing what this query is for, shown to the user.",
      },
    },
    required: ["sql", "purpose"],
    additionalProperties: false,
  },
} as const;

async function client(): Promise<any> {
  const mod = await optionalModule("@anthropic-ai/sdk", "the agent");
  const Anthropic = (mod.default ?? mod.Anthropic) as new (options?: object) => any;
  return new Anthropic();
}

export async function* runAgent(input: AgentRunInput): AsyncGenerator<AgentEvent> {
  const steps: AgentStep[] = [];

  const emit = (step: AgentStep): AgentEvent => {
    steps.push(step);
    return { type: "step", step };
  };

  if (!isModelConfigured()) {
    yield emit({ label: "Model provider not configured", status: "failed", detail: null, query_id: null });
    yield { type: "completed", content: DEMO_REPLY, steps, model: null, usage: null };
    return;
  }

  const system = buildSystemPrompt({
    playbookContext: input.playbookContext,
    responseDetail: input.responseDetail,
    connection: input.connection
      ? { name: input.connection.name, engine: input.connection.engine }
      : null,
    schema: input.connection?.schema ?? null,
  });

  const messages: any[] = [
    ...input.history.map((message) => ({ role: message.role, content: message.content })),
    { role: "user", content: input.question },
  ];

  let answer = "";
  let model: string | null = null;
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    const anthropic = await client();

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      const stream = anthropic.beta.messages.stream({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        // Opus 5's classifiers can decline a request outright. Server-side
        // fallback re-runs it on the recommended model in the same call, so a
        // benign question that trips a classifier still gets answered.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        thinking: { type: "adaptive" },
        output_config: { effort: EFFORT },
        // The system prompt is stable across every turn of a conversation and
        // large (it carries the whole schema), so it is the cache breakpoint.
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        ...(input.connection ? { tools: [RUN_SQL_TOOL] } : {}),
        messages,
      });

      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
          answer += event.delta.text;
          yield { type: "delta", text: event.delta.text };
        }
      }

      const message = await stream.finalMessage();
      model = message.model ?? model;
      inputTokens += message.usage?.input_tokens ?? 0;
      outputTokens += message.usage?.output_tokens ?? 0;

      // Check the stop reason before touching content: on a refusal the
      // content array is empty or partial, and indexing it blindly is the
      // classic way this breaks in production.
      if (message.stop_reason === "refusal") {
        yield emit({
          label: "Declined by safety classifiers",
          status: "failed",
          detail: message.stop_details?.category ?? null,
          query_id: null,
        });
        throw new ApiError(
          "upstream_model_error",
          "The model declined to answer this request. Rephrasing the question usually resolves it.",
          { details: { category: message.stop_details?.category ?? null } }
        );
      }

      // A server-side tool hit its own iteration cap. Hand the turn back and
      // let it resume — this is not an error.
      if (message.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: message.content });
        continue;
      }

      if (message.stop_reason !== "tool_use") {
        yield { type: "completed", content: answer.trim(), steps, model, usage: { input_tokens: inputTokens, output_tokens: outputTokens } };
        return;
      }

      messages.push({ role: "assistant", content: message.content });

      const toolUses = message.content.filter((block: any) => block.type === "tool_use");
      const results: any[] = [];

      for (const toolUse of toolUses) {
        if (toolUse.name !== RUN_SQL_TOOL.name || !input.connection) {
          results.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            is_error: true,
            content: "No database is attached to this conversation, so queries cannot be run.",
          });
          continue;
        }

        const { sql, purpose } = toolUse.input as { sql: string; purpose: string };

        try {
          const { queryId, result } = await input.connection.execute(sql);
          yield emit({
            label: purpose || "Ran query",
            status: "done",
            detail: `${result.row_count} row${result.row_count === 1 ? "" : "s"} in ${result.duration_ms}ms`,
            query_id: queryId,
          });
          results.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: JSON.stringify(summarize(result)),
          });
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          yield emit({ label: purpose || "Ran query", status: "failed", detail, query_id: null });
          // Errors go back to the model rather than aborting the run: reading a
          // "column does not exist" and correcting the query is the single most
          // valuable thing this loop does.
          results.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            is_error: true,
            content: `The query failed: ${detail}`,
          });
        }
      }

      messages.push({ role: "user", content: results });
    }

    yield emit({
      label: "Stopped after the maximum number of steps",
      status: "failed",
      detail: `The agent ran ${MAX_ITERATIONS} rounds without finishing.`,
      query_id: null,
    });
    yield {
      type: "completed",
      content:
        answer.trim() ||
        "I could not finish this within the step limit. Narrowing the question usually helps.",
      steps,
      model,
      usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    };
  } catch (error) {
    yield { type: "failed", error: translate(error), steps };
  }
}

/**
 * Trims a result set to what is useful in context.
 *
 * The model needs enough rows to describe the shape and cite specifics; it does
 * not need ten thousand of them, and sending them would burn the context window
 * for nothing. The user still gets the full result — this trim only applies to
 * what goes back into the conversation.
 */
function summarize(result: QueryResult) {
  return {
    columns: result.columns.map((column) => column.name),
    rows: result.rows.slice(0, ROWS_IN_CONTEXT),
    row_count: result.row_count,
    rows_shown: Math.min(result.rows.length, ROWS_IN_CONTEXT),
    truncated: result.truncated || result.rows.length > ROWS_IN_CONTEXT,
    duration_ms: result.duration_ms,
  };
}

function translate(error: unknown): ApiError {
  if (error instanceof ApiError) return error;

  const status = (error as { status?: number }).status;
  const message = error instanceof Error ? error.message : String(error);

  if (status === 429) {
    return new ApiError(
      "upstream_model_error",
      "The model provider is rate limiting this workspace. Retry shortly.",
      { retryAfter: 10, cause: error }
    );
  }
  if (status === 401 || status === 403) {
    return new ApiError(
      "upstream_model_error",
      "The configured model credentials were rejected. Check ANTHROPIC_API_KEY.",
      { cause: error }
    );
  }
  return new ApiError("upstream_model_error", `The model provider failed: ${message}`, {
    cause: error,
  });
}

export type { ResponseDetail } from "./prompt";
