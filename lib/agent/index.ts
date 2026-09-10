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
  /**
   * Discard everything streamed so far: the turn is being retried and the text
   * already sent was the answer being replaced. Without this the reader would
   * watch a fabricated answer arrive and stay on screen next to its
   * replacement.
   */
  | { type: "reset" }
  | {
      type: "completed";
      content: string;
      steps: AgentStep[];
      model: string | null;
      usage: { input_tokens: number; output_tokens: number } | null;
    }
  | { type: "failed"; error: ApiError; steps: AgentStep[] };

/**
 * Did this turn present data that no query produced?
 *
 * ```table``` and ```chart``` are *results*. Emitting one without having called
 * a tool means the numbers in it came from the model, and nothing downstream
 * can tell that apart from numbers a database returned — the failure that put
 * invented hospital names in front of a user.
 *
 * ```sql``` is deliberately NOT in this set, and that is the whole lesson of the
 * previous attempt at this retry. "Write me a query for X, do not run it" is a
 * legitimate request that produces exactly that block and no tool call; the
 * earlier detector fired on it and ran the query anyway, overriding an explicit
 * instruction. A widened detector bought a false positive worse than the bug.
 * Since the interface now renders the real query from the tool call, an
 * unbacked ```sql``` block is visibly empty rather than silently wrong, so it
 * does not need forcing.
 *
 * Prose fabrication — "Free 15 · Pro 20 · Enterprise 10" in a sentence — is not
 * caught here and cannot be, without a predicate for "asserted a quantity
 * without a query" that nobody has yet written.
 */
function presentsUnbackedData(text: string): boolean {
  return /```(table|chart)\b/.test(text);
}

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

/** Lets the agent produce a downloadable Monthly/Annual ESG/GHG report on request. */
export type ReportGenerator = {
  generate: (params: {
    hospitalName?: string;
    hospitalGroup?: string;
    year: number;
    /** 1-12. Omit for a full calendar year. */
    month?: number;
  }) => Promise<{
    itemsRemoved: number;
    files: { name: string; downloadUrl: string }[];
  }>;
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
  /** Null when report generation isn't wired for this run (no hospital data connected). */
  reportGenerator: ReportGenerator | null;
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

const GENERATE_ESG_REPORT_TOOL: ToolDefinition = {
  name: "generate_esg_report",
  description:
    "Generates a downloadable ESG, Waste and GHG Report (PDF and Excel) for one hospital OR one hospital " +
    "group, for one calendar month OR a full calendar year. Call this when the user asks to generate, " +
    "create, produce, or download a sustainability, ESG, GHG, or waste report. Provide exactly one of " +
    "hospital_name or hospital_group — never both. Use the exact hospital name as it appears in the " +
    "database (query Report.\"Hospital Name\" first if unsure of the spelling), or the exact hospital group " +
    "name (query Hospitals.\"Hospital Group\" first if unsure). Use hospital_group only when the " +
    "user asked for a whole group or chain; a single named site is always hospital_name. " +
    "Omit month for a full-year report. " +
    "After calling this, tell the user what the report covers and give them the download link(s) from the " +
    "result as markdown links.",
  parameters: {
    type: "object",
    properties: {
      hospital_name: {
        type: "string",
        description: "Exact hospital name, matching Report.\"Hospital Name\". Omit if using hospital_group.",
      },
      hospital_group: {
        type: "string",
        description: "Exact hospital group name, matching Hospitals.\"Hospital Group\". Omit if using hospital_name.",
      },
      year: { type: "integer", description: "Calendar year, e.g. 2026." },
      month: { type: "integer", description: "Calendar month, 1-12. Omit for a full calendar year." },
    },
    required: ["year"],
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

  const tools = [
    ...(input.connection ? [RUN_SQL_TOOL] : []),
    ...(input.reportGenerator ? [GENERATE_ESG_REPORT_TOOL] : []),
  ];
  let answer = "";
  let model: string | null = null;
  // How many tools this run has actually called, and whether the forced retry
  // has already been spent. Both are per-run, not per-iteration: a turn that
  // queried and then summarised has done its work and must not be retried.
  let toolCallsMade = 0;
  let forcedRetryUsed = false;
  let toolChoice: "auto" | "required" = "auto";
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
        toolChoice,
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
        /**
         * The retry. A turn that ran no query and yet presented data is
         * answering from the model rather than from the database, so ask again
         * with the tool made mandatory.
         *
         * Three conditions, and each one is load-bearing:
         *
         * - `toolCallsMade === 0`. A run that queried and then drew a chart of
         *   the result is correct, and forcing it again would query twice.
         * - `presentsUnbackedData`. Blanket `tool_choice: "required"` would make
         *   "hi" run a query, which `CORE_BEHAVIOR` deliberately prevents. The
         *   detector is what keeps small talk out: a greeting has no table in
         *   it.
         * - `!forcedRetryUsed`. One attempt. If the model produces a chart with
         *   no query even when a tool is mandatory, that is a different failure
         *   and looping on it would only cost tokens.
         */
        if (
          !forcedRetryUsed &&
          toolCallsMade === 0 &&
          tools.length > 0 &&
          presentsUnbackedData(answer)
        ) {
          forcedRetryUsed = true;
          toolChoice = "required";
          yield emit({
            label: "Answered without running a query — retrying",
            status: "done",
            detail: "The reply presented data that no query produced.",
            query_id: null,
          });
          // Nothing was appended to `messages` on this path, so the model is
          // asked the original question again rather than shown its own bad
          // answer — which it would otherwise imitate, the same self-imitation
          // that caused this.
          answer = "";
          yield { type: "reset" };
          continue;
        }

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

      toolCallsMade += turn.toolCalls.length;
      // The forcing is spent as soon as it works: leaving it on would make
      // every later turn of this run mandatory too, including the one that
      // just summarises the rows.
      toolChoice = "auto";

      for (const call of turn.toolCalls) {
        if (call.name === GENERATE_ESG_REPORT_TOOL.name) {
          if (!input.reportGenerator) {
            messages.push({
              role: "tool",
              toolCallId: call.id,
              toolName: call.name,
              content: "Report generation is not available in this workspace.",
              isError: true,
            });
            continue;
          }

          const hospitalNameRaw = typeof call.input.hospital_name === "string" ? call.input.hospital_name.trim() : "";
          const hospitalGroupRaw = typeof call.input.hospital_group === "string" ? call.input.hospital_group.trim() : "";
          const year = typeof call.input.year === "number" ? call.input.year : NaN;
          const month = typeof call.input.month === "number" ? call.input.month : undefined;
          const scopeLabel = hospitalNameRaw || hospitalGroupRaw || "the requested scope";

          const bothOrNeither = Boolean(hospitalNameRaw) === Boolean(hospitalGroupRaw);
          if (
            bothOrNeither ||
            !Number.isInteger(year) ||
            (month !== undefined && (!Number.isInteger(month) || month < 1 || month > 12))
          ) {
            messages.push({
              role: "tool",
              toolCallId: call.id,
              toolName: call.name,
              content:
                "Provide exactly one of 'hospital_name' or 'hospital_group' (not both, not neither), a valid 'year', and an optional 'month' between 1 and 12.",
              isError: true,
            });
            continue;
          }

          try {
            const generated = await input.reportGenerator.generate({
              hospitalName: hospitalNameRaw || undefined,
              hospitalGroup: hospitalGroupRaw || undefined,
              year,
              month,
            });
            yield emit({
              label: `Generated ESG report for ${scopeLabel}`,
              status: "done",
              detail: `${generated.itemsRemoved} item${generated.itemsRemoved === 1 ? "" : "s"} covered`,
              query_id: null,
            });
            messages.push({
              role: "tool",
              toolCallId: call.id,
              toolName: call.name,
              content: JSON.stringify(generated),
              isError: false,
            });
          } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            yield emit({ label: `Generating ESG report for ${scopeLabel}`, status: "failed", detail, query_id: null });
            messages.push({
              role: "tool",
              toolCallId: call.id,
              toolName: call.name,
              content: `Report generation failed: ${detail}`,
              isError: true,
            });
          }
          continue;
        }

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
            content: JSON.stringify(summarize(result, sql)),
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
/** Keywords inside quoted text are not keywords. Blank the literals first. */
function withoutLiterals(sql: string): string {
  return sql.replace(/'(?:[^']|'')*'/g, "''").replace(/"(?:[^"]|"")*"/g, '""');
}

/**
 * What these rows do and do not establish.
 *
 * Told "the data is not available in the database", a reader believes it. The
 * agent said exactly that about `Donation Value` — 40,618 populated rows
 * totalling 34,171,960.53 — after running `LIMIT 5` with no `ORDER BY`, landing
 * on five small suppliers whose values happened to be null, and generalising
 * from them to the whole table. Real query, real rows, read correctly; the
 * error was entirely in the inference.
 *
 * An instruction not to over-generalise would sit in the prompt competing with
 * everything else there, and today's evidence is that prose loses. This is a
 * fact in the payload the model is already reading, next to the rows it is
 * reasoning from — the arbitrariness of the sample stated where the sample is.
 */
function samplingNote(sql: string, result: QueryResult): string | null {
  const bare = withoutLiterals(sql).toLowerCase();
  const arbitrary = /\blimit\s+\d/.test(bare) && !/\border\s+by\b/.test(bare);
  const held = result.truncated || result.rows.length > ROWS_IN_CONTEXT;

  if (arbitrary) {
    return (
      "These rows are an arbitrary subset: the query has a LIMIT and no ORDER BY, " +
      "so the database returned whichever rows it reached first. They are not the " +
      "largest, the smallest, or a representative sample, and nothing about the " +
      "rest of the table follows from them — in particular, a null or zero here " +
      "does not mean the column is empty elsewhere. To say anything about the " +
      "table as a whole (a total, a maximum, whether a column is ever populated), " +
      "run a query that aggregates over all of it."
    );
  }
  if (held) {
    return (
      "Not every matching row is here. What is missing may differ from what is " +
      "shown, so describe this as a partial result or query the whole of it."
    );
  }
  return null;
}

function summarize(result: QueryResult, sql: string) {
  const sampling = samplingNote(sql, result);
  return {
    columns: result.columns.map((column) => column.name),
    rows: result.rows.slice(0, ROWS_IN_CONTEXT),
    row_count: result.row_count,
    rows_shown: Math.min(result.rows.length, ROWS_IN_CONTEXT),
    truncated: result.truncated || result.rows.length > ROWS_IN_CONTEXT,
    duration_ms: result.duration_ms,
    ...(sampling ? { sampling } : {}),
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
