/**
 * Representative prompt inputs for a workspace with databases only.
 *
 * The eval suite's baseline (11 cases, 100% at 10 repeats) was measured against
 * the prompt these produce. A change that adds document libraries must leave
 * every one of them byte-for-byte alone, so `prompt-sources.test.ts` pins a
 * SHA-256 of each. If a later edit to the database-only prompt is intended,
 * update the hashes in the same commit and say why: the baseline no longer
 * describes the prompt.
 */

import type { SchemaTable } from "@/lib/connectors";
import type { PromptInput } from "@/lib/agent/prompt";

const ORDERS: SchemaTable = {
  schema: "public",
  name: "orders",
  description: "Live, current orders.",
  row_estimate: 40000,
  columns: [
    { name: "order_id", data_type: "integer", nullable: false, primary_key: true, description: null },
    { name: "status", data_type: "text", nullable: true, primary_key: false, description: "Order lifecycle state." },
  ],
};

const ARCHIVE: SchemaTable = {
  schema: "public",
  name: "orders",
  description: "Historical orders migrated from the legacy system.",
  row_estimate: 500000,
  columns: [{ name: "order_id", data_type: "integer", nullable: false, primary_key: true, description: null }],
};

const NOW = new Date("2026-09-21T00:00:00Z");

export const DATABASE_ONLY_FIXTURES: Record<string, PromptInput> = {
  "no database attached": {
    playbookContext: "",
    responseDetail: "balanced",
    connections: [],
    now: NOW,
  },
  "one postgres database": {
    playbookContext: "",
    responseDetail: "concise",
    connections: [{ name: "Sales", engine: "postgres", schema: [ORDERS] }],
    now: NOW,
  },
  "two databases and a playbook": {
    playbookContext: "Revenue means recognised revenue, not bookings.",
    responseDetail: "detailed",
    connections: [
      { name: "Sales", engine: "postgres", schema: [ORDERS] },
      { name: "Sales Archive", engine: "postgres", schema: [ARCHIVE] },
    ],
    now: NOW,
  },
  "the built-in sample dataset": {
    playbookContext: "",
    responseDetail: "balanced",
    connections: [{ name: "Sample", engine: "demo", schema: null }],
    now: NOW,
  },
};
