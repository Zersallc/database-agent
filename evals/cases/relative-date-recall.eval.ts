/**
 * `7db8f00` — without a real notion of "today", a relative or year-omitted
 * date ("last month") gets resolved against the model's training-time
 * assumption instead of the actual date. `AgentRunInput.now` lets a test pin
 * "today"; this checks the model actually grounds the question in it.
 */

import { allOf, queriedTable, sqlMatchedBy } from "../grade";
import { countResult } from "../fixtures";
import type { EvalCase } from "../types";

export const relativeDateRecall: EvalCase = {
  id: "relative-date-recall",
  description: "\"last month\" must resolve against the pinned current date, not a guessed one",
  question: "How many orders did we get last month?",
  now: new Date("2026-09-15T12:00:00Z"),
  connections: [
    {
      name: "Shop",
      engine: "postgres",
      schema: [
        {
          schema: "public",
          name: "orders",
          description: null,
          row_estimate: 5000,
          columns: [
            { name: "order_id", data_type: "integer", nullable: false, primary_key: true, description: null },
            { name: "order_date", data_type: "date", nullable: false, primary_key: false, description: null },
          ],
        },
      ],
      execute: async () => countResult(19),
    },
  ],
  grade: (outcome) =>
    allOf(
      queriedTable(outcome, /orders/i),
      sqlMatchedBy(outcome, /2026-08/, "with 'today' pinned to 2026-09-15, last month is August 2026")
    ),
};
