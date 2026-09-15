/**
 * The naming-convention recall risk this whole suite exists for: a table
 * named the way real ERPs name them (truncated, no vowels) rather than the
 * way the question phrases it. Schema pruning changes what the model sees
 * before it answers — this is what a pruning regression would break first.
 */

import { allOf, queriedTable, sqlNeverMatches } from "../grade";
import { countResult } from "../fixtures";
import type { EvalCase } from "../types";

export const namingAbbreviatedTable: EvalCase = {
  id: "naming-abbreviated-table",
  description: "a question in plain wording must find a table named in abbreviated ERP style",
  question: "How many customers do we have on file?",
  connections: [
    {
      name: "ERP",
      engine: "postgres",
      schema: [
        {
          schema: "public",
          name: "cust_mstr",
          description: "Customer master records.",
          row_estimate: 12000,
          columns: [
            { name: "cust_id", data_type: "integer", nullable: false, primary_key: true, description: null },
            { name: "cust_nm", data_type: "text", nullable: false, primary_key: false, description: null },
            { name: "region_cd", data_type: "text", nullable: true, primary_key: false, description: null },
          ],
        },
        {
          schema: "public",
          name: "prod_cat",
          description: "Product catalog.",
          row_estimate: 900,
          columns: [
            { name: "prod_id", data_type: "integer", nullable: false, primary_key: true, description: null },
            { name: "prod_nm", data_type: "text", nullable: false, primary_key: false, description: null },
          ],
        },
      ],
      execute: async () => countResult(12000),
    },
  ],
  grade: (outcome) =>
    allOf(
      queriedTable(outcome, /\bcust_mstr\b/i),
      sqlNeverMatches(outcome, /\bprod_cat\b/i, "a customer count has no business touching the product catalog")
    ),
};
