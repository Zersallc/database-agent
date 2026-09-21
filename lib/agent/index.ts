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
import {
  foundNothing,
  noWinnerNote,
  otherDateColumnsNote,
  rankingWithoutAWinner,
  unqueriedDateColumns,
  unverifiedFilterNote,
  unvouchedLiterals,
  vouchedFrom,
  withoutLiterals,
} from "./evidence";
import {
  SEARCH_DOCUMENTS_TOOL_NAME,
  buildSearchDocumentsTool,
  describeSearchFailure,
  resolveLibrary,
  type AgentLibrary,
} from "./libraries";
import { ProvenanceLedger, checkSources, sourcesCorrection } from "./provenance";
import { buildSystemPrompt, type ResponseDetail } from "./prompt";
import { ModelProviderError } from "./providers";
import type { ModelClient, ModelMessage, ModelTurn, ToolDefinition } from "./providers";

const MAX_TOKENS = Number(process.env.AGENT_MAX_TOKENS ?? 32000);

/** Ceiling on model↔tool round trips, so a confused run cannot spin forever. */
const MAX_ITERATIONS = Number(process.env.AGENT_MAX_ITERATIONS ?? 12);

/** Rows handed back to the model per query. The full result still reaches the user. */
const ROWS_IN_CONTEXT = 100;

/**
 * Characters of row data handed back per query, and the longest single cell.
 *
 * A row cap alone is not a size cap, and the difference is the whole of this:
 * 100 rows of `category, count` is a few hundred characters, while 100 rows of
 * `SELECT *` over a table with narrative text columns came to 188,000 — about
 * 62,900 tokens against a 32,768 window, or roughly twice the context the model
 * has. The request never reaches generation. It fails at the provider with an
 * error about output tokens, which is the reservation the oversized prompt left
 * no room for rather than the thing that was actually wrong.
 *
 * Neither number touches what the reader sees. The table is rendered from the
 * query record, so a `SELECT *` still shows every column and every row it
 * returned; this is only the copy the model reasons over, and it does not need
 * a hundred full incident reports to say what they have in common.
 */
const RESULT_CHARS_IN_CONTEXT = Number(process.env.AGENT_RESULT_CHARS ?? 12000);
const CELL_CHARS_IN_CONTEXT = Number(process.env.AGENT_CELL_CHARS ?? 400);

/**
 * Sampling, per thinking mode.
 *
 * Qwen3's published recommendations, and they differ by mode for a reason: the
 * same values that keep a non-thinking answer tight send a thinking one into
 * repetition loops. Sending nothing — which is what this did before — is not
 * the neutral option it looks like. It leaves the variance to whatever
 * `generation_config.json` the server loaded, so two deployments of the same
 * model answer differently and neither is a choice anyone here made.
 *
 * `AGENT_TEMPERATURE=default` (or `AGENT_TOP_P=default`) sends the field not at
 * all, for a provider that rejects a custom value rather than honoring it.
 */
const SAMPLING = {
  thinking: { temperature: 0.6, topP: 0.95 },
  nonThinking: { temperature: 0.7, topP: 0.8 },
} as const;

/** An env override, `null` for "send nothing", or `undefined` to use the mode default. */
function samplingOverride(raw: string | undefined): number | null | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  if (raw.trim().toLowerCase() === "default") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/** Temperature and top_p for one run, env override winning over the mode default. */
function samplingFor(enableThinking: boolean): { temperature: number | null; topP: number | null } {
  const defaults = enableThinking ? SAMPLING.thinking : SAMPLING.nonThinking;
  const temperature = samplingOverride(process.env.AGENT_TEMPERATURE);
  const topP = samplingOverride(process.env.AGENT_TOP_P);
  return {
    temperature: temperature === undefined ? defaults.temperature : temperature,
    topP: topP === undefined ? defaults.topP : topP,
  };
}

export type AgentStep = {
  label: string;
  status: "pending" | "active" | "done" | "failed";
  detail: string | null;
  query_id: string | null;
};

export type AgentEvent =
  | { type: "step"; step: AgentStep }
  | { type: "delta"; text: string }
  | { type: "thinking_delta"; text: string }
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
      thinking: string | null;
      steps: AgentStep[];
      model: string | null;
      usage: { input_tokens: number; output_tokens: number } | null;
    }
  | { type: "failed"; error: ApiError; steps: AgentStep[] };

/**
 * What the reader is actually being told.
 *
 * Fenced blocks are the model's own composition rather than a claim about the
 * data, and a reasoning block is the model talking to itself — "no rows, so
 * let me widen the match" is thinking its way to the right answer, not
 * asserting an absence. Weighing either as a claim makes the checks below fire
 * on turns that went on to be correct.
 */
function withoutFencedBlocks(text: string): string {
  return text
    .replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, " ")
    .replace(/```[\s\S]*?(?:```|$)/g, " ");
}

/** What a chunk of stream resolved to, split by whether it was inside `<think>`. */
type ThinkSplit = { visible: string; thinking: string };

/**
 * Splits `<think>...</think>` reasoning out of a token stream as it arrives.
 *
 * A provider without a reasoning parser configured (vLLM with no
 * `--reasoning-parser`, notably) inlines a thinking model's reasoning
 * straight into `content` — there is no separate field to just not read, so
 * the tags have to be split out of the text itself. A closing tag can land
 * in a different chunk than its opener, so this holds back whatever might be
 * the start of a tag until the next chunk resolves it, rather than ever
 * emitting a torn `<thi` as visible text.
 */
class ThinkFilter {
  private buffer = "";
  private insideThink = false;

  /** The visible and reasoning text resolved from this chunk, if any. */
  feed(chunk: string): ThinkSplit {
    this.buffer += chunk;
    const out: ThinkSplit = { visible: "", thinking: "" };

    for (;;) {
      const tag = this.insideThink ? "</think>" : "<think>";
      const index = this.buffer.toLowerCase().indexOf(tag);

      if (index === -1) {
        const holdback = longestTagPrefixAtEnd(this.buffer, tag);
        const resolved = this.buffer.slice(0, this.buffer.length - holdback);
        if (this.insideThink) out.thinking += resolved;
        else out.visible += resolved;
        this.buffer = this.buffer.slice(this.buffer.length - holdback);
        return out;
      }

      const resolved = this.buffer.slice(0, index);
      if (this.insideThink) out.thinking += resolved;
      else out.visible += resolved;
      this.buffer = this.buffer.slice(index + tag.length);
      this.insideThink = !this.insideThink;
    }
  }

  /** Whatever is left once the stream ends — never a full tag, or `feed` would have resolved it. */
  finish(): ThinkSplit {
    const leftover = this.buffer;
    this.buffer = "";
    return this.insideThink ? { visible: "", thinking: leftover } : { visible: leftover, thinking: "" };
  }
}

/** The length of the longest suffix of `text` that is also a prefix of `tag`. */
function longestTagPrefixAtEnd(text: string, tag: string): number {
  const max = Math.min(text.length, tag.length - 1);
  for (let length = max; length > 0; length--) {
    if (text.slice(-length).toLowerCase() === tag.slice(0, length)) return length;
  }
  return 0;
}

/**
 * Every number a reader would take as a figure, normalized for comparison.
 *
 * Ordered-list markers are stripped first: "1. Health hazards" is numbering, not
 * a quantity, and counting it would retry every enumerated answer ever written.
 * Thousands separators go so that 52,410 in prose matches 52410 in a tool
 * result — the same figure formatted for a person rather than for JSON.
 */
function figuresIn(text: string): string[] {
  const prose = withoutFencedBlocks(text).replace(/^[ \t]*\d+[.)]\s/gm, " ");
  return (prose.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, ""));
}

/**
 * Did this turn state a figure that appears nowhere it could have come from?
 *
 * This is the predicate the previous version of this file said nobody had
 * written. It works on substance rather than on shape: a figure is grounded if
 * the model could have read it — from the question, from an earlier turn, or
 * from a tool result this run — and invented if it could not. That holds however
 * the sentence is phrased, so a new way of wording a fabrication does not need a
 * new pattern here.
 *
 * It only runs when the turn called no tool at all, so "queried, then
 * summarised" is never touched.
 */
function statesUngroundedFigure(text: string, grounded: string[]): boolean {
  const stated = figuresIn(text);
  if (stated.length === 0) return false;
  const available = new Set(grounded.flatMap((source) => figuresIn(source)));
  return stated.some((figure) => !available.has(figure));
}

/**
 * The values this turn put in quotes.
 *
 * Quoted, and only quoted. `**bold**` is how the model writes a label or an
 * emphasis — "**Status**: Closed" — and reading those as data would question
 * half of every well-formatted answer. A quoted string is the one place it is
 * saying *this is the value the database holds*, which is the claim worth
 * checking.
 */
function quotedValuesIn(text: string): string[] {
  const prose = withoutFencedBlocks(text);
  const found = new Set<string>();

  for (const match of prose.matchAll(/["“]([^"”\n]{3,})["”]/g)) {
    const value = match[1].trim();
    // A figure in quotes is `statesUngroundedFigure`'s to judge, and it reads
    // numbers far more carefully than a substring match could.
    if (/[a-z]/i.test(value)) found.add(value);
  }

  return [...found];
}

/**
 * Did this turn quote a value that exists nowhere it could have read one?
 *
 * The same shape as `statesUngroundedFigure` and for the same reason — the
 * fabrication that prompted it was `Employee Name: "Ahmed Al-Maktoum"`, stated
 * with no query behind it, on a run where every existing check passed because a
 * name carries no digit.
 *
 * `sources` is wider here than for figures, and deliberately: it includes the
 * system prompt, so quoting a table name, a column name, or one of the values
 * the schema lists for a column is grounded by the schema itself. Figures keep
 * the narrower list — the schema carries row estimates, and letting those vouch
 * for numbers would switch that check off.
 *
 * Substring, in that direction: a quoted "health or hygiene" is vouched by the
 * schema's `Health or Hygiene or Ergonomic Hazards`, because the model is
 * naming something real in shorter words. The reverse never vouches.
 */
function quotesUngroundedValue(text: string, sources: string[]): boolean {
  const quoted = quotedValuesIn(text);
  if (quoted.length === 0) return false;

  const haystack = sources.map((source) => source.toLowerCase());
  return quoted.some((value) => {
    const probe = value.toLowerCase();
    return !haystack.some((source) => source.includes(probe));
  });
}

/**
 * Did this turn promise to act and then stop?
 *
 * "I will run a query to get that" followed by no tool call is not an answer;
 * it is the model narrating a plan and ending its turn, and the reader is left
 * watching a promise. Asking again with the tool mandatory is exactly the nudge
 * that turns it into the query it said it would run.
 *
 * Deliberately narrow: the verb has to be one that reaches the database, so
 * "let me know if…" and "I'll explain why…" are untouched.
 */
function promisesAnActionItDidNotTake(text: string): boolean {
  return /\b(?:I['’]ll|I will|let me|I['’]m going to|going to)\b[^.!?\n]{0,60}\b(?:run|execute|query|querying|check|retrieve|fetch|pull|look)\b/i.test(
    withoutFencedBlocks(text)
  );
}

/**
 * Does this answer report that nothing was found?
 *
 * On its own this is the same unbounded phrase-matching the rest of this file
 * avoids, and it is only used cross-checked against the rows the last query
 * actually returned. That check is what makes it safe: the pattern alone
 * guesses, the pattern against a row count contradicts.
 */
function claimsNothingWasFound(text: string): boolean {
  return /\bno (?:observations?|rows|records|results|entries|data|matches|matching)\b|\bnone (?:were|was) found\b|\bnothing (?:was )?found\b|\bnot found\b|\bno such\b/i.test(
    withoutFencedBlocks(text)
  );
}

/**
 * A frequency superlative — the claim a tied ranking cannot support.
 *
 * Narrow on purpose. "Most" on its own is ordinary English ("most of them are
 * closed") and matching it would question half of every answer; these are the
 * phrasings that specifically assert *this value occurs more often than the
 * others*, which is the only claim at issue.
 */
const NAMES_A_MOST_COMMON =
  /\bmost[\s-](?:used|common|commonly|frequent|frequently|often|reported|recorded|logged|cited|occurring|repeated)\b|\bcommonest\b|\bsingle most\b/i;

/**
 * Any acknowledgement that there was no winner to name.
 *
 * Deliberately wide, where the pattern above is narrow, because the two are
 * used together and the asymmetry decides which way the mistakes fall. A
 * missed correction costs a round trip; arguing with an answer that already
 * said "every value appears once, so there is no most used one" would be
 * telling the model the thing it just told the reader.
 */
const ACKNOWLEDGES_NO_WINNER =
  /\bno (?:single |clear |one )?most\b|\bno most[\s-]\w+\b|\bno mode\b|\btie[ds]?\b|\bonce each\b|\b(?:only|just|exactly) once\b|\bevery (?:value|observation|row|entry|finding|record)\b|\beach (?:value|observation|row|entry|finding|record)\b|\bno value\b|\bunique\b|\bdistinct value\b|\bdoes not repeat\b|\bnothing repeats\b/i;

/**
 * Did this turn name a most-common value?
 *
 * The same construction as `claimsNothingWasFound` and safe for the same
 * reason: the pattern alone guesses, and it is only ever used cross-checked
 * against a structural fact about the query behind it — here, a ranking whose
 * top tally is 1. Against that, "the most used observation is X" is not a
 * phrasing worth arguing with, it is a claim that cannot be true.
 */
function claimsAMostCommonValue(text: string): boolean {
  const prose = withoutFencedBlocks(text);
  return NAMES_A_MOST_COMMON.test(prose) && !ACKNOWLEDGES_NO_WINNER.test(prose);
}

/**
 * Why this turn should be asked again with the tool made mandatory, or null to
 * accept it as it stands.
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
 * A claim of *absence* — "no observations match that" — carries no figure and
 * promises nothing, so it reads exactly like a grounded answer here and this
 * predicate will never catch it. It is handled off the prose entirely, against
 * the literals the query filtered on; see `evidence.ts`.
 *
 * `valueSources` is `grounded` plus the system prompt — see
 * `quotesUngroundedValue` for why the schema vouches for a quoted value but
 * must not vouch for a figure.
 */
function unbackedAnswerReason(
  text: string,
  grounded: string[],
  valueSources: string[]
): string | null {
  if (/```(table|chart)\b/.test(text)) return "The reply presented data that no query produced.";
  if (statesUngroundedFigure(text, grounded)) {
    return "The reply stated a figure that no query in this conversation produced.";
  }
  if (quotesUngroundedValue(text, valueSources)) {
    return "The reply quoted a value that no query in this conversation returned.";
  }
  if (promisesAnActionItDidNotTake(text)) {
    return "The reply said it would run a query and then did not.";
  }
  return null;
}

export type AgentConnection = {
  id: string;
  name: string;
  engine: string;
  schema: SchemaTable[] | null;
  /** What this database holds, in an administrator's words. Optional; shown in the prompt as data. */
  description?: string | null;
  /**
   * Runs SQL and persists it. Owned by the caller so connector lifecycle and
   * query records stay in the service layer, where the transaction boundaries
   * and tenancy live.
   */
  execute: (sql: string) => Promise<{ queryId: string; result: QueryResult }>;
};

export type { AgentLibrary, DocumentSearchResult } from "./libraries";

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
  /**
   * Every database this workspace has, not one pre-selected connection. A
   * company can register more than one, and which is relevant to a given
   * question is not known ahead of the question — so the model is shown all
   * of them and picks per query, the same way a person would. Empty means no
   * database is attached to this conversation.
   */
  connections: AgentConnection[];
  /**
   * The configured provider. Null means none is set up, and the run returns the
   * setup notice rather than failing — an unconfigured workspace should still
   * demonstrate itself.
   */
  client: ModelClient | null;
  /** Reasoning depth. Only the Anthropic adapter acts on it. */
  effort?: string;
  /** Whether the model may think before answering. Off costs nothing extra; on roughly triples latency and output tokens. Defaults to off. */
  enableThinking?: boolean;
  /** Null when report generation isn't wired for this run (no hospital data connected). */
  reportGenerator: ReportGenerator | null;
  /**
   * The document libraries this user's workspace may search, already resolved
   * and authorized by the application. Absent or empty means `search_documents`
   * is not offered at all. Optional rather than required so every caller that
   * predates libraries keeps compiling without having to know they exist.
   *
   * Each library's `search` has its server, key and credentials sealed inside
   * it, so the model can name a library and supply a question and can do
   * nothing else: see lib/agent/libraries.ts.
   */
  libraries?: AgentLibrary[];
  /**
   * Wall-clock date the model should ground relative and year-omitted dates
   * in. Defaults to the real clock; overridable so a test can pin "today"
   * instead of the run's outcome depending on when it happens to execute.
   */
  now?: Date;
};

const RUN_SQL_TOOL_NAME = "run_sql";

/**
 * One database needs no selector — there is nothing to choose. More than one
 * does, and the parameter only exists in that shape: adding an always-present
 * "database" argument would make the common single-connection case ask the
 * model to name the one thing it already knows, for no benefit.
 */
function buildRunSqlTool(connections: AgentConnection[]): ToolDefinition {
  const multiple = connections.length > 1;
  return {
    name: RUN_SQL_TOOL_NAME,
    description:
      (multiple
        ? `Run a read-only SQL query against one of this workspace's databases and get the rows back. ` +
          `Say which one with "database" — see each one's schema below to decide, and check there before ` +
          `assuming a table lives on the wrong one. `
        : "Run a read-only SQL query against the connected database and get the rows back. ") +
      "Call this before stating any figure — never answer from memory or from the schema alone. " +
      "One statement per call. If it errors, read the message, fix the query, and call again. " +
      "If a filter value came from the reader's wording rather than from a result you have seen, " +
      "look the real value up before trusting an empty answer: no rows means this query matched " +
      "nothing, not that nothing is there.",
    parameters: {
      type: "object",
      properties: {
        ...(multiple
          ? {
              database: {
                type: "string",
                description: `Exact database name, one of: ${connections.map((c) => c.name).join(", ")}.`,
              },
            }
          : {}),
        sql: {
          type: "string",
          description: "A single read-only SQL statement in the connection's dialect.",
        },
        purpose: {
          type: "string",
          description: "One short phrase describing what this query is for, shown to the user.",
        },
      },
      required: multiple ? ["database", "sql", "purpose"] : ["sql", "purpose"],
      additionalProperties: false,
    },
  };
}

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
    yield { type: "completed", content: DEMO_REPLY, thinking: null, steps, model: null, usage: null };
    return;
  }

  // What this run may search, fixed by the caller before the model is asked
  // anything. Every later decision about libraries is made against this list.
  const libraries = input.libraries ?? [];

  const system = buildSystemPrompt({
    playbookContext: input.playbookContext,
    responseDetail: input.responseDetail,
    connections: input.connections.map((c) => ({
      name: c.name,
      engine: c.engine,
      schema: c.schema,
      description: c.description,
    })),
    libraries: libraries.map((library) => ({ name: library.name, description: library.description })),
    now: input.now ?? new Date(),
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
    ...(input.connections.length > 0 ? [buildRunSqlTool(input.connections)] : []),
    ...(input.reportGenerator ? [GENERATE_ESG_REPORT_TOOL] : []),
    ...(libraries.length > 0 ? [buildSearchDocumentsTool(libraries)] : []),
  ];
  let answer = "";
  let reasoning = "";
  let model: string | null = null;
  // How many tools this run has actually called, and whether the forced retry
  // has already been spent. Both are per-run, not per-iteration: a turn that
  // queried and then summarised has done its work and must not be retried.
  let toolCallsMade = 0;
  let forcedRetryUsed = false;
  let toolChoice: "auto" | "required" = "auto";
  /**
   * What this run really did as far as sources go: databases that returned a
   * successful query and (library, file) pairs a search returned. Written only
   * from results the loop received, never from anything the model said, and
   * consulted when an answer closes with a Sources block. See ./provenance.
   */
  const ledger = new ProvenanceLedger();
  const sourceStyle = { showLibrary: libraries.length > 1 };
  let sourcesCorrected = false;
  /**
   * Rows the most recent successful query returned. The *last* one rather than
   * the run's total on purpose: a turn that finds rows and then asks a narrower
   * question which legitimately comes back empty should be able to say so.
   */
  let lastQueryRowCount = 0;
  /** Whether that result actually found anything — a count of zero did not. */
  let lastQueryFoundNothing = true;
  let contradictionCorrected = false;
  /**
   * Set when the most recent query compared a text column to a date-shaped
   * literal with a range — see `dateColumnMismatchNote`. Overwritten by each
   * query, same as `lastQueryFoundNothing`: this is a claim about the query
   * the answer is actually resting on, not a history of every query run.
   */
  let lastQueryTypeMismatch: string | null = null;
  let typeMismatchCorrected = false;
  /**
   * Set when the most recent query found nothing after dating its rows by one
   * of the table's several date columns — see `unqueriedDateColumns`. Empty
   * results only, so a query that found what it was looking for is never
   * second-guessed about which column it looked in.
   */
  let lastQueryOtherDateColumns: string | null = null;
  let dateColumnCorrected = false;
  /**
   * Set when the most recent query ranked groups by count and the top row was
   * not the winner it looks like — see `rankingWithoutAWinner`. Overwritten by
   * each query, like the notes above it.
   */
  let lastQueryNoWinner: string | null = null;
  /**
   * And whether that was the degenerate case, where the top tally is 1 and so
   * nothing repeats at all. Only that case is retried: it is the one where
   * naming a most-common value is not a judgment call but a false statement.
   */
  let lastQueryNothingRepeats = false;
  let noWinnerCorrected = false;
  /**
   * Every value each database has shown the model: the schema's value lists,
   * plus the cells of every result read so far. This is what a filter literal
   * has to be backed by before an empty result may be called an absence.
   *
   * Keyed by connection id rather than one shared set: a value real on one
   * connection must not excuse an absence claim about a different one in the
   * same multi-connection run.
   *
   * Seeded from the schema rather than left empty, so the common case costs
   * nothing — with value hints in the prompt the model usually filters on a
   * spelling that is already in here, and the check stays silent.
   */
  const vouchedByConnection = new Map<string, Set<string>>();
  for (const connection of input.connections) {
    const values = new Set<string>();
    for (const table of connection.schema ?? []) {
      for (const column of table.columns) {
        for (const value of column.distinct_values?.list ?? []) {
          values.add(value.trim().toLowerCase());
        }
      }
    }
    vouchedByConnection.set(connection.id, values);
  }
  /**
   * Literals from the most recent query that came back empty, when nothing
   * vouched for them. Overwritten by each query rather than accumulated: the
   * claim an answer makes is about the last thing it looked at.
   */
  let unverifiedAbsence: string[] | null = null;
  let absenceCorrected = false;
  /**
   * Everywhere a figure in an answer could legitimately have come from. The
   * retry only looks at turns that called no tool, so this is the question and
   * the conversation so far and nothing else: stored history carries no tool
   * results (see `messages` above), which means a number recalled from a past
   * turn counts as grounded only if that turn said it out loud — the same
   * standard the reader was held to.
   */
  const grounded = [input.question, ...input.history.map((message) => message.content)];
  /**
   * The same sources plus the schema, for quoted values only. A column name or
   * one of the values the schema lists for a column is something the model read
   * rather than invented, and `renderValues` puts plenty of both in front of it.
   */
  const valueSources = [...grounded, system];
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      let turn: ModelTurn | null = null;
      const think = new ThinkFilter();

      for await (const event of input.client.stream({
        system,
        messages,
        tools,
        maxTokens: MAX_TOKENS,
        effort: input.effort ?? "high",
        enableThinking: input.enableThinking ?? false,
        ...samplingFor(input.enableThinking ?? false),
        toolChoice,
      })) {
        if (event.type === "text_delta") {
          const { visible, thinking } = think.feed(event.text);
          if (thinking) {
            reasoning += thinking;
            yield { type: "thinking_delta", text: thinking };
          }
          if (visible) {
            answer += visible;
            yield { type: "delta", text: visible };
          }
        } else if (event.type === "thinking_delta") {
          reasoning += event.text;
          yield { type: "thinking_delta", text: event.text };
        } else {
          turn = event.turn;
        }
      }

      const trailing = think.finish();
      if (trailing.thinking) {
        reasoning += trailing.thinking;
        yield { type: "thinking_delta", text: trailing.thinking };
      }
      if (trailing.visible) {
        answer += trailing.visible;
        yield { type: "delta", text: trailing.visible };
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

      if (turn.stopReason === "max_tokens") {
        /**
         * The model was cut off before it finished, not because it chose to
         * stop. Falling through to the normal completion path here would
         * present a truncated answer as if it were whole — worse if the cut
         * happened mid tool call, where `turn.toolCalls` holds an incomplete,
         * unsafe-to-execute SQL request. Fail loudly instead of guessing at
         * how much of either was usable.
         */
        yield emit({
          label: "Cut off by the output token limit",
          status: "failed",
          detail:
            turn.toolCalls.length > 0
              ? "The model was cut off mid tool call before it could finish."
              : "The model's reply was cut off before it finished.",
          query_id: null,
        });
        throw new ApiError(
          "upstream_model_error",
          "The model's reply was cut off before it could finish (it hit its output token limit for this conversation). Try a shorter question, ask for less detail, or start a new conversation.",
          { details: { toolCallsInProgress: turn.toolCalls.length } }
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
        const unbacked =
          !forcedRetryUsed && toolCallsMade === 0 && tools.length > 0
            ? unbackedAnswerReason(answer, grounded, valueSources)
            : null;

        if (unbacked) {
          forcedRetryUsed = true;
          toolChoice = "required";
          yield emit({
            label: "Answered without running a query — retrying",
            status: "done",
            detail: unbacked,
            query_id: null,
          });
          // Nothing was appended to `messages` on this path, so the model is
          // asked the original question again rather than shown its own bad
          // answer — which it would otherwise imitate, the same self-imitation
          // that caused this.
          answer = "";
          reasoning = "";
          yield { type: "reset" };
          continue;
        }

        /**
         * The answer says nothing was found while the rows are sitting in the
         * turn above it. This is not a detector's guess about phrasing: the
         * claim is checked against what the last query really returned, so it
         * only fires on a contradiction, and a legitimate "none of them are
         * overdue" reports a query that came back empty and is untouched. A
         * count of zero is one such query — one row by the row count, nothing
         * at all to the reader — and `foundNothing` is what keeps this branch
         * from insisting the data is there on the strength of it.
         *
         * The remedy is not `tool_choice: "required"` — the data has already
         * been fetched and asking again would only fetch it twice. The model is
         * told the count instead, which is the one fact it is contradicting.
         * The correction lives in this run's `messages` only; stored history is
         * rebuilt from the conversation, so nothing synthetic is persisted.
         *
         * Off once the no-winner branch below has spoken. The answer that
         * branch asks for is itself a negation about the rows — "no observation
         * text repeats", "there is no most used one" — and the row count is not
         * a contradiction of that. Leaving this on would take the corrected
         * answer and push the model straight back to the claim it just
         * withdrew: "your last query returned 1 row, so the data is there".
         */
        if (
          !contradictionCorrected &&
          !noWinnerCorrected &&
          !lastQueryFoundNothing &&
          claimsNothingWasFound(answer)
        ) {
          contradictionCorrected = true;
          yield emit({
            label: "Said nothing was found when rows came back — retrying",
            status: "done",
            detail: `The last query returned ${lastQueryRowCount} row${lastQueryRowCount === 1 ? "" : "s"}.`,
            query_id: null,
          });
          messages.push({
            role: "user",
            content:
              `Your last query returned ${lastQueryRowCount} row${lastQueryRowCount === 1 ? "" : "s"}, so the data is there. ` +
              `Answer from those rows and quote what they say. Do not report that nothing was found.`,
          });
          answer = "";
          reasoning = "";
          yield { type: "reset" };
          continue;
        }

        /**
         * The answer names a most-common value, and the ranking behind it has
         * a top tally of 1 — so every value occurs once, and the row that
         * sorted first is an arbitrary tie-break rather than a winner. This is
         * the opposite failure to the one above: there the rows were there and
         * the answer denied them, here the row is there and the answer claims
         * something of it that a tie cannot support.
         *
         * Gated on the degenerate case only. A tie further up (four categories
         * at 40 rows each) is a judgment call about how to report it, and the
         * note in the payload is the right weight for that. A top tally of 1 is
         * not a judgment call: there is no most-used value to name, so the
         * sentence is false however it is phrased.
         *
         * Not `tool_choice: "required"`, unlike the absence retries. The model
         * may need a different query — group by a column whose values actually
         * repeat — but it may equally answer correctly with no query at all, by
         * telling the reader this column holds one distinct value per record.
         * Forcing a tool would rule out the better of the two answers.
         */
        if (
          !noWinnerCorrected &&
          lastQueryNothingRepeats &&
          lastQueryNoWinner &&
          claimsAMostCommonValue(answer)
        ) {
          noWinnerCorrected = true;
          yield emit({
            label: "Named a most-common value where nothing repeats — retrying",
            status: "done",
            detail: lastQueryNoWinner,
            query_id: null,
          });
          messages.push({
            role: "user",
            content:
              `${lastQueryNoWinner} Answer again on that basis. If you run another query, say which ` +
              `column you grouped by; if you do not, say plainly that there is no most common value here.`,
          });
          answer = "";
          reasoning = "";
          yield { type: "reset" };
          continue;
        }

        /**
         * The answer reports an absence, and the empty result behind it came
         * from a value nothing vouches for. This is the case the branch above
         * cannot see: there is no contradiction to catch, because the query
         * really did return nothing — it just asked the wrong question.
         *
         * Forced, unlike the contradiction: that one already had its rows and
         * only needed to read them, while this one is missing the lookup it
         * never did. The tool is made mandatory so the next turn goes and finds
         * what the column holds instead of restating the same empty answer.
         *
         * Once. If the model checks and the value genuinely is not there, its
         * second answer says so and is accepted — an absence that has been
         * verified is exactly what this is trying to produce, not something to
         * keep arguing with.
         */
        if (!absenceCorrected && unverifiedAbsence && claimsNothingWasFound(answer)) {
          const quoted = unverifiedAbsence.map((value) => `'${value}'`).join(", ");
          absenceCorrected = true;
          toolChoice = "required";
          yield emit({
            label: "Reported an absence on an unverified value — retrying",
            status: "done",
            detail: `Nothing in the schema or in this conversation shows that ${quoted} exists.`,
            query_id: null,
          });
          messages.push({
            role: "user",
            content:
              `You are reporting that nothing was found, but the query that came back empty filtered on ` +
              `${quoted}, which is your own spelling — nothing in the schema or in this conversation shows ` +
              `the database holds that value. Find out what the column really contains before answering: ` +
              `SELECT DISTINCT on it, or a case-insensitive LIKE on a distinctive fragment. If a close value ` +
              `exists, query it and answer from those rows. If the column genuinely has nothing like it, say ` +
              `that and say what it does hold.`,
          });
          answer = "";
          reasoning = "";
          yield { type: "reset" };
          continue;
        }

        /**
         * The answer reports an absence, and the empty result behind it came
         * from one of several date columns on the table. Neither branch above
         * can see this one: there is no contradiction, because the query really
         * did return nothing, and no unvouched literal, because a date is
         * exactly the kind of value `comparable` drops. The query was
         * well-formed and asked the wrong column.
         *
         * Forced, for the same reason as the unvouched absence: the lookup that
         * would settle it has not happened yet. Once — if the model checks the
         * other columns, or goes back to the row by its key, and the row still
         * is not there, that second answer is a verified absence and is exactly
         * what this is trying to produce.
         */
        if (!dateColumnCorrected && lastQueryOtherDateColumns && claimsNothingWasFound(answer)) {
          dateColumnCorrected = true;
          toolChoice = "required";
          yield emit({
            label: "Reported an absence from one date column of several — retrying",
            status: "done",
            detail: lastQueryOtherDateColumns,
            query_id: null,
          });
          messages.push({
            role: "user",
            content:
              `${lastQueryOtherDateColumns} Run that check now, then answer from what it returns. If the ` +
              `row genuinely is not there under any of these columns, say so and say which ones you tried.`,
          });
          answer = "";
          reasoning = "";
          yield { type: "reset" };
          continue;
        }

        /**
         * The answer rests on a query that filtered a text column with a
         * date-shaped range — see `dateColumnMismatchNote`. Unlike the
         * absence case above, this does not wait for the answer to claim
         * nothing was found: a wrong-column comparison can just as easily
         * land on a plausible nonzero number, and the mistake is invisible
         * in the prose either way. It is forced rather than left to the
         * model's own judgment because this is exactly the self-check a
         * reasoning pass would normally catch, and with `enableThinking` off
         * there is no reasoning pass for it to happen in.
         *
         * Once. If the model reruns against the real date column and the
         * number holds, or it has a real reason the comparison is fine on
         * this schema, that answer is accepted rather than argued with twice.
         */
        if (!typeMismatchCorrected && lastQueryTypeMismatch) {
          typeMismatchCorrected = true;
          toolChoice = "required";
          yield emit({
            label: "Queried a text column with a date range — retrying",
            status: "done",
            detail: lastQueryTypeMismatch,
            query_id: null,
          });
          messages.push({
            role: "user",
            content: `${lastQueryTypeMismatch} Rerun against the correct column before answering.`,
          });
          answer = "";
          reasoning = "";
          yield { type: "reset" };
          continue;
        }

        /**
         * Sources. Only in a workspace that has libraries: without them the
         * model was never asked for a block, and what it writes is left alone.
         *
         * The block the model wrote is checked against the ledger and rebuilt
         * from the lines the ledger backs. If a search returned documents and
         * no valid block came out, that is one corrective retry, spent the
         * same way as the ones above; after it the answer goes out as it is,
         * without a block rather than with an unbacked one.
         *
         * `completed.content` is what the reader ends up with: the client
         * replaces whatever it streamed with it, and it is what is stored.
         */
        let finalContent = answer.trim();
        if (libraries.length > 0) {
          const checked = checkSources(answer, ledger, sourceStyle);
          if (!sourcesCorrected && ledger.retrievedDocuments > 0 && checked.kept === 0) {
            sourcesCorrected = true;
            yield emit({
              label: "Answered from documents without listing sources — retrying",
              status: "done",
              detail: "A search returned documents, but the answer had no Sources block that could be confirmed.",
              query_id: null,
            });
            messages.push({ role: "user", content: sourcesCorrection(ledger, sourceStyle) });
            answer = "";
            reasoning = "";
            yield { type: "reset" };
            continue;
          }
          finalContent = checked.text.trim();
        }

        yield {
          type: "completed",
          content: finalContent,
          thinking: reasoning.trim() || null,
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
        if (call.name === SEARCH_DOCUMENTS_TOOL_NAME) {
          // Authorization happens here, on every call, against the list the
          // application built. The model supplies at most a library's display
          // name; everything else in `call.input` is ignored, so a tenant id, a
          // key, a token or an address in it changes nothing.
          const resolution = resolveLibrary(libraries, call.input.library);
          if ("error" in resolution) {
            messages.push({
              role: "tool",
              toolCallId: call.id,
              toolName: call.name,
              content: resolution.error,
              isError: true,
            });
            continue;
          }
          const { library } = resolution;
          const where = libraries.length > 1 ? JSON.stringify(library.name.trim()) : "documents";

          const query = typeof call.input.query === "string" ? call.input.query.trim() : "";
          if (!query) {
            messages.push({
              role: "tool",
              toolCallId: call.id,
              toolName: call.name,
              content: "The 'query' argument was empty. Say what to search for.",
              isError: true,
            });
            continue;
          }

          try {
            const found = await library.search(query);
            ledger.recordDocuments(
              library.name,
              Array.isArray(found.passages) ? found.passages.map((passage) => passage.source) : []
            );
            yield emit({
              label: `Searched ${where}: ${query}`,
              status: "done",
              detail: `${found.coverage.returned} of ${found.coverage.matched} matching passages`,
              query_id: null,
            });
            messages.push({
              role: "tool",
              toolCallId: call.id,
              toolName: call.name,
              content: JSON.stringify(found),
              isError: false,
            });
          } catch (error) {
            // One fixed sentence per kind of failure, and nothing derived from
            // the error itself: its text can hold the server's address or part
            // of its reply, and this goes to the model and to the reader.
            const detail = describeSearchFailure(error);
            // Never fabricate context in its place: a retrieval failure is
            // reported to the model as exactly that, so it can say retrieval
            // was unavailable rather than answer as if nothing existed to find.
            yield emit({ label: `Searching ${where}: ${query}`, status: "failed", detail, query_id: null });
            messages.push({
              role: "tool",
              toolCallId: call.id,
              toolName: call.name,
              content: `Document search failed: ${detail} Do not guess what the documents say.`,
              isError: true,
            });
          }
          continue;
        }

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

        if (call.name !== RUN_SQL_TOOL_NAME || input.connections.length === 0) {
          messages.push({
            role: "tool",
            toolCallId: call.id,
            toolName: call.name,
            content: "No database is attached to this conversation, so queries cannot be run.",
            isError: true,
          });
          continue;
        }

        const databaseName = typeof call.input.database === "string" ? call.input.database.trim() : "";
        const target =
          input.connections.length === 1
            ? input.connections[0]
            : input.connections.find((c) => c.name.toLowerCase() === databaseName.toLowerCase());

        if (!target) {
          messages.push({
            role: "tool",
            toolCallId: call.id,
            toolName: call.name,
            content: `No database named "${databaseName}". Available: ${input.connections.map((c) => c.name).join(", ")}.`,
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
          const { queryId, result } = await target.execute(sql);
          ledger.recordQuery(target.engine, target.name);
          // Non-null: seeded above for every connection in input.connections,
          // and target is always drawn from that same list.
          const vouched = vouchedByConnection.get(target.id)!;
          lastQueryRowCount = result.row_count;
          lastQueryFoundNothing = foundNothing(result.rows, result.row_count);
          // Only a result that found nothing raises the question at all, and it
          // is answered against what was known before this query ran; whatever
          // it returned is folded in afterwards, for the queries that follow.
          const unvouched = lastQueryFoundNothing ? unvouchedLiterals(sql, vouched) : [];
          unverifiedAbsence = unvouched.length > 0 ? unvouched : null;
          lastQueryTypeMismatch = dateColumnMismatchNote(sql, target.schema);
          // Only an empty result raises the question of whether the right date
          // column was asked: rows that came back answered it.
          const otherDates = lastQueryFoundNothing
            ? unqueriedDateColumns(sql, dateColumnsFor(sql, target.schema))
            : null;
          lastQueryOtherDateColumns = otherDates
            ? otherDateColumnsNote(otherDates.filtered, otherDates.others)
            : null;
          // Judged on the full result rather than the trimmed copy: the rows
          // are ordered descending, so the trim cannot change which tally is
          // top, and the untrimmed rows say how many groups tie for it.
          const ranking = rankingWithoutAWinner(
            sql,
            result.columns.map((column) => column.name),
            result.rows
          );
          lastQueryNoWinner = ranking ? noWinnerNote(ranking) : null;
          lastQueryNothingRepeats = ranking?.nothingRepeats ?? false;
          for (const value of vouchedFrom(result.rows)) vouched.add(value);
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
            content: JSON.stringify(
              summarize(
                result,
                sql,
                target.schema,
                unvouched,
                lastQueryOtherDateColumns,
                lastQueryNoWinner
              )
            ),
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
        (libraries.length > 0 ? checkSources(answer, ledger, sourceStyle).text.trim() : answer.trim()) ||
        "I could not finish this within the step limit. Narrowing the question usually helps.",
      thinking: reasoning.trim() || null,
      steps,
      model,
      usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    };
  } catch (error) {
    yield { type: "failed", error: translate(error), steps };
  }
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
function samplingNote(sql: string, result: QueryResult, heldForSize = false): string | null {
  const bare = withoutLiterals(sql).toLowerCase();
  const arbitrary = /\blimit\s+\d/.test(bare) && !/\border\s+by\b/.test(bare);
  const held = result.truncated || result.rows.length > ROWS_IN_CONTEXT || heldForSize;

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

/**
 * Column data types the schema declares, keyed by column name in lowercase
 * for case-insensitive lookup, holding the schema's actual casing alongside
 * the type so it can be echoed back to the model correctly spelled.
 */
function columnTypes(schema: SchemaTable[] | null): Map<string, { name: string; type: string }> {
  const types = new Map<string, { name: string; type: string }>();
  for (const table of schema ?? []) {
    for (const column of table.columns) {
      types.set(column.name.toLowerCase(), { name: column.name, type: column.data_type });
    }
  }
  return types;
}

const STRING_TYPE = /^(character varying|character|varchar|char|text|citext)\b/i;
const DATE_OR_TIME_TYPE = /^(date|timestamp|time)\b/i;
const DATE_SHAPED_LITERAL = /^\d{4}-\d{2}-\d{2}/;

/** `col >=/<=/>/<'literal'`, column name bare or double-quoted. */
const RANGE_COMPARISON = /(?:"((?:[^"]|"")+)"|\b([A-Za-z_][A-Za-z0-9_]*)\b)\s*(?:>=|<=|>|<)\s*'([^']*)'/g;
/** `col BETWEEN 'lit1' AND 'lit2'`, same identifier shapes. */
const BETWEEN_COMPARISON =
  /(?:"((?:[^"]|"")+)"|\b([A-Za-z_][A-Za-z0-9_]*)\b)\s+BETWEEN\s+'([^']*)'\s+AND\s+'([^']*)'/gi;

/**
 * A column the schema says is text, compared to a date-shaped literal with a
 * range operator or BETWEEN.
 *
 * This is what let a bad column choice through silently on a journeys query:
 * `"Departure Point" >= '2026-09-01' AND < '2026-10-01'` is valid SQL against
 * a text column — Postgres just compares the strings lexically — so it runs
 * without error and returns a confident, wrong 0. Nothing about the result
 * looks broken: no exception, one plausible-looking row of output. The only
 * place the mistake is visible is the schema the query ran against, so that
 * is where this checks, in code, rather than trusting the model to have
 * reasoned it out — which matters especially with `enableThinking` off, where
 * there is no deliberation step for that self-check to happen in.
 *
 * Matching requires the identifier to resolve to an actual schema column, so
 * a bare word that happens to precede a comparison operator and isn't a real
 * column (a keyword, a function name) never flags: the lookup into `types`
 * comes back empty and the candidate is dropped before anything is reported.
 */
function dateColumnMismatchNote(sql: string, schema: SchemaTable[] | null): string | null {
  const types = columnTypes(schema);
  if (types.size === 0) return null;

  const flagged = new Set<string>();
  const consider = (quoted: string | undefined, bare: string | undefined, ...literals: string[]) => {
    const name = quoted?.replace(/""/g, '"') ?? bare;
    if (!name) return;
    const column = types.get(name.toLowerCase());
    if (!column || !STRING_TYPE.test(column.type)) return;
    if (literals.some((literal) => DATE_SHAPED_LITERAL.test(literal))) flagged.add(column.name);
  };

  for (const match of sql.matchAll(RANGE_COMPARISON)) consider(match[1], match[2], match[3]);
  for (const match of sql.matchAll(BETWEEN_COMPARISON)) consider(match[1], match[2], match[3], match[4]);
  if (flagged.size === 0) return null;

  const columns = [...flagged].map((name) => `"${name}"`).join(", ");
  const candidates = [...types.values()]
    .filter((column) => DATE_OR_TIME_TYPE.test(column.type))
    .map((column) => `"${column.name}"`);

  return (
    `${columns} ${flagged.size === 1 ? "is a text column" : "are text columns"}, not a date or timestamp, but ` +
    `this query compared ${flagged.size === 1 ? "it" : "them"} to a date-shaped literal using a range. Text ` +
    `compares lexically, not calendrically, so this result almost certainly does not mean what a date filter ` +
    `would have meant. Check the schema for the real date/timestamp column` +
    (candidates.length ? ` — candidates on this table: ${candidates.join(", ")}` : "") +
    ` and rerun before answering from this result.`
  );
}

/**
 * The date and timestamp columns of the tables this query reads.
 *
 * Scoped by which table names appear in the statement, unlike `columnTypes`
 * above, because this one names its findings out loud: telling a model querying
 * `Observations DB` that it forgot `Report."Reporting Period"` would be an
 * invitation to go and join two unrelated tables. When no table name matches —
 * an alias, a CTE, a spelling this does not recognise — the whole schema is the
 * fallback, since a slightly wide list is still better than silence.
 */
function dateColumnsFor(sql: string, schema: SchemaTable[] | null): string[] {
  const haystack = sql.toLowerCase();
  const all = schema ?? [];
  const named = all.filter((table) => haystack.includes(table.name.toLowerCase()));
  const scoped = named.length > 0 ? named : all;

  const columns = new Set<string>();
  for (const table of scoped) {
    for (const column of table.columns) {
      if (DATE_OR_TIME_TYPE.test(column.data_type)) columns.add(column.name);
    }
  }
  return [...columns];
}

/**
 * One cell, shortened to what identifies it — with the shortening stated in
 * the value rather than done quietly, so the model never reads a cut-off
 * incident report as the whole of one and quotes it back as complete.
 */
function cellInContext(value: unknown): unknown {
  if (typeof value !== "string" || value.length <= CELL_CHARS_IN_CONTEXT) return value;
  return `${value.slice(0, CELL_CHARS_IN_CONTEXT)}… [truncated, ${value.length} characters in full — the reader has all of it in the table]`;
}

/**
 * As many rows as fit `RESULT_CHARS_IN_CONTEXT`, each trimmed cell by cell.
 *
 * Always at least one row, even when that row alone is over budget: a result
 * the model cannot see at all is worse than one it can see the shape of, and
 * `rows_shown` next to `row_count` is what tells it which it is looking at.
 */
function rowsInContext(rows: unknown[][]): { rows: unknown[][]; heldForSize: boolean } {
  const capped = rows.slice(0, ROWS_IN_CONTEXT).map((row) => row.map(cellInContext));
  const kept: unknown[][] = [];
  let used = 0;

  for (const row of capped) {
    used += JSON.stringify(row).length;
    if (used > RESULT_CHARS_IN_CONTEXT && kept.length > 0) break;
    kept.push(row);
  }

  return { rows: kept, heldForSize: kept.length < capped.length };
}

/**
 * Trims a result set to what is useful in context, with what it does and does
 * not establish alongside.
 *
 * The model needs enough rows to describe the shape and cite specifics; it does
 * not need ten thousand of them, and sending them would burn the context window
 * for nothing. The user still gets the full result — this trim only applies to
 * what goes back into the conversation.
 */
function summarize(
  result: QueryResult,
  sql: string,
  schema: SchemaTable[] | null,
  unvouched: string[] = [],
  otherDateColumns: string | null = null,
  ranking: string | null = null
) {
  const { rows, heldForSize } = rowsInContext(result.rows);
  const sampling = samplingNote(sql, result, heldForSize);
  const typeMismatch = dateColumnMismatchNote(sql, schema);
  return {
    columns: result.columns.map((column) => column.name),
    rows,
    row_count: result.row_count,
    rows_shown: rows.length,
    truncated: result.truncated || rows.length < result.rows.length,
    duration_ms: result.duration_ms,
    ...(sampling ? { sampling } : {}),
    ...(typeMismatch ? { column_type_warning: typeMismatch } : {}),
    ...(unvouched.length ? { unverified_filter: unverifiedFilterNote(unvouched) } : {}),
    ...(otherDateColumns ? { other_date_columns: otherDateColumns } : {}),
    ...(ranking ? { ranking_has_no_winner: ranking } : {}),
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
