/**
 * Shared shapes for the eval suite.
 *
 * Tier A (`tests/`) drives `runAgent` with a scripted model to regression-test
 * the deterministic backstop code. This tier drives it with a *real* model, so
 * a case's `grade` function is judging actual model behavior over a fixture
 * schema — recall, naming, date reasoning — not a mock's reaction to it.
 */

import type { QueryResult, SchemaTable } from "@/lib/connectors";
import type { AgentEvent } from "@/lib/agent";
import type { ResponseDetail } from "@/lib/agent/prompt";
import type { ModelClient, ModelRequest } from "@/lib/agent/providers/types";

export type EvalConnection = {
  name: string;
  engine: string;
  /** What the database holds, as an administrator would write it. Shown to the model. */
  description?: string | null;
  schema: SchemaTable[];
  execute: (sql: string) => Promise<QueryResult>;
};

/**
 * What kind of thing went wrong in a run that did not pass.
 *
 * They are kept apart because they have different owners and different fixes,
 * and a single "pass rate" that mixes them says nothing about which to work on:
 *
 * - `routing`: the model picked the wrong tool, source, library, or asked
 *   when it should have acted (or acted when it should have asked).
 * - `answer`: the model routed sensibly and the answer's own behavior was wrong.
 *   This is what the original eleven cases grade (SQL shape, naming, dates).
 * - `retrieval`: a search failed or the retrieval service itself misbehaved.
 * - `provenance_generation`: the model's own Sources block was missing or cited
 *   something the run had not retrieved or queried.
 * - `provenance_sanitization`: the application's check got it wrong: it let an
 *   unbacked line through, or removed a line the run does back.
 * - `rendering`: the delivered answer does not draw as intended.
 *
 * A run that never got an answer because of the provider is not a grade at all.
 * See `RunStatus`.
 */
export type FailureCategory =
  | "routing"
  | "answer"
  | "retrieval"
  | "provenance_generation"
  | "provenance_sanitization"
  | "rendering";

export type GradeResult = {
  pass: boolean;
  reason: string;
  /** What kind of failure this is, when `pass` is false. A grader that does not say is read as `answer`. */
  category?: FailureCategory;
  /** Set by `allOf` and `anyOf`: every failed check, each with its own category. */
  failures?: { category: FailureCategory; reason: string }[];
};

/**
 * One document in a fixture library. `aliases` are words a paraphrase might use
 * that the text does not: they are matched by the fixture retriever, never
 * shown to the model, and stand in for what semantic search finds that keyword
 * search would not.
 */
export type EvalDocument = { file: string; text: string; aliases?: string[] };

/**
 * A document library a case attaches to its run.
 *
 * The harness builds the searchable library from this (see `libraries.ts`), so
 * a case declares what the documents say and the harness records what was asked
 * of them and what came back. That log is the ground truth provenance is graded
 * against: it comes from what the fixture returned, not from what the model or
 * the loop's own ledger says.
 */
export type EvalLibrary = { name: string; description: string | null; documents: EvalDocument[] };

/**
 * A real syslab-server library, for cases that measure the whole path including
 * retrieval. Needs RETRIEVAL_BASE_URL, RETRIEVAL_TOKEN and RETRIEVAL_TEST_TENANT
 * (the syslab key of a test library); the case is skipped when they are not set.
 */
export type LiveLibrary = { name: string; description: string | null };

/** "db:Sales" or "lib:Contracts". */
export type SourceRef = string;

/**
 * Which sources a question needs. `required` must all be used; `allowed` may be
 * used without penalty. Anything else that gets used is a call the question did
 * not need, and is counted as one whether or not the answer came out right.
 */
export type SourceExpectation = { required: SourceRef[]; allowed?: SourceRef[] };

/** One tool call the model made, in order. */
export type ToolCallRecord = {
  name: string;
  /** False when the application refused it or it failed. */
  ok: boolean;
  library: string | null;
  database: string | null;
};

/** One search that reached a library, and the files it returned. */
export type SearchRecord = { library: string; query: string; returned: string[] };

/**
 * Why a run produced no answer at all.
 *
 * `retryAfter` is the distinction that matters to a caller: a rate limit is the
 * server asking for a pause and worth waiting out, while a 404 on the model
 * name or a rejected key is a setup mistake that every remaining run would
 * reproduce identically.
 */
export type RunFailure = {
  code: string;
  message: string;
  /** Seconds the provider asked us to wait, or null when it was not a rate limit. */
  retryAfter: number | null;
};

/** One executed query, attributed to the connection it ran against. */
export type ExecutedQuery = { connection: string; sql: string };

export type EvalOutcome = {
  events: AgentEvent[];
  requests: ModelRequest[];
  /** The agent's final answer text, empty on a failed run. */
  finalText: string;
  executedSql: ExecutedQuery[];
  /**
   * Set when the run never produced an answer at all — a provider error rather
   * than anything a grader should have an opinion about.
   *
   * Without this the two are indistinguishable downstream, and they grade
   * identically: an empty `finalText` and no `executedSql` fail every check
   * with a reason about model behavior. A whole suite once reported 0% across
   * eleven cases and fifty-five runs, every reason reading "no queries ran",
   * for a `model` in `.env.local` the server did not serve — a 404 on every
   * request, described as a reasoning failure.
   */
  failure: RunFailure | null;
  /** Names of the libraries this run was given. */
  libraries: string[];
  /** Every tool call the model made, in the order it made them. */
  toolCalls: ToolCallRecord[];
  /** Searches that reached a library, with the files each returned. */
  searches: SearchRecord[];
  /** Every (library, file) pair any search returned: the ground truth for what may be cited. */
  retrieved: { library: string; file: string }[];
  /** Databases (by name and engine) on which at least one query succeeded. */
  queried: { name: string; engine: string }[];
  /** What the model wrote last, before the application's Sources check: the text since the final reset. */
  rawAnswer: string;
  /** Labels of any retry steps the loop took. The provenance retry is the one that mentions sources. */
  retrySteps: string[];
  /** Whether the workspace had more than one library, which is what makes a Sources line carry its library. */
  showLibrary: boolean;
};

/**
 * What became of one scheduled run.
 *
 * Only a `valid` run says anything about the model. The other three are the
 * measuring equipment failing, and counting them as model failures would make a
 * busy gateway look like a model regression:
 *
 * - `rate_limited`: the provider asked for a pause (HTTP 429) and still did after backing off.
 * - `infrastructure`: the provider or the network did not answer (5xx, timeout, connection reset).
 * - `execution_failure`: the run failed for any other reason (a refusal, an output cut off, a
 *   rejected credential or unknown model, which are setup mistakes and stop the suite).
 */
export type RunStatus = "valid" | "rate_limited" | "infrastructure" | "execution_failure";

/** One scheduled run, after however many attempts it took. */
export type RunRecord = {
  status: RunStatus;
  /** Times the run was started. More than one means it was retried after a failure. */
  attempts: number;
  /** For a run that did not end `valid`: what the last attempt failed with. */
  failure: { code: string; message: string; http_status: number | null } | null;
  /** Present only for a `valid` run. */
  grade: GradeResult | null;
  /** Failed checks by kind. Empty for a passing run. */
  failure_categories: FailureCategory[];
  /** Sources the run used that the question did not need. Null when the case declares none, so "no unnecessary calls" is not claimed for it. */
  unnecessary_sources: SourceRef[] | null;
  /** Sources the question required and the run never used. Null under the same condition. */
  missing_sources: SourceRef[] | null;
  /** Tool names in the order they were called, e.g. ["run_sql", "search_documents"]. */
  tools: string[];
  /** Whether the model answered without calling anything. */
  answered_without_tools: boolean;
  /** Whether the run ended in a clarifying question rather than a data answer. */
  ended_in_question: boolean;
  /** Documents were retrieved (so a Sources block is expected). */
  documents_retrieved: boolean;
  /** The provenance retry fired. */
  provenance_retry: boolean;
  /** Any other retry step fired. */
  other_retry: boolean;
  /** The delivered answer ends with a Sources block. */
  delivered_block: boolean;
  /** Lines the application removed from the model's block. */
  lines_removed: number;
  /** Requests sent for this run, including ones the provider turned away. */
  requests: number;
  /** Of those, how many the provider answered with HTTP 429. */
  rate_limited_requests: number;
  input_tokens: number;
  output_tokens: number;
  duration_ms: number;
};

export type EvalCase = {
  id: string;
  description: string;
  /**
   * Which family of cases this belongs to, for the report: the nine planned for
   * media connections (see evals/cases/index.ts), "vague" for the known
   * under-triggering, "live" for the ones that reach a real syslab-server.
   * Absent on the original eleven, which the report calls "legacy".
   */
  family?: string;
  question: string;
  history?: { role: "user" | "assistant"; content: string }[];
  connections: EvalConnection[];
  /** Fixture libraries attached to the run. Absent means none, which is what the original eleven have. */
  libraries?: EvalLibrary[];
  /** A real syslab library attached to the run, instead of or beside fixture ones. */
  live?: LiveLibrary;
  /** Which sources the question needs. Drives the unnecessary-call accounting. */
  sources?: SourceExpectation;
  /** Pins "today" so date-relative questions are deterministic to grade. */
  now?: Date;
  /**
   * Clears fixture state before each run. Only a case that has any.
   *
   * A fixture that scripts a sequence — "fail the first call, then succeed" —
   * keeps its counter in the closure, and the closure is built once when the
   * module is imported, so every repeat after the first inherits a spent one.
   * `silent-fix-no-renarration` reported 33% for exactly that: run 1 got its
   * recoverable failure and passed, runs 2 and 3 were never given one and were
   * graded for not retrying a query that never failed.
   */
  reset?: () => void;
  responseDetail?: ResponseDetail;
  /**
   * `client` is the same real client the case ran against — passed through so
   * a judge-based grade (see `judge.ts`) can make its own follow-up call.
   * Deterministic graders (`grade.ts`) ignore it.
   */
  grade: (outcome: EvalOutcome, client: ModelClient) => GradeResult | Promise<GradeResult>;
};
