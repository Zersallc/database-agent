/**
 * Family: vague requests for documents.
 *
 * "Show me the contracts." There is no topic to search for, and the model cannot
 * list a library's files. The prompt says a request to see or find something in
 * the documents is a search, so the expected move is to search with the words of
 * the request and offer to narrow, not to ask "what are you looking for?" first.
 *
 * This is the under-triggering seen when the media work began (informally, 0 of 5
 * with a database and a library attached, against 3 of 5 with a library alone).
 * These cases exist to measure it at a proper repeat count. They are graded on
 * routing only: what a good answer to a vague request looks like is a judgment
 * call, and whether it searched is not.
 */

import { allOf } from "../grade";
import { didNotAskInstead, provenanceHolds, retrievalSucceeded, searchedLibrary } from "../grade-media";
import { CONTRACTS, salesDatabase } from "../media-fixtures";
import type { EvalCase } from "../types";

export const mediaVagueCases: EvalCase[] = [
  {
    id: "media-vague-show-contracts",
    family: "vague",
    description: "\"show me the contracts\" is a search of the library, with a database also attached",
    question: "Show me the contracts.",
    connections: [salesDatabase()],
    libraries: [CONTRACTS],
    sources: { required: ["lib:Contracts"], allowed: ["db:Sales"] },
    grade: (outcome) =>
      allOf(searchedLibrary(outcome, "Contracts"), didNotAskInstead(outcome), retrievalSucceeded(outcome), provenanceHolds(outcome)),
  },
  {
    id: "media-vague-library-only",
    family: "vague",
    description: "\"can I see the supplier agreements\" is a search of the library, with no database attached",
    question: "Can I see the supplier agreements?",
    connections: [],
    libraries: [CONTRACTS],
    sources: { required: ["lib:Contracts"], allowed: [] },
    grade: (outcome) =>
      allOf(searchedLibrary(outcome, "Contracts"), didNotAskInstead(outcome), retrievalSucceeded(outcome), provenanceHolds(outcome)),
  },
];
