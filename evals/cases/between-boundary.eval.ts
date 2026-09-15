/**
 * `8be0df6` — filtering a period with `BETWEEN` and two date literals
 * silently truncates the last day on a timestamp column. The fix is a prompt
 * rule (half-open range or `DATE_TRUNC`/`EXTRACT` instead), so it can only be
 * checked by watching real SQL the model writes, not by re-running the
 * agent's own deterministic checks against a scripted turn.
 */

import { allOf, queriedTable, sqlNeverMatches } from "../grade";
import { countResult } from "../fixtures";
import type { EvalCase } from "../types";

const BETWEEN_TWO_DATES = /BETWEEN\s+'[\d-]{8,10}(?:[ T][\d:]+)?'\s+AND\s+'[\d-]{8,10}(?:[ T][\d:]+)?'/i;

export const betweenBoundary: EvalCase = {
  id: "between-boundary",
  description: "a calendar-month count on a timestamp column must not use BETWEEN with two date literals",
  question: "How many orders were placed in September 2026?",
  now: new Date("2026-10-15T12:00:00Z"),
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
            { name: "created_at", data_type: "timestamp", nullable: false, primary_key: false, description: null },
          ],
        },
      ],
      execute: async () => countResult(42),
    },
  ],
  grade: (outcome) =>
    allOf(
      queriedTable(outcome, /orders/i),
      sqlNeverMatches(
        outcome,
        BETWEEN_TWO_DATES,
        "BETWEEN with two date literals excludes same-day timestamps on the end date"
      )
    ),
};
