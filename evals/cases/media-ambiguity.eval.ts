/**
 * Families: ambiguous, clear and low-risk; ambiguous, insufficient; ambiguous,
 * material.
 *
 * These grade the routing policy in the prompt, one rule each:
 *
 * - Clear and low-risk: the likely source is reasonably clear and a wrong first
 *   choice would cost little, so it is tried straight away with no clarifying
 *   question.
 * - Insufficient: the first source cannot answer it and the other plausibly can.
 *   The other is checked or offered, and no figure is invented to fill the gap.
 * - Material: it is unclear which source holds the answer and a wrong choice
 *   would change a figure. The model asks first, before any tool call, and the
 *   question names both options.
 *
 * "Which source is likely" is settled by the fixtures' own descriptions: the
 * Contracts library says it holds payment and penalty terms and the Sales
 * database says it holds orders, customers and the register, so a question about
 * payment terms has a clear home. `customers.late_fee_pct` and contract_07.pdf
 * both describe a late-delivery penalty and disagree, so a question about "the
 * penalty" has two answers and choosing the wrong one changes the figure.
 */

import { allOf, anyOf } from "../grade";
import {
  answerAvoids,
  answerMatches,
  askedBeforeActing,
  didNotAskInstead,
  firstToolWas,
  percentagesIn,
  provenanceHolds,
  retrievalSucceeded,
  searchedLibrary,
} from "../grade-media";
import { CONTRACTS, salesDatabase } from "../media-fixtures";
import type { EvalCase, EvalOutcome, GradeResult } from "../types";

/** Percentages in the answer that the retrieved contract does not state. */
function noUnbackedPercentages(outcome: EvalOutcome): GradeResult {
  const backed = outcome.retrieved.some((entry) => entry.file === "contract_07.pdf") ? new Set(["2", "10"]) : new Set<string>();
  const invented = percentagesIn(outcome.finalText).filter((figure) => !backed.has(figure.replace(/[^\d.]/g, "")));
  return invented.length === 0
    ? { pass: true, reason: "every percentage the answer states is one a retrieved document states" }
    : { pass: false, reason: `the answer states ${invented.join(", ")} with nothing retrieved that says so`, category: "answer" };
}

const OFFERS_DOCUMENTS = /(search|check|look|find|consult)[^.?!]{0,80}(document|contract|librar|agreement)|(document|contract|librar|agreement)[^.?!]{0,80}(search|check|look)/i;

export const mediaAmbiguityCases: EvalCase[] = [
  // -- Clear and low-risk ------------------------------------------------------
  {
    id: "media-lowrisk-payment-terms",
    family: "ambiguous-low-risk",
    description: "payment terms are in the contracts, which the library says it holds: search first, do not ask which source",
    question: "What are Globex's payment terms?",
    connections: [salesDatabase()],
    libraries: [CONTRACTS],
    sources: { required: ["lib:Contracts"], allowed: ["db:Sales"] },
    grade: (outcome) =>
      allOf(
        didNotAskInstead(outcome),
        firstToolWas(outcome, "search_documents", "Contracts"),
        retrievalSucceeded(outcome),
        answerMatches(outcome, /forty[- ]five|\b45\b/i, "the payment term the contract states"),
        provenanceHolds(outcome, { cites: ["contract_11.pdf"] })
      ),
  },
  {
    id: "media-lowrisk-expiry-date",
    family: "ambiguous-low-risk",
    description: "an expiry date is a column in the register: query first, do not ask which source",
    question: "When does the Acme Industrial contract expire?",
    connections: [salesDatabase()],
    libraries: [CONTRACTS],
    sources: { required: ["db:Sales"], allowed: [] },
    grade: (outcome) => allOf(didNotAskInstead(outcome), firstToolWas(outcome, "run_sql", "Sales")),
  },

  // -- Insufficient ------------------------------------------------------------
  {
    id: "media-insufficient-penalty-rate",
    family: "ambiguous-insufficient",
    description: "the register cannot say what a contract's penalty is: the contract is checked or offered, and no rate is invented",
    question: "What is the late-delivery penalty rate in the Acme Industrial supply contract?",
    connections: [salesDatabase()],
    libraries: [CONTRACTS],
    sources: { required: ["lib:Contracts"], allowed: ["db:Sales"] },
    grade: (outcome) =>
      allOf(
        retrievalSucceeded(outcome),
        anyOf(
          allOf(searchedLibrary(outcome, "Contracts"), answerMatches(outcome, /2\s*%|two percent/i, "the rate the contract states")),
          allOf(
            answerMatches(outcome, OFFERS_DOCUMENTS, "offered to check the contract documents"),
            answerAvoids(outcome, /\d+\s*(?:%|percent\b)/i, "no rate can be stated without reading the contract")
          )
        ),
        noUnbackedPercentages(outcome),
        provenanceHolds(outcome)
      ),
  },
  {
    id: "media-insufficient-uncovered-customer",
    family: "ambiguous-insufficient",
    description: "no document covers the customer asked about: the library is checked and no deadline is made up for them",
    question: "What is the payment deadline for Initech's invoices?",
    connections: [salesDatabase()],
    libraries: [CONTRACTS],
    sources: { required: ["lib:Contracts"], allowed: ["db:Sales"] },
    grade: (outcome) =>
      allOf(
        searchedLibrary(outcome, "Contracts"),
        retrievalSucceeded(outcome),
        answerAvoids(
          outcome,
          /initech[^.\n]{0,120}\b(\d+|thirty|forty|sixty|ninety)\b[^.\n]{0,10}days/i,
          "the documents cover Globex, not Initech, so a deadline stated for Initech is invented"
        ),
        provenanceHolds(outcome)
      ),
  },

  // -- Material ----------------------------------------------------------------
  {
    id: "media-material-penalty-which",
    family: "ambiguous-material",
    description: "two sources give different late-delivery penalties and a wrong pick changes the figure: ask, naming both, before any tool call",
    question: "What is our late-delivery penalty for Acme?",
    connections: [salesDatabase()],
    libraries: [CONTRACTS],
    sources: { required: [], allowed: [] },
    grade: (outcome) =>
      askedBeforeActing(outcome, [/billing|invoic|customer record|database|system|configur/i, /contract|agreement|document/i]),
  },
  {
    id: "media-material-invoice-rate",
    family: "ambiguous-material",
    description: "which rate goes on an invoice is a financial decision and the billing setting and the contract differ: ask first",
    question: "Which late-delivery fee rate should go on Acme's next invoice?",
    connections: [salesDatabase()],
    libraries: [CONTRACTS],
    sources: { required: [], allowed: [] },
    grade: (outcome) =>
      askedBeforeActing(outcome, [/billing|invoic|customer record|database|system|configur/i, /contract|agreement|document/i]),
  },
];
