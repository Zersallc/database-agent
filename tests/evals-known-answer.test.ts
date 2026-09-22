/**
 * grade-known-answer.ts, tried on runs built by hand — same discipline as
 * tests/evals-grade-media.test.ts: a grader that cannot tell a right run from
 * a wrong one makes the score meaningless, so each direction is checked.
 *
 * What this deliberately does NOT test: claimEvidenceRetrieved and the
 * abstention/factual patterns against a REAL model's actual wording — those
 * need a live run (see the phase report). This proves the grading logic
 * itself is sound, not that any particular live answer passed it.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  abstentionGrade,
  citationPrecisionGrade,
  claimEvidenceRetrieved,
  documentRecall,
  factualCorrectnessGrade,
  retrievalRecallGrade,
} from "@/evals/grade-known-answer";
import type { EvalOutcome } from "@/evals/types";

function outcome(partial: Partial<EvalOutcome> = {}): EvalOutcome {
  return {
    events: [],
    requests: [],
    finalText: "",
    executedSql: [],
    failure: null,
    libraries: ["Contracts"],
    toolCalls: [],
    searches: [],
    retrieved: [],
    queried: [],
    rawAnswer: "",
    retrySteps: [],
    showLibrary: false,
    ...partial,
  };
}

const RELEVANT = ["contract_07.pdf", "contract_08.pdf", "contract_33.pdf", "contract_49.pdf", "contract_52.pdf"];

describe("documentRecall / retrievalRecallGrade", () => {
  test("full recall when every relevant file was retrieved", () => {
    const run = outcome({ retrieved: RELEVANT.map((file) => ({ library: "Contracts", file })) });
    const result = documentRecall(run, RELEVANT);
    assert.equal(result.recallFraction, 1);
    assert.deepEqual(result.missed, []);
    assert.equal(retrievalRecallGrade(run, RELEVANT).pass, true);
  });

  test("partial recall is measured, not just pass/fail", () => {
    const run = outcome({ retrieved: [{ library: "Contracts", file: "contract_49.pdf" }, { library: "Contracts", file: "contract_52.pdf" }] });
    const result = documentRecall(run, RELEVANT);
    assert.equal(result.recallFraction, 2 / 5);
    assert.deepEqual(result.recalled.sort(), ["contract_49.pdf", "contract_52.pdf"]);
    assert.deepEqual(result.missed.sort(), ["contract_07.pdf", "contract_08.pdf", "contract_33.pdf"]);
    // 2/5 still passes the grade — some real evidence reached the run — but the fraction is what the report shows, not a blended verdict.
    assert.equal(retrievalRecallGrade(run, RELEVANT).pass, true);
  });

  test("zero recall fails, and says which files were missed", () => {
    const run = outcome({ retrieved: [{ library: "Contracts", file: "contract_03.pdf" }] });
    const grade = retrievalRecallGrade(run, RELEVANT);
    assert.equal(grade.pass, false);
    assert.equal(grade.category, "retrieval");
    assert.match(grade.reason, /0%/);
  });

  test("a search that returned nothing at all fails cleanly, not as a division error", () => {
    const grade = retrievalRecallGrade(outcome(), RELEVANT);
    assert.equal(grade.pass, false);
  });
});

describe("citationPrecisionGrade — document-level only", () => {
  test("passes when every cited file is in the relevant set", () => {
    const run = outcome({ finalText: "Yes.\n\nSources:\ncontract_49.pdf\ncontract_07.pdf" });
    assert.equal(citationPrecisionGrade(run, RELEVANT).pass, true);
  });

  test("fails when a cited file is outside the relevant set — this is the exact discrepancy the live test surfaced", () => {
    // Mirrors what actually happened this session: the live chat cited
    // contract_01/03/04, none of which are in para-01's real relevant set.
    const run = outcome({ finalText: "Yes.\n\nSources:\ncontract_03.pdf\ncontract_01.pdf\ncontract_49.pdf" });
    const grade = citationPrecisionGrade(run, RELEVANT);
    assert.equal(grade.pass, false);
    assert.match(grade.reason, /contract_03\.pdf/);
    assert.match(grade.reason, /contract_01\.pdf/);
    assert.doesNotMatch(grade.reason, /contract_49\.pdf/, "the one legitimate citation must not be named as a problem");
  });

  test("no Sources block is not a citation-precision failure — nothing to check", () => {
    assert.equal(citationPrecisionGrade(outcome({ finalText: "The documents do not cover this." }), RELEVANT).pass, true);
  });

  test("strips a trailing library annotation before comparing, the same way grade-media's plain() does", () => {
    const run = outcome({ showLibrary: true, finalText: "Yes.\n\nSources:\ncontract_49.pdf (Contracts)" });
    assert.equal(citationPrecisionGrade(run, RELEVANT).pass, true);
  });
});

describe("claimEvidenceRetrieved — the layer that is NOT citation precision", () => {
  const quote =
    'Zanotti agrees that Aura shall be allowed the full benefit of any and all lower prices and/or any more favorable terms and/or conditions ("MFN" Terms)';

  test("passes when a retrieved passage actually contains the recorded quote", () => {
    const passages = [{ text: "Section 3.6 Most Favored Nation. During the term of this Agreement, " + quote + " contained in any other agreement..." }];
    assert.equal(claimEvidenceRetrieved(passages, quote).pass, true);
  });

  test("is case- and whitespace-insensitive, since retrieval text wrapping is not semantically meaningful", () => {
    const passages = [{ text: quote.toUpperCase().replace(/\s+/g, "\n") }];
    assert.equal(claimEvidenceRetrieved(passages, quote).pass, true);
  });

  test("fails when no retrieved passage contains the quote — a file-level match is not enough", () => {
    const passages = [{ text: "This section discusses warehousing and shipment risk, nothing about pricing." }];
    const grade = claimEvidenceRetrieved(passages, quote);
    assert.equal(grade.pass, false);
    assert.equal(grade.category, "retrieval");
  });

  test("fails on an empty passage list rather than vacuously passing", () => {
    assert.equal(claimEvidenceRetrieved([], quote).pass, false);
  });
});

describe("factualCorrectnessGrade — fixed pattern, not a judge", () => {
  const pattern = /\b(yes|automatically)\b[\s\S]{0,200}\bmost[\s-]favored[\s-]nation\b/i;

  test("passes on a correctly-worded affirmative answer", () => {
    const run = outcome({ finalText: "Yes — Section 3.6 is a Most Favored Nation clause, so Aura automatically gets the benefit." });
    assert.equal(factualCorrectnessGrade(run, pattern, "MFN clause exists").pass, true);
  });

  test("fails a confident but wrong answer", () => {
    const run = outcome({ finalText: "No, the contract does not contain any most-favored-nation protection for Aura." });
    // "No" + "most-favored-nation" nearby does not match this fixed "yes ... MFN" pattern, so it correctly fails —
    // the known, disclosed limitation is that a differently-worded correct answer could also fail it.
    assert.equal(factualCorrectnessGrade(run, pattern, "MFN clause exists").pass, false);
  });

  test("fails an unrelated answer", () => {
    const run = outcome({ finalText: "The agreement is governed by California law." });
    assert.equal(factualCorrectnessGrade(run, pattern, "MFN clause exists").pass, false);
  });

  // Caught live, in this phase's own first real run against contract_49.pdf,
  // not invented in advance: this exact sentence (paraphrased slightly for
  // the test) matched the pattern above before the negation guard existed,
  // because "automatically" sat within 200 characters of "lower price" and
  // "better terms" regardless of the "not" negating it. Fixed by
  // NEGATION_NEAR_AFFIRMATION; this is the regression test for that fix.
  test("does NOT pass a confident answer that negates the fact using the same keywords the pattern looks for", () => {
    const run = outcome({
      finalText:
        "The contract does not automatically entitle Aura to the same better terms if Zanotti sells the same kind of product to someone else on better terms.",
    });
    const grade = factualCorrectnessGrade(run, pattern, "MFN clause exists");
    assert.equal(grade.pass, false);
    assert.match(grade.reason, /negates/);
  });
});

describe("abstentionGrade", () => {
  test("passes on recognizable decline language", () => {
    for (const text of [
      "The documents do not cover this.",
      "I cannot find any mention of source code escrow in this agreement.",
      "There is no such provision in contract_49.",
      "This is not addressed in the contract.",
      // Both caught live, from two independent real runs of this phase's own
      // abstention case, before these two patterns existed.
      "The document search did not return any information about source code being held in escrow with a neutral third party.",
      "Based on the provided documents, there is no indication that the source code is held in escrow.",
    ]) {
      assert.equal(abstentionGrade(outcome({ finalText: text })).pass, true, text);
    }
  });

  test("fails a fabricated-sounding confident answer", () => {
    const run = outcome({ finalText: "Yes, Section 9.2 places the source code in escrow with a neutral third party." });
    const grade = abstentionGrade(run);
    assert.equal(grade.pass, false);
    assert.equal(grade.category, "answer");
  });
});
