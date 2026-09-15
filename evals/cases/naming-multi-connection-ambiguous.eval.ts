/**
 * `dc072b9` — the agent now sees every connection at once and has to pick.
 * Two connections with similar names are the sharpest version of the naming
 * recall risk raised for the schema-pruning work: pruning operates within a
 * chosen connection, but choosing the wrong connection loses the data
 * entirely, with no retry inside a single database to recover from.
 */

import { allOf, neverUsedConnection, usedConnection } from "../grade";
import { countResult } from "../fixtures";
import type { EvalCase } from "../types";

export const namingMultiConnectionAmbiguous: EvalCase = {
  id: "naming-multi-connection-ambiguous",
  description: "a question about current data must route to the live connection, not the similarly-named archive",
  question: "How many orders do we have right now?",
  connections: [
    {
      name: "Sales",
      engine: "postgres",
      schema: [
        {
          schema: "public",
          name: "orders",
          description: "Live, current orders.",
          row_estimate: 40000,
          columns: [
            { name: "order_id", data_type: "integer", nullable: false, primary_key: true, description: null },
          ],
        },
      ],
      execute: async () => countResult(40000),
    },
    {
      name: "Sales Archive",
      engine: "postgres",
      schema: [
        {
          schema: "public",
          name: "orders",
          description: "Historical orders migrated from the legacy system, discontinued in 2019.",
          row_estimate: 500000,
          columns: [
            { name: "order_id", data_type: "integer", nullable: false, primary_key: true, description: null },
          ],
        },
      ],
      execute: async () => countResult(500000),
    },
  ],
  grade: (outcome) =>
    allOf(usedConnection(outcome, "Sales"), neverUsedConnection(outcome, "Sales Archive")),
};
