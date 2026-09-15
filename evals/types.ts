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

/** One executed query, attributed to the connection it ran against. */
export type ExecutedQuery = { connection: string; sql: string };

export type EvalOutcome = {
  events: AgentEvent[];
  requests: ModelRequest[];
  /** The agent's final answer text, empty on a failed run. */
  finalText: string;
  executedSql: ExecutedQuery[];
};

export type EvalCase = {
  id: string;
  description: string;
  question: string;
  history?: { role: "user" | "assistant"; content: string }[];
  connections: EvalConnection[];
  /** Pins "today" so date-relative questions are deterministic to grade. */
  now?: Date;
  responseDetail?: ResponseDetail;
  /**
   * `client` is the same real client the case ran against — passed through so
   * a judge-based grade (see `judge.ts`) can make its own follow-up call.
   * Deterministic graders (`grade.ts`) ignore it.
   */
  grade: (outcome: EvalOutcome, client: ModelClient) => GradeResult | Promise<GradeResult>;
};
