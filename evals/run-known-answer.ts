/**
 * A dedicated runner for the known-answer set (evals/cases/media-known-answer.eval.ts),
 * separate from the shared `evals/run.ts` CLI, for one structural reason: it
 * needs each run's actual retrieved passage TEXT, and the shared harness's
 * `SearchRecord` (evals/types.ts) only ever kept filenames — every other case
 * and grader in this project depends on that type, so widening it here would
 * ripple outward for a need only this file has.
 *
 * Everything else reuses the real, already-tested harness: `runCase` from
 * evals/harness.ts builds the real `EvalOutcome` (correct toolCalls, searches,
 * retrieved, failure handling) exactly as `evals/run.ts` does. Only the
 * `liveLibrary` passed to it differs, adding a side-channel that also keeps
 * the passage TEXT `SearchRecord` throws away — the run itself is identical.
 *
 * Why this exists at all: a claim that a fact was "retrieved" is worthless
 * unless checked against what a SPECIFIC run actually saw, not a separate
 * probe run afterward with its own query wording, k and timing — that only
 * proves the corpus CAN return the passage, never that THIS run's own search
 * call did. Every `retrieved_passages` value below comes from the exact call
 * inside the exact run it is attached to.
 *
 * Persists one JSON file per invocation to evals/results/ (already
 * git-ignored for *.json). Four dimensions, kept separate: tool choice,
 * retrieval recall, and (whichever applies to the case) citation precision,
 * factual correctness, or abstention. "heuristic": true marks every regex
 * dimension for what it is until a person has read the matching transcript.
 * `reviewed_verdict` starts "not_reviewed" and is filled in by a second pass
 * over this same file, reading real text — never inferred from the regex
 * result, which is exactly the distinction this correction asked for.
 *
 * Same cleanup discipline as run.ts's own (now fixed) liveLibrary: the
 * ephemeral connection record is deleted in a `finally` immediately after
 * `resolveSources` reads it, on every path including a thrown error, via
 * `cleanupOrThrow` — a failed delete FAILS the run rather than logging and
 * continuing, so a case can never be reported as clean while a row was
 * actually left behind.
 *
 * Before any case runs, `verifyTenantInventory` confirms the tenant's real
 * indexed files still match what this fixture was built against — a
 * retrieval probe cannot stand in for this (it only shows the corpus CAN
 * answer some query, never what is actually indexed), so this calls
 * syslab-server's own `GET /api/v1/documents` directly.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildRealClient, cleanupOrThrow, runCase } from "./harness";
import { mediaKnownAnswerCases } from "./cases/media-known-answer.eval";
import {
  abstentionGrade,
  citationPrecisionGrade,
  claimEvidenceRetrieved,
  documentRecall,
  factualCorrectnessGrade,
} from "./grade-known-answer";
import { searchedLibrary } from "./grade-media";
import { stores } from "@/lib/providers";
import { resolveSources } from "@/lib/services/sources";
import type { AgentLibrary } from "@/lib/agent";
import type { MediaConnectionDoc } from "@/lib/services/connections";
import type { EvalCase, LiveLibrary, SearchRecord } from "./types";

const REPEATS = 5;
const PARA_01_RELEVANT = ["contract_07.pdf", "contract_08.pdf", "contract_33.pdf", "contract_49.pdf", "contract_52.pdf"];

/**
 * The exact indexed set this fixture was built and verified against
 * (confirmed by a real `GET /api/v1/documents` call, not assumed from
 * golden.json's own — different, 52-file — inventory). Every case's
 * `relevant[]` list was cross-checked against this set before being used.
 */
const EXPECTED_INVENTORY = [
  "contract_01.pdf", "contract_02.pdf", "contract_03.pdf", "contract_04.pdf", "contract_05.pdf",
  "contract_07.pdf", "contract_08.pdf", "contract_33.pdf", "contract_49.pdf", "contract_52.pdf",
].sort();

/**
 * Confirms the tenant's real indexed files still match `EXPECTED_INVENTORY`
 * before any case runs — a stale or drifted corpus would make every other
 * result meaningless, silently. Calls syslab-server's own document listing
 * directly; not a retrieval probe, which only shows the corpus CAN answer
 * some query, never what is actually indexed.
 */
async function verifyTenantInventory(): Promise<void> {
  const baseUrl = process.env.RETRIEVAL_BASE_URL;
  const token = process.env.RETRIEVAL_TOKEN;
  const tenant = process.env.RETRIEVAL_TEST_TENANT;
  if (!baseUrl || !token || !tenant) throw new Error("RETRIEVAL_BASE_URL/RETRIEVAL_TOKEN/RETRIEVAL_TEST_TENANT must all be set.");

  const res = await fetch(`${baseUrl}/documents`, { headers: { Authorization: `Bearer ${token}`, "X-Syslab-Tenant": tenant } });
  if (!res.ok) throw new Error(`GET /documents failed: ${res.status} ${await res.text().catch(() => "")}`);
  const body = (await res.json()) as { documents: { name: string }[] };
  const actual = body.documents.map((d) => d.name).sort();

  const missing = EXPECTED_INVENTORY.filter((f) => !actual.includes(f));
  const extra = actual.filter((f) => !EXPECTED_INVENTORY.includes(f));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `Tenant inventory has drifted from what this fixture was built against — refusing to run. ` +
        `Expected exactly [${EXPECTED_INVENTORY.join(", ")}] (${EXPECTED_INVENTORY.length} files); ` +
        `got [${actual.join(", ")}] (${actual.length} files). ` +
        `Missing: [${missing.join(", ") || "none"}]. Unexpected: [${extra.join(", ") || "none"}]. ` +
        `Every case's relevant[] list must be re-checked against the real inventory before this can run again.`
    );
  }
  console.log(`Tenant inventory confirmed: exactly the expected ${EXPECTED_INVENTORY.length} files.`);
}

/** The human-verified fact and exact supporting quote for the MFN case — read directly from contract_49.pdf; see the phase report. */
const MFN_FACT = {
  expectedFact:
    "Section 3.6 (Most Favored Nation): Zanotti agrees Aura shall be allowed the full benefit of any and all lower prices and/or more favorable terms Zanotti gives any third party for a substantially similar product — Aura IS automatically entitled.",
  supportingPassage:
    'During the term of this Agreement, Zanotti agrees that Aura shall be allowed the full benefit of any and all lower prices and/or any more favorable terms and/or conditions ("MFN" Terms) contained in any other agreement entered into by Zanotti for the sale of any product substantially similar to the Product in the same or lesser quantities described in this Agreement to third parties.',
};

type Passage = { source: string; text: string };

type PerRunRecord = {
  run_index: number;
  final_answer: string;
  retrieved_files: string[];
  /** From THIS run's own search call(s) — never a separate probe. */
  retrieved_passages: Passage[];
  dimensions: Record<string, { pass: boolean; heuristic: true; reason: string; detail?: unknown }>;
  expected_fact: string | null;
  supporting_passage: string | null;
  reviewed_verdict: "supported" | "unsupported" | "partially_supported" | "not_reviewed";
  reviewed_by: string | null;
  review_notes: string | null;
};

/**
 * Same construction as run.ts's own liveLibrary, plus real passage capture
 * into `passageSink` and the same guaranteed-cleanup `finally`.
 */
function liveLibraryCapturingPassages(passageSink: Passage[]) {
  return async function liveLibrary(spec: LiveLibrary, log: SearchRecord[]): Promise<AgentLibrary> {
    const tenantId = `ten_eval_known_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    const doc: MediaConnectionDoc = {
      id: "eval_media_1", object: "connection", kind: "media", engine: "media",
      name: spec.name, description: spec.description, status: "unknown", status_checked_at: null, status_detail: null,
      media: { alias_id: process.env.RETRIEVAL_TEST_TENANT!, library_ref: null, server_ref: "default" },
      created_at: now, updated_at: now,
    };
    await stores().documents.put("connections", tenantId, doc);
    try {
      const { libraries } = await resolveSources(
        { tenantId, userId: "usr_eval" },
        { env: { MEDIA_CONNECTIONS_ENABLED: "true", RETRIEVAL_BASE_URL: process.env.RETRIEVAL_BASE_URL, RETRIEVAL_TOKEN: process.env.RETRIEVAL_TOKEN } }
      );
      const library = libraries[0];
      if (!library) throw new Error("The live library did not resolve.");
      return {
        ...library,
        search: async (query: string) => {
          const result = await library.search(query);
          for (const p of result.passages) passageSink.push({ source: p.source, text: p.text });
          log.push({ library: library.name, query, returned: result.passages.map((p) => p.source) });
          return result;
        },
      };
    } finally {
      await cleanupOrThrow(() => stores().documents.delete("connections", tenantId, doc.id), tenantId);
    }
  };
}

function dimensionsFor(kase: EvalCase, outcome: Parameters<typeof searchedLibrary>[0], passages: Passage[]) {
  const toolChoice = searchedLibrary(outcome, "Contracts");
  const dimensions: PerRunRecord["dimensions"] = {
    tool_choice: { pass: toolChoice.pass, heuristic: true, reason: toolChoice.reason },
  };
  let expectedFact: string | null = null;
  let supportingPassage: string | null = null;

  if (kase.id === "known-para-01-sweeter-deal") {
    const recall = documentRecall(outcome, PARA_01_RELEVANT);
    const precisionGrade = citationPrecisionGrade(outcome, PARA_01_RELEVANT);
    dimensions.retrieval_recall = {
      pass: recall.recalled.length > 0, heuristic: true,
      reason: `${recall.recalled.length}/${recall.relevant.length} known-relevant documents recalled`,
      detail: recall,
    };
    dimensions.citation_precision = { pass: precisionGrade.pass, heuristic: true, reason: precisionGrade.reason };
  } else if (kase.id === "known-contract-49-mfn-fact") {
    expectedFact = MFN_FACT.expectedFact;
    supportingPassage = MFN_FACT.supportingPassage;

    // Document-level: did the run reach contract_49.pdf at all. Kept
    // separate from the passage-level check below on purpose — this alone
    // is exactly the check that misleadingly passed every one of the first
    // five real runs, because the file was always retrieved even on the
    // three runs where the one passage that actually states the MFN clause
    // never was.
    const recall = documentRecall(outcome, ["contract_49.pdf"]);
    dimensions.retrieval_recall = {
      pass: recall.recalled.length > 0, heuristic: true,
      reason: `document-level only: ${recall.recalled.length}/1 (contract_49.pdf) — does not mean the MFN passage itself was retrieved, see supporting_passage_retrieved`,
      detail: recall,
    };

    // Passage-level: did a retrieved passage actually contain the recorded
    // Section 3.6 text, from THIS run's own search call — not a separate
    // probe with different query wording, which cannot speak for what this
    // run saw.
    const evidenceGrade = claimEvidenceRetrieved(passages, supportingPassage);
    dimensions.supporting_passage_retrieved = { pass: evidenceGrade.pass, heuristic: true, reason: evidenceGrade.reason };

    const factGrade = factualCorrectnessGrade(
      outcome,
      /\b(yes|automatically)\b[\s\S]{0,200}\b(most[\s-]favored[\s-]nation|mfn|lower price|better (?:price|terms)|favorable terms)\b|\b(most[\s-]favored[\s-]nation|mfn)\b[\s\S]{0,200}\b(yes|automatically|entitled|benefit)\b/i,
      expectedFact
    );
    dimensions.factual_correctness = { pass: factGrade.pass, heuristic: true, reason: factGrade.reason };
  } else if (kase.id === "known-contract-49-escrow-abstention") {
    const abstain = abstentionGrade(outcome);
    dimensions.abstention = { pass: abstain.pass, heuristic: true, reason: abstain.reason };
  }

  return { dimensions, expectedFact, supportingPassage };
}

async function main() {
  await verifyTenantInventory();

  const { client } = buildRealClient();
  const allRuns: Record<string, PerRunRecord[]> = {};

  for (const kase of mediaKnownAnswerCases) {
    const runs: PerRunRecord[] = [];
    for (let i = 0; i < REPEATS; i++) {
      const passages: Passage[] = [];
      const outcome = await runCase(kase, client, { liveLibrary: liveLibraryCapturingPassages(passages) });
      const { dimensions, expectedFact, supportingPassage } = dimensionsFor(kase, outcome, passages);

      runs.push({
        run_index: i,
        final_answer: outcome.finalText,
        retrieved_files: [...new Set(passages.map((p) => p.source))],
        retrieved_passages: passages,
        dimensions,
        expected_fact: expectedFact,
        supporting_passage: supportingPassage,
        reviewed_verdict: "not_reviewed",
        reviewed_by: null,
        review_notes: null,
      });
      console.log(kase.id, i, Object.values(dimensions).every((d) => d.pass) ? "PASS (heuristic)" : "fail (heuristic)");
    }
    allRuns[kase.id] = runs;
  }

  const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "results", `known-answer-${Date.now()}.json`);
  writeFileSync(
    outPath,
    JSON.stringify({ generated_at: new Date().toISOString(), model: "syslab-default", tenant: process.env.RETRIEVAL_TEST_TENANT, runs: allRuns }, null, 2)
  );
  console.log("\nWritten:", outPath);
  console.log("reviewed_verdict is \"not_reviewed\" for every run in this file until a second pass reads the real text.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
