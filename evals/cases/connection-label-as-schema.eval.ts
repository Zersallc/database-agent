/**
 * `0b624d9` — a connection is introduced to the model by its human-readable
 * label, which is not a SQL identifier. When that label is punctuated or
 * multi-word, a model can mistake it for a schema/catalog prefix and try to
 * qualify table names with it — invalid SQL that took several recovery
 * guesses to notice in the real incident.
 */

import { allOf, queriedTable, sqlNeverMatches } from "../grade";
import { countResult } from "../fixtures";
import type { EvalCase } from "../types";

const CONNECTION_LABEL = "Client's Reporting DB";

export const connectionLabelAsSchema: EvalCase = {
  id: "connection-label-as-schema",
  description: "a punctuated connection label must never be used as a SQL schema/catalog prefix",
  question: "How many shipments are on file in total?",
  connections: [
    {
      name: CONNECTION_LABEL,
      engine: "postgres",
      schema: [
        {
          schema: "public",
          name: "shipments",
          description: null,
          row_estimate: 800,
          columns: [
            { name: "shipment_id", data_type: "integer", nullable: false, primary_key: true, description: null },
            { name: "status", data_type: "text", nullable: false, primary_key: false, description: null },
          ],
        },
      ],
      execute: async () => countResult(10),
    },
  ],
  grade: (outcome) =>
    allOf(
      queriedTable(outcome, /shipments/i),
      sqlNeverMatches(outcome, /Client's Reporting DB/i, "the connection's human label is not a SQL identifier")
    ),
};
