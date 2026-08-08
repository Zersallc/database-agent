/**
 * The agent loop.
 *
 * A question comes in, the model reads the schema and the workspace playbook,
 * writes SQL, runs it through the connector, reads the rows, and answers. The
 * loop yields events as it goes so a streaming client can show the work
 * happening instead of a spinner.
 *
 * This file is provider-agnostic. It speaks the normalized vocabulary in
 * `providers/types.ts` — messages, tool calls, text deltas, a stop reason — and
 * an adapter translates for Claude, Qwen, or anything else OpenAI-compatible.
 * Swapping providers must not change how the agent reasons, only who answers.
 *
 * Why a manual loop rather than an SDK's tool runner: every tool call here has
 * to become two externally visible things — a `RunStep` in the trace and a
 * persisted `Query` row the reader can open later. That bookkeeping sits
 * naturally in an explicit loop and awkwardly in a runner's per-turn hooks, and
 * no runner spans both wire formats anyway.
 */

import { ApiError } from "@/lib/api/errors";
import type { QueryResult, SchemaTable } from "@/lib/connectors";
import { MissingModuleError } from "@/lib/providers/optional-module";
import { DEMO_REPLY } from "./demo-reply";
import { buildSystemPrompt, type ResponseDetail } from "./prompt";
import { ModelProviderError } from "./providers";
import type { ModelClient, ModelMessage, ModelTurn, ToolDefinition } from "./providers";

const MAX_TOKENS = Number(process.env.AGENT_MAX_TOKENS ?? 32000);

/** Ceiling on model↔tool round trips, so a confused run cannot spin forever. */
const MAX_ITERATIONS = Number(process.env.AGENT_MAX_ITERATIONS ?? 12);

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
  /**
   * The configured provider. Null means none is set up, and the run returns the
   * setup notice rather than failing — an unconfigured workspace should still
   * demonstrate itself.
   */
  client: ModelClient | null;
  /** Reasoning depth. Only the Anthropic adapter acts on it. */
  effort?: string;
};

const RUN_SQL_TOOL: ToolDefinition = {
  name: "run_sql",
  description:
    "Run a read-only SQL query against the connected database and get the rows back. " +
    "Call this before stating any figure — never answer from memory or from the schema alone. " +
    "One statement per call. If it errors, read the message, fix the query, and call again.",
  parameters: {
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
};

export async function* runAgent(input: AgentRunInput): AsyncGenerator<AgentEvent> {
  const steps: AgentStep[] = [];

  const emit = (step: AgentStep): AgentEvent => {
    steps.push(step);
    return { type: "step", step };
  };

  if (!input.client) {
    yield emit({
      label: "No model provider configured",
      status: "failed",
      detail: "Add one under Settings → Model provider.",
      query_id: null,
    });
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

  const messages: ModelMessage[] = [
    // Stored history carries no tool calls: the SQL a past turn ran is already
    // reflected in its text, and replaying tool blocks from storage would need
    // provider-native payloads we deliberately do not persist.
    ...input.history.map((message): ModelMessage =>
      message.role === "user"
        ? { role: "user", content: message.content }
        : { role: "assistant", content: message.content, toolCalls: [] }
    ),
    { role: "user", content: input.question },
  ];

  const tools = input.connection ? [RUN_SQL_TOOL] : [];
  let answer = "";
  let model: string | null = null;
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      let turn: ModelTurn | null = null;

      for await (const event of input.client.stream({
        system,
        messages,
        tools,
        maxTokens: MAX_TOKENS,
        effort: input.effort ?? "high",
      })) {
        if (event.type === "text_delta") {
          answer += event.text;
          yield { type: "delta", text: event.text };
        } else {
          turn = event.turn;
        }
      }

      if (!turn) {
        throw new ApiError(
          "upstream_model_error",
          "The model provider closed the stream without returning a result."
        );
      }

      model = turn.model ?? model;
      inputTokens += turn.usage?.input_tokens ?? 0;
      outputTokens += turn.usage?.output_tokens ?? 0;

      if (turn.stopReason === "refusal") {
        yield emit({
          label: "Declined by the model provider",
          status: "failed",
          detail: turn.refusalDetail,
          query_id: null,
        });
        throw new ApiError(
          "upstream_model_error",
          "The model declined to answer this request. Rephrasing the question usually resolves it.",
          { details: { category: turn.refusalDetail } }
        );
      }

      if (turn.stopReason !== "tool_use" || turn.toolCalls.length === 0) {
        yield {
          type: "completed",
          content: answer.trim(),
          steps,
          model,
          usage: { input_tokens: inputTokens, output_tokens: outputTokens },
        };
        return;
      }

      messages.push({
        role: "assistant",
        content: turn.text,
        toolCalls: turn.toolCalls,
        raw: turn.raw,
      });

      for (const call of turn.toolCalls) {
        if (call.name !== RUN_SQL_TOOL.name || !input.connection) {
          messages.push({
            role: "tool",
            toolCallId: call.id,
            toolName: call.name,
            content: "No database is attached to this conversation, so queries cannot be run.",
            isError: true,
          });
          continue;
        }

        const sql = typeof call.input.sql === "string" ? call.input.sql : "";
        const purpose = typeof call.input.purpose === "string" ? call.input.purpose : "";

        if (!sql.trim()) {
          // A model that called the tool with no statement gets told so rather
          // than having the run fail around it.
          messages.push({
            role: "tool",
            toolCallId: call.id,
            toolName: call.name,
            content: "The 'sql' argument was empty. Send a single SQL statement.",
            isError: true,
          });
          continue;
        }

        try {
          const { queryId, result } = await input.connection.execute(sql);
          yield emit({
            label: purpose || "Ran query",
            status: "done",
            detail: `${result.row_count} row${result.row_count === 1 ? "" : "s"} in ${result.duration_ms}ms`,
            query_id: queryId,
          });
          messages.push({
            role: "tool",
            toolCallId: call.id,
            toolName: call.name,
            content: JSON.stringify(summarize(result)),
            isError: false,
          });
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          yield emit({ label: purpose || "Ran query", status: "failed", detail, query_id: null });
          // Errors go back to the model rather than aborting the run: reading a
          // "column does not exist" and correcting the query is the single most
          // valuable thing this loop does.
          messages.push({
            role: "tool",
            toolCallId: call.id,
            toolName: call.name,
            content: `The query failed: ${detail}`,
            isError: true,
          });
        }
      }
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

  if (error instanceof MissingModuleError) {
    return new ApiError("provider_unavailable", error.message, {
      details: { module: error.moduleName },
      cause: error,
    });
  }

  const status =
    error instanceof ModelProviderError ? error.status : (error as { status?: number }).status;
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
      "The model provider rejected the configured credentials. Check the API key under Settings → Model provider.",
      { cause: error }
    );
  }
  return new ApiError("upstream_model_error", `The model provider failed: ${message}`, {
    cause: error,
  });
}

export type { ResponseDetail } from "./prompt";
export type { ModelClient } from "./providers";
