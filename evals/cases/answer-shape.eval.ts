/**
 * A wide result set must be summarized, not retyped.
 *
 * Asked for 63 health-related observations, the agent answered by rewriting ten
 * of them as themed prose bullets — while the table holding all 63, sortable
 * and exportable, sat directly above it. The reader gets the same data twice and
 * the ten the model picked are not the ten they would have picked.
 *
 * Graded deterministically rather than by judge: the fixture knows exactly which
 * strings the rows hold, so counting how many of them reappear in the prose is a
 * fact, not an opinion. Two are allowed — naming an example or an outlier is the
 * legitimate version of this.
 */

import { allOf, retypesRows } from "../grade";
import { rowsResult } from "../fixtures";
import type { EvalCase } from "../types";

/** Distinctive enough that a match in the prose is a retyping, not a coincidence. */
const OBSERVATIONS = Array.from(
  { length: 63 },
  (_, i) => `Finding ${String(i + 1).padStart(3, "0")}: kilo-sierra-${i + 1} noted on site`
);

export const answerShape: EvalCase = {
  id: "answer-shape",
  description: "a 63-row result is summarized, not rewritten as a list of its rows",
  question: "What health or hygiene observations are on file?",
  connections: [
    {
      name: "Observations",
      engine: "postgres",
      schema: [
        {
          schema: "public",
          name: "observation",
          description: "One row per reported observation.",
          row_estimate: 5400,
          columns: [
            { name: "observation_id", data_type: "integer", nullable: false, primary_key: true, description: null },
            { name: "finding", data_type: "text", nullable: true, primary_key: false, description: null },
            {
              name: "subclassification",
              data_type: "text",
              nullable: true,
              primary_key: false,
              description: null,
              distinct_values: {
                list: ["Health or Hygiene or Ergonomic Hazards", "Unsafe Act", "Unsafe Condition"],
                complete: true,
              },
            },
          ],
        },
      ],
      execute: async () =>
        rowsResult(
          ["observation_id", "finding"],
          OBSERVATIONS.map((finding, i) => [i + 1, finding])
        ),
    },
  ],
  grade: (outcome) =>
    allOf(
      retypesRows(outcome, OBSERVATIONS, 2),
      {
        pass: outcome.executedSql.length > 0,
        reason:
          outcome.executedSql.length > 0
            ? "the answer rests on a query"
            : "no query ran, so there was nothing to summarize",
      }
    ),
};
