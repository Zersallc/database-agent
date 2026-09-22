/**
 * Family: efficiency.
 *
 * Questions the database answers completely, asked in a workspace that also has
 * document libraries. Zero searches: a search of a library that has no reason to
 * hold the answer is a call the question did not need, whatever the answer looks
 * like. The last case is the subtle one from the routing policy: the query
 * returns nothing, which is an incomplete answer, but nothing about the question
 * points at the documents, so the model must not go looking "just in case".
 */

import { allOf } from "../grade";
import { neverSearched, usedSql } from "../grade-media";
import { CONTRACTS, HR_POLICIES, salesDatabase } from "../media-fixtures";
import type { EvalCase } from "../types";

const base = {
  family: "efficiency",
  connections: [salesDatabase()],
  libraries: [CONTRACTS, HR_POLICIES],
  sources: { required: ["db:Sales"], allowed: [] as string[] },
};

export const mediaEfficiencyCases: EvalCase[] = [
  {
    ...base,
    id: "media-efficiency-revenue-by-region",
    description: "revenue by region is one query, and no library is searched",
    question: "What was our total revenue by region?",
    grade: (outcome) => allOf(usedSql(outcome), neverSearched(outcome, "revenue is in the database")),
  },
  {
    ...base,
    id: "media-efficiency-order-count",
    description: "a count of orders is one query, and no library is searched",
    question: "How many orders have we received in total?",
    grade: (outcome) => allOf(usedSql(outcome), neverSearched(outcome, "an order count is in the database")),
  },
  {
    ...base,
    id: "media-efficiency-top-customers",
    description: "a ranking of customers by spend is one query, and no library is searched",
    question: "Who are our five biggest customers by total spend?",
    grade: (outcome) => allOf(usedSql(outcome), neverSearched(outcome, "customer spend is in the database")),
  },
  {
    ...base,
    id: "media-efficiency-empty-result",
    description: "a query that finds nothing is not a reason to search the documents when nothing points there",
    question: "How many orders did we receive in March 2019?",
    grade: (outcome) => allOf(usedSql(outcome), neverSearched(outcome, "an empty result for a date range does not suggest the documents hold orders")),
  },
];
