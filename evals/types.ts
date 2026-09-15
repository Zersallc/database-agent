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
  schema: SchemaTable[];
  execute: (sql: string) => Promise<QueryResult>;
};

export type GradeResult = { pass: boolean; reason: string };

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
};

export type EvalCase = {
  id: string;
  description: string;
  question: string;
  history?: { role: "user" | "assistant"; content: string }[];
  connections: EvalConnection[];
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
