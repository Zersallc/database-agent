/**
 * Family: known-answer.
 *
 * A small, repeatable set with real, checkable ground truth — the gap
 * media-live.eval.ts's own header names explicitly: "What is graded is
 * deliberately not facts. The corpus is a set of commercial contracts the
 * suite does not control, so a case cannot know what the right answer says."
 * These cases can, for the documents covered here, because the ground truth
 * comes from two real sources, not this suite inventing one:
 *
 * 1. syslab-server's own `tests/fixtures/corpus/golden.json` — CUAD v1
 *    (lawyer-annotated, licensed), which document-level relevance labels
 *    come from. `known-para-01` reuses its "para-01" query and `relevant[]`
 *    list exactly.
 * 2. A human-verified fact and exact supporting quote, read directly from
 *    contract_49.pdf (this repository does not hold it; it lives in the
 *    syslab-server checkout this was built against). That verification was
 *    done by Claude, in this implementation pass, not by an independent
 *    domain expert — stated plainly so it is spot-checked, not trusted
 *    silently. See the phase report for the exact passage read.
 *
 * PRE-FLIGHT, required before trusting any score: the indexed corpus was
 * confirmed against `GET /api/v1/documents` (tenant-scoped, not a retrieval
 * probe) to hold exactly 10 files — contract_01/02/03/04/05/07/08/33/49/52 —
 * not golden.json's assumed 52. Every relevant[] list used below was checked
 * against that real 10-file set; para-01's is fully present (07/08/33/49/52,
 * all five), which is why it is usable here and para-02/03/04 (mostly absent
 * from the 10) are not.
 *
 * Four dimensions, reported separately (see evals/grade-known-answer.ts):
 * tool choice (grade-media's searchedLibrary), retrieval recall (document-
 * level, against golden.json), citation precision (document-level: does
 * every cited file sit in the relevant set), and either factual correctness
 * or abstention depending on the case. Claim-level support — whether a
 * cited passage actually backs the specific claim made — is explicitly NOT
 * computed here; it needs raw passage text this harness does not capture
 * (see grade-known-answer.ts's own comment) and is instead a human review
 * recorded in the phase report.
 *
 * Fixed rules only in every grade function used here. No LLM judge is called
 * by anything in this file.
 */

import { allOf } from "../grade";
import { provenanceHolds, searchedLibrary } from "../grade-media";
import {
  abstentionGrade,
  citationPrecisionGrade,
  factualCorrectnessGrade,
  retrievalRecallGrade,
} from "../grade-known-answer";
import type { EvalCase } from "../types";

const live = { name: "Contracts", description: "Commercial contracts." };

/** golden.json "para-01" relevant[], verified present in the actual 10-file indexed corpus. */
const PARA_01_RELEVANT = ["contract_07.pdf", "contract_08.pdf", "contract_33.pdf", "contract_49.pdf", "contract_52.pdf"];

export const mediaKnownAnswerCases: EvalCase[] = [
  {
    id: "known-para-01-sweeter-deal",
    family: "known-answer",
    description:
      "the exact question that failed in the live chat test, now graded against golden.json's real document-level relevance instead of only 'did it search'",
    question: "If somebody else gets a sweeter deal later, do we automatically get it too?",
    connections: [],
    live,
    sources: { required: ["lib:Contracts"], allowed: [] },
    grade: (outcome) =>
      allOf(
        searchedLibrary(outcome, "Contracts"),
        retrievalRecallGrade(outcome, PARA_01_RELEVANT),
        citationPrecisionGrade(outcome, PARA_01_RELEVANT),
        provenanceHolds(outcome)
      ),
  },
  {
    id: "known-contract-49-mfn-fact",
    family: "known-answer",
    description:
      "document-scoped follow-up with a single, human-verified correct answer — contract_49.pdf Section 3.6 is a real Most Favored Nation clause",
    question:
      "According to contract_49.pdf, if Zanotti later sells the same kind of product to someone else on better terms, is Aura automatically entitled to those same better terms?",
    connections: [],
    live,
    sources: { required: ["lib:Contracts"], allowed: [] },
    grade: (outcome) =>
      allOf(
        searchedLibrary(outcome, "Contracts"),
        factualCorrectnessGrade(
          outcome,
          /\b(yes|automatically)\b[\s\S]{0,200}\b(most[\s-]favored[\s-]nation|mfn|lower price|better (?:price|terms)|favorable terms)\b|\b(most[\s-]favored[\s-]nation|mfn)\b[\s\S]{0,200}\b(yes|automatically|entitled|benefit)\b/i,
          "Section 3.6 (Most Favored Nation): Aura is automatically entitled to any better price/terms Zanotti gives a third party for a similar product"
        )
      ),
  },
  {
    id: "known-contract-49-escrow-abstention",
    family: "known-answer",
    description:
      "deliberately unanswerable, document-scoped — contract_49.pdf (read in full for this fixture) has no source-code-escrow language of any kind, and none of the corpus's actual Source Code Escrow category documents (golden.json para-02) are indexed at all",
    question:
      "According to contract_49.pdf (the Aura Systems / Zanotti East agreement), is the source code for any software product held in escrow with a neutral third party in case the supplier fails?",
    connections: [],
    live,
    sources: { required: ["lib:Contracts"], allowed: [] },
    grade: (outcome) => allOf(searchedLibrary(outcome, "Contracts"), abstentionGrade(outcome)),
  },
];
