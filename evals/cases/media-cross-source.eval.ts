/**
 * Family: cross-source.
 *
 * A question with one part for the database and one for the documents. Both must
 * be used, the answer must contain a fact from each, and the Sources block must
 * name both: the database that answered the figure and the file that answered
 * the clause. This is the case the "PostgreSQL — Sales" line exists for.
 */

import { allOf } from "../grade";
import { answerMatches, provenanceHolds, retrievalSucceeded, searchedLibrary, usedSql } from "../grade-media";
import { CONTRACTS, SALES_FACTS, salesDatabase } from "../media-fixtures";
import type { EvalCase } from "../types";

export const mediaCrossSourceCases: EvalCase[] = [
  {
    id: "media-cross-late-orders-and-penalty",
    family: "cross-source",
    description: "a count from the database and a penalty from the contract, in one answer that names both sources",
    question: "How many orders were delivered late, and what does the Acme supply contract say we owe for late delivery?",
    connections: [salesDatabase()],
    libraries: [CONTRACTS],
    sources: { required: ["db:Sales", "lib:Contracts"], allowed: [] },
    grade: (outcome) =>
      allOf(
        usedSql(outcome, "the first half is a count of orders"),
        searchedLibrary(outcome, "Contracts"),
        retrievalSucceeded(outcome),
        answerMatches(outcome, new RegExp(`\\b${SALES_FACTS.lateOrders}\\b`), "the figure from the database"),
        answerMatches(outcome, /2\s*%|two percent/i, "the credit the contract states"),
        provenanceHolds(outcome, { cites: ["contract_07.pdf"], citesDatabases: ["Sales"] })
      ),
  },
  {
    id: "media-cross-register-and-terms",
    family: "cross-source",
    description: "the register's row count and the contract that allows exit on thirty days' notice",
    question: "How many supplier contracts do we have on record, and which supplier's contract can be ended on 30 days' notice?",
    connections: [salesDatabase()],
    libraries: [CONTRACTS],
    sources: { required: ["db:Sales", "lib:Contracts"], allowed: [] },
    grade: (outcome) =>
      allOf(
        usedSql(outcome, "the first half is a count of rows in the register"),
        searchedLibrary(outcome, "Contracts"),
        retrievalSucceeded(outcome),
        answerMatches(outcome, new RegExp(`\\b${SALES_FACTS.contractsOnRecord}\\b`), "the figure from the register"),
        answerMatches(outcome, /northwind/i, "the supplier whose contract states the notice period"),
        provenanceHolds(outcome, { cites: ["contract_03.pdf"], citesDatabases: ["Sales"] })
      ),
  },
];
