/**
 * Family: live.
 *
 * The same path as the fixture cases, but the library is a real syslab-server
 * tenant, so the retrieval is real: real passages from real contracts, real
 * relevance ranking, real failures. This is the arm where a retrieval problem can
 * show up, and where it is reported as one (`retrieval`), not as the model
 * failing to route.
 *
 * What is graded is deliberately not facts. The corpus is a set of commercial
 * contracts the suite does not control, so a case cannot know what the right
 * answer says. It grades what can be checked without that: the library was
 * searched, the search succeeded, and the Sources block names only files the
 * search actually returned and renders correctly.
 *
 * Needs RETRIEVAL_BASE_URL, RETRIEVAL_TOKEN and RETRIEVAL_TEST_TENANT. Without
 * them the runner leaves these cases out and says so.
 */

import { allOf } from "../grade";
import { didNotAskInstead, provenanceHolds, retrievalSucceeded, searchedLibrary } from "../grade-media";
import type { EvalCase } from "../types";

const live = { name: "Contracts", description: "Commercial contracts." };

export const mediaLiveCases: EvalCase[] = [
  {
    id: "live-termination-notice",
    family: "live",
    description: "a question about termination notice is answered from real retrieved passages, citing only files that were returned",
    question: "What termination notice periods do our contracts provide?",
    connections: [],
    live,
    sources: { required: ["lib:Contracts"], allowed: [] },
    grade: (outcome) => allOf(searchedLibrary(outcome, "Contracts"), retrievalSucceeded(outcome), provenanceHolds(outcome)),
  },
  {
    id: "live-paraphrase",
    family: "live",
    description: "a paraphrase with almost no words in common with the clause still reaches real passages",
    question: "If somebody else gets a sweeter deal later, do we automatically get it too?",
    connections: [],
    live,
    sources: { required: ["lib:Contracts"], allowed: [] },
    grade: (outcome) => allOf(searchedLibrary(outcome, "Contracts"), retrievalSucceeded(outcome), provenanceHolds(outcome)),
  },
  {
    id: "live-late-delivery",
    family: "live",
    description: "a question about credits for late delivery reaches real passages",
    question: "Do any of our contracts give a discount or credit when delivery is late?",
    connections: [],
    live,
    sources: { required: ["lib:Contracts"], allowed: [] },
    grade: (outcome) => allOf(searchedLibrary(outcome, "Contracts"), retrievalSucceeded(outcome), provenanceHolds(outcome)),
  },
  {
    id: "live-vague-show-contracts",
    family: "live",
    description: "\"show me the contracts\" against a real library is a search",
    question: "Show me the contracts.",
    connections: [],
    live,
    sources: { required: ["lib:Contracts"], allowed: [] },
    grade: (outcome) =>
      allOf(searchedLibrary(outcome, "Contracts"), didNotAskInstead(outcome), retrievalSucceeded(outcome), provenanceHolds(outcome)),
  },
];
