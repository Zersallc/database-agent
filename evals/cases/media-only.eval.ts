/**
 * Family: media-only.
 *
 * What a document says. The right library is searched, no query is run, the
 * answer states what the document states, and the Sources block names the file
 * the answer came from and nothing that was not retrieved.
 *
 * Three shapes: a database is also attached (so the model has a real choice),
 * the workspace has no database at all (the prompt then says so), and a
 * paraphrase that shares almost no words with the passage.
 */

import { allOf } from "../grade";
import { answerMatches, neverRanSql, provenanceHolds, retrievalSucceeded, searchedLibrary } from "../grade-media";
import { CONTRACTS, salesDatabase } from "../media-fixtures";
import type { EvalCase } from "../types";

export const mediaOnlyCases: EvalCase[] = [
  {
    id: "media-only-notice-period",
    family: "media-only",
    description: "what a contract says about termination notice is found in the library, with a database also attached",
    question: "What notice period does our supply agreement with Northwind require for termination?",
    connections: [salesDatabase()],
    libraries: [CONTRACTS],
    sources: { required: ["lib:Contracts"], allowed: [] },
    grade: (outcome) =>
      allOf(
        searchedLibrary(outcome, "Contracts"),
        neverRanSql(outcome, "what a contract says is not in the database"),
        retrievalSucceeded(outcome),
        answerMatches(outcome, /thirty|\b30\b/i, "the notice period the contract states"),
        provenanceHolds(outcome, { cites: ["contract_03.pdf"] })
      ),
  },
  {
    id: "media-only-no-database",
    family: "media-only",
    description: "with no database attached the library is searched and the answer is drawn from it",
    question: "Under the Globex customer agreement, how many days do they have to pay an invoice?",
    connections: [],
    libraries: [CONTRACTS],
    sources: { required: ["lib:Contracts"], allowed: [] },
    grade: (outcome) =>
      allOf(
        searchedLibrary(outcome, "Contracts"),
        retrievalSucceeded(outcome),
        answerMatches(outcome, /forty[- ]five|\b45\b/i, "the payment term the contract states"),
        provenanceHolds(outcome, { cites: ["contract_11.pdf"] })
      ),
  },
  {
    id: "media-only-paraphrase",
    family: "media-only",
    description: "a question that shares almost no words with the clause still reaches the right document",
    question: "If we give someone else a better price than Globex, does Globex automatically get it too?",
    connections: [salesDatabase()],
    libraries: [CONTRACTS],
    sources: { required: ["lib:Contracts"], allowed: [] },
    grade: (outcome) =>
      allOf(
        searchedLibrary(outcome, "Contracts"),
        neverRanSql(outcome, "a pricing commitment is in the contract, not a column"),
        retrievalSucceeded(outcome),
        answerMatches(outcome, /most[- ]favou?red|same price|that price|lower price|also (?:get|receive)|automatic|entitled/i, "the clause the paraphrase points at"),
        provenanceHolds(outcome, { cites: ["contract_11.pdf"] })
      ),
  },
];
