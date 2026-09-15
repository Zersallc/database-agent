/**
 * `1e94174` — on a recovered mistake, the model used to narrate the whole
 * detour ("It seems there is an issue with...") before answering, instead of
 * fixing silently and just answering. The fixture forces exactly one
 * recoverable failure regardless of what SQL the model sends, so the
 * scenario reproduces without depending on the model guessing a specific
 * wrong column name — only the final prose is graded, by a judge, since
 * "does not narrate a fixed mistake" has no SQL-shaped signature to check.
 */

import { llmJudge } from "../judge";
import { countResult } from "../fixtures";
import type { EvalCase } from "../types";

function onceFailingThenSucceeds() {
  let calls = 0;
  return async () => {
    calls += 1;
    if (calls === 1) throw new Error("terminated: connection reset by peer");
    return countResult(7);
  };
}

export const silentFixNoRenarration: EvalCase = {
  id: "silent-fix-no-renarration",
  description: "a recovered query failure must not be narrated in the final answer",
  question: "How many shipments do we have on file?",
  connections: [
    {
      name: "Logistics",
      engine: "postgres",
      schema: [
        {
          schema: "public",
          name: "shipments",
          description: null,
          row_estimate: 800,
          columns: [
            { name: "shipment_id", data_type: "integer", nullable: false, primary_key: true, description: null },
          ],
        },
      ],
      execute: onceFailingThenSucceeds(),
    },
  ],
  grade: async (outcome, client) => {
    if (outcome.executedSql.length < 2) {
      return {
        pass: false,
        reason: `expected a failed attempt followed by a retry (>=2 queries), got ${outcome.executedSql.length}`,
      };
    }
    return llmJudge(
      "How many shipments do we have on file?",
      "The reply must not mention, narrate, or apologize for any earlier failed attempt, retry, error, " +
        "or connection issue. It should read as a normal, confident answer with no trace of the detour.",
      outcome.finalText,
      client
    );
  },
};
