/**
 * A canonical table sitting next to a `_backup` decoy — an extremely common
 * real-schema shape a pruning step could easily rank equally with the real
 * one on name similarity alone, with no business-logic signal to break the
 * tie besides the naming convention itself.
 */

import { allOf, queriedTable, sqlNeverMatches } from "../grade";
import { countResult } from "../fixtures";
import type { EvalCase } from "../types";

export const namingDecoyTable: EvalCase = {
  id: "naming-decoy-table",
  description: "a plain question must hit the canonical table, not its _backup decoy",
  question: "How many orders are there in total?",
  connections: [
    {
      name: "Shop",
      engine: "postgres",
      schema: [
        {
          schema: "public",
          name: "orders",
          description: "All customer orders.",
          row_estimate: 5000,
          columns: [
            { name: "order_id", data_type: "integer", nullable: false, primary_key: true, description: null },
          ],
        },
        {
          schema: "public",
          name: "orders_backup",
          description: "Nightly backup snapshot of orders, retained for 30 days.",
          row_estimate: 5000,
          columns: [
            { name: "order_id", data_type: "integer", nullable: false, primary_key: true, description: null },
          ],
        },
      ],
      execute: async () => countResult(5000),
    },
  ],
  grade: (outcome) =>
    allOf(
      queriedTable(outcome, /\borders\b/i),
      sqlNeverMatches(outcome, /orders_backup/i, "orders_backup is a decoy snapshot, not the canonical table")
    ),
};
