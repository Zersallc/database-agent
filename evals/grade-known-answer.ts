/**
 * Grading for the known-answer set (evals/cases/media-known-answer.eval.ts).
 *
 * Four dimensions, reported separately, never blended into one score, per the
 * plan's own explicit correction: a matching filename or quote shows evidence
 * was retrieved, not that a specific claim in the final answer is actually
 * supported by it. This file computes what a fixed rule can prove; it does
 * not compute claim-level support — that is a human review, recorded in the
 * fixture/report, not a function here (see docs at the bottom).
 *
 * Fixed rules only. No LLM judge call is made by anything in this file — a
 * judge, if ever added, is a secondary, clearly-labeled diagnostic on top of
 * these results, never a replacement for them.
 */

import type { EvalOutcome, GradeResult } from "./types";
import { blockLines, plain } from "./grade-media";

function pass(reason: string): GradeResult {
  return { pass: true, reason };
}
function fail(category: GradeResult["category"], reason: string): GradeResult {
  return { pass: false, category, reason };
}

// -- Tool choice --------------------------------------------------------
// Already covered by grade-media.ts's searchedLibrary/neverSearched — not
// duplicated here. A known-answer case's own `grade` calls those directly.

// -- Retrieval (document-level recall against golden.json) --------------

export type RecallResult = {
  relevant: string[];
  recalled: string[];
  missed: string[];
  /** Fraction of `relevant` that at least one search actually returned. 0 when nothing was searched. */
  recallFraction: number;
};

/**
 * Document-level only: whether the FILES golden.json calls relevant were
 * among what any search actually returned. Says nothing about whether a
 * specific passage supports a specific claim — that is citation/claim
 * support, below, kept deliberately separate.
 */
export function documentRecall(outcome: EvalOutcome, relevant: string[]): RecallResult {
  const returned = new Set(outcome.retrieved.map((r) => r.file));
  const recalled = relevant.filter((f) => returned.has(f));
  const missed = relevant.filter((f) => !returned.has(f));
  return { relevant, recalled, missed, recallFraction: relevant.length === 0 ? 1 : recalled.length / relevant.length };
}

export function retrievalRecallGrade(outcome: EvalOutcome, relevant: string[]): GradeResult {
  const result = documentRecall(outcome, relevant);
  const pct = Math.round(result.recallFraction * 100);
  if (result.recalled.length === 0) {
    return fail(
      "retrieval",
      `none of the ${relevant.length} known-relevant document(s) were retrieved (0%): missed ${result.missed.join(", ")}`
    );
  }
  return pass(`retrieved ${result.recalled.length}/${relevant.length} known-relevant document(s) (${pct}%): ${result.recalled.join(", ")}`);
}

// -- Citation support: two layers, not one ------------------------------

/**
 * Layer 1 (this function): does every file the delivered answer actually
 * CITES appear in the document-level relevant set. This is the fixed,
 * mechanical check — it proves the citation points at a topically relevant
 * document, nothing more. Passing this is necessary but not sufficient for
 * "the claim is supported"; see claimEvidenceRetrieved and the human-review
 * field below for the rest.
 */
export function citationPrecisionGrade(outcome: EvalOutcome, relevant: string[]): GradeResult {
  const cited = (blockLines(outcome.finalText) ?? []).map(plain).map((line) => line.replace(/\s*\([^)]*\)\s*$/, ""));
  if (cited.length === 0) return pass("no Sources block was delivered, so there is nothing to check for citation precision");
  const relevantSet = new Set(relevant);
  const irrelevant = cited.filter((file) => !relevantSet.has(file));
  if (irrelevant.length > 0) {
    return fail(
      "answer",
      `the delivered Sources block cites ${irrelevant.length} document(s) outside the known-relevant set: ${irrelevant.join(", ")}`
    );
  }
  return pass(`every cited document (${cited.join(", ")}) is in the known-relevant set — document-level only, not a claim-support check`);
}

/**
 * Layer 2: does at least one passage contain the human-recorded supporting
 * quote (substring match, case-insensitive, whitespace-normalized — a fixed
 * rule, not a judge). This proves specific supporting EVIDENCE was available
 * to be retrieved. It is still not proof the final answer's claim is
 * accurate or that the model actually used this passage — that is a human
 * review of the answer against the passage (see `ClaimReview` below),
 * because it is a judgment a substring match cannot make.
 *
 * Deliberately takes raw passages as a parameter rather than reading them off
 * `EvalOutcome`: the harness's own `SearchRecord` (evals/types.ts) only keeps
 * the filenames a search returned, not passage text — extending it to carry
 * text as well would be a real, if small, change to shared harness
 * infrastructure every other eval case also depends on, which this phase's
 * scope does not call for. The caller fetches passages itself (a direct
 * `RetrievalClient.retrieve()` call, the same one this session already used
 * for the earlier retrieval smoke test) and this function only judges them.
 */
export function claimEvidenceRetrieved(passages: { text: string }[], expectedQuoteSubstring: string): GradeResult {
  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const needle = normalize(expectedQuoteSubstring);
  const found = passages.some((p) => normalize(p.text).includes(needle));
  if (!found) {
    return fail(
      "retrieval",
      "no retrieved passage contained the recorded supporting quote — no evidence for this specific fact reached the run"
    );
  }
  return pass("a retrieved passage contains the recorded supporting quote — evidence was available; see the human review for whether the answer used it correctly");
}

/**
 * A negation sitting close before an affirmative word this pattern is
 * looking for ("does NOT automatically entitle...") — checked separately
 * from `pattern` and overrides it regardless of what else matches.
 *
 * Found live, in this phase's own first run, not invented in advance: an
 * answer that flatly denied the fact ("The contract does not automatically
 * entitle Aura...") still matched a pattern requiring the word
 * "automatically" near "lower price"/"better terms", because the pattern
 * checked proximity, not polarity — a real false positive a synthetic test
 * fixture had not covered, caught only by reading actual model output. This
 * guard, and the test for this exact sentence, exist because of that run.
 */
const NEGATION_NEAR_AFFIRMATION = /\b(?:not|n't|never|no\b)\b(?:\s+\S+){0,4}\s+(?:automatically|entitled|yes\b)/i;

/**
 * Fixed-rule factual check: does the final answer's text match the
 * human-recorded expected fact, with no negation sitting between the
 * negation guard and the affirmative language `pattern` looks for.
 * `pattern` is written per-question from the verified fact, not generated —
 * this is not paraphrase-tolerant, which is the known limitation an LLM
 * judge could supplement, never replace.
 */
export function factualCorrectnessGrade(outcome: EvalOutcome, pattern: RegExp, expectedFactDescription: string): GradeResult {
  if (NEGATION_NEAR_AFFIRMATION.test(outcome.finalText)) {
    return fail(
      "answer",
      `the answer negates the affirmative language this pattern looks for (${expectedFactDescription}): ${outcome.finalText.slice(0, 300)}`
    );
  }
  if (pattern.test(outcome.finalText)) return pass(`the answer matches the recorded expected fact: ${expectedFactDescription}`);
  return fail("answer", `the answer does not match the recorded expected fact (${expectedFactDescription}): ${outcome.finalText.slice(0, 300)}`);
}

// -- Abstention -----------------------------------------------------------

// The last two entries were added after real, live runs of this phase's own
// abstention case missed them: "do not provide explicit information about"
// and "did not return any information about" both correctly declined but
// matched none of the original patterns. Two independent misses from real
// model output, not one, is why these were added rather than left as a
// disclosed gap — further phrasings are still expected to slip through this
// list, which is exactly why a judge is proposed as a supplement, not a
// reason to keep chasing every wording by hand.
const ABSTENTION_PATTERNS = [
  /(?:does|do) not (?:appear to |explicitly )?(?:address|cover|mention|discuss)/i,
  /(?:no|not) (?:mention|reference) of/i,
  /(?:cannot|can't|could not|couldn't) find/i,
  /not (?:covered|addressed) (?:in|by)/i,
  /I (?:don't|do not) (?:see|find)/i,
  /no (?:such|relevant) (?:clause|provision|term)/i,
  /(?:did|does) not (?:return|provide|contain|give) (?:any |explicit )?information/i,
  /no indication that/i,
];

/** Did the model correctly decline rather than fabricate, for a question with no real answer in what was retrieved. */
export function abstentionGrade(outcome: EvalOutcome): GradeResult {
  const matched = ABSTENTION_PATTERNS.some((p) => p.test(outcome.finalText));
  if (matched) return pass("the answer contains recognizable abstention language for a question with no answer in this document");
  return fail("answer", `expected the model to decline — no abstention language found: ${outcome.finalText.slice(0, 300)}`);
}

/**
 * Claim-level support is NOT computed by this file. It is recorded here as a
 * type so the fixture/report can carry it structurally, but the value itself
 * comes from a person (in this implementation pass, Claude, reading the
 * delivered answer against the actual retrieved passage) reviewing whether
 * the answer's specific claim is genuinely backed by what was retrieved —
 * exactly the distinction the plan's correction drew: a matching filename or
 * quote is not, by itself, proof of claim-level support.
 */
export type ClaimReview = {
  verdict: "supported" | "unsupported" | "partially_supported";
  reviewedBy: string;
  notes: string;
};
