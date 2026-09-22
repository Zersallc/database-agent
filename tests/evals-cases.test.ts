/**
 * Every media eval case can tell a right run from a wrong one.
 *
 * Spending real-model budget on a case whose grader passes anything, or fails
 * everything, teaches nothing and can mislead. So for each case there is a
 * scripted "ideal" run that must pass and a scripted "wrong" run that must fail,
 * and the wrong one must fail for the reason the case is about (its kind), not by
 * accident. The model is scripted, so this is about the cases and their
 * fixtures, never about how a real model behaves.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { failuresOf } from "@/evals/grade";
import { runCase } from "@/evals/harness";
import { LEGACY_CASES, LIVE_CASES, MEDIA_CASES } from "@/evals/cases";
import type { EvalCase, FailureCategory } from "@/evals/types";
import type { ModelClient, ModelRequest, ModelStreamEvent, ToolCall } from "@/lib/agent/providers/types";

type Turn = { text: string; toolCalls?: ToolCall[] };

/** Plays the turns in order, repeating the last, and answers judge calls (no tools) from the same script. */
function scripted(turns: Turn[]): ModelClient {
  let index = 0;
  return {
    kind: "openai_compatible",
    model: "test-model",
    async *stream(_request: ModelRequest): AsyncIterable<ModelStreamEvent> {
      const turn = turns[Math.min(index, turns.length - 1)];
      index += 1;
      yield { type: "text_delta", text: turn.text };
      yield {
        type: "turn",
        turn: {
          text: turn.text,
          toolCalls: turn.toolCalls ?? [],
          stopReason: turn.toolCalls?.length ? "tool_use" : "end_turn",
          refusalDetail: null,
          usage: { input_tokens: 1, output_tokens: 1 },
          model: "test-model",
        },
      };
    },
    async probe() {
      return { ok: true, latency_ms: 1, detail: null, model_available: true };
    },
  };
}

let n = 0;
const sql = (statement: string): ToolCall => ({ id: `q${++n}`, name: "run_sql", input: { sql: statement, purpose: "answer the question" } });
const search = (query: string, library?: string): ToolCall => ({
  id: `s${++n}`,
  name: "search_documents",
  input: library ? { library, query } : { query },
});
const JUDGE_PASS: Turn = { text: '{"pass": true, "reason": "no figure asserted"}' };
const JUDGE_FAIL: Turn = { text: '{"pass": false, "reason": "a figure was asserted"}' };

type Script = { ideal: Turn[]; wrong: Turn[]; wrongFails: FailureCategory };

const ASK_BOTH = "Do you mean the rate set in billing for Acme, or the rate in the Acme contract?";

const SCRIPTS: Record<string, Script> = {
  // PostgreSQL-only
  "media-pg-contracts-register": {
    ideal: [{ text: "", toolCalls: [sql("SELECT count(*) FROM supplier_contracts")] }, { text: "You have 14 supplier contracts on record." }],
    wrong: [{ text: "", toolCalls: [search("supplier contracts on record")] }, { text: "I found several contracts.\n\nSources:\ncontract_03.pdf" }],
    wrongFails: "routing",
  },
  "media-pg-expiring-contracts": {
    ideal: [{ text: "", toolCalls: [sql("SELECT count(*) FROM supplier_contracts WHERE expires_on < '2027-01-01'")] }, { text: "5 contracts expire before the end of 2026." }],
    wrong: [{ text: "", toolCalls: [search("contracts expiring 2026")] }, { text: "I found some contracts.\n\nSources:\ncontract_03.pdf" }],
    wrongFails: "routing",
  },

  // Media-only
  "media-only-notice-period": {
    ideal: [
      { text: "", toolCalls: [search("Northwind termination notice")] },
      { text: "Either party may terminate on thirty days' written notice.\n\nSources:\ncontract_03.pdf" },
    ],
    wrong: [{ text: "", toolCalls: [sql("SELECT count(*) FROM supplier_contracts")] }, { text: "There are 14 contracts." }],
    wrongFails: "routing",
  },
  "media-only-no-database": {
    ideal: [{ text: "", toolCalls: [search("Globex payment invoice days")] }, { text: "They have forty-five days to pay.\n\nSources:\ncontract_11.pdf" }],
    wrong: [{ text: "I do not know the payment terms." }],
    wrongFails: "routing",
  },
  "media-only-paraphrase": {
    ideal: [
      { text: "", toolCalls: [search("Globex most favored customer better price")] },
      { text: "Yes: Globex is entitled to most-favored-customer pricing and receives that price too.\n\nSources:\ncontract_11.pdf" },
    ],
    wrong: [{ text: "", toolCalls: [sql("SELECT count(*) FROM customers")] }, { text: "I cannot tell from the customers table." }],
    wrongFails: "routing",
  },

  // Cross-source
  "media-cross-late-orders-and-penalty": {
    ideal: [
      { text: "", toolCalls: [sql("SELECT count(*) FROM orders WHERE delivered_at > promised_at"), search("Acme late delivery credit")] },
      { text: "12 orders were delivered late. The Acme contract gives a credit of 2% per week.\n\nSources:\nPostgreSQL — Sales\ncontract_07.pdf" },
    ],
    wrong: [{ text: "", toolCalls: [sql("SELECT count(*) FROM orders WHERE delivered_at > promised_at")] }, { text: "12 orders were delivered late." }],
    wrongFails: "routing",
  },
  "media-cross-register-and-terms": {
    ideal: [
      { text: "", toolCalls: [sql("SELECT count(*) FROM supplier_contracts"), search("terminate 30 days notice supplier")] },
      { text: "14 supplier contracts are on record. Northwind's can be ended on 30 days' notice.\n\nSources:\nPostgreSQL — Sales\ncontract_03.pdf" },
    ],
    wrong: [{ text: "", toolCalls: [search("terminate 30 days notice supplier")] }, { text: "Northwind's can be ended on 30 days' notice.\n\nSources:\ncontract_03.pdf" }],
    wrongFails: "routing",
  },

  // Multi-library
  "media-multi-leave-policy": {
    ideal: [
      { text: "", toolCalls: [search("annual leave days", "HR Policies")] },
      { text: "Full-time employees get twenty days of paid annual leave.\n\nSources:\nleave_policy.pdf (HR Policies)" },
    ],
    wrong: [
      { text: "", toolCalls: [search("annual leave days", "HR Policies"), search("annual leave days", "Contracts")] },
      { text: "Full-time employees get twenty days of paid annual leave.\n\nSources:\nleave_policy.pdf (HR Policies)" },
    ],
    wrongFails: "routing",
  },
  "media-multi-audit-findings": {
    ideal: [
      { text: "", toolCalls: [search("2025 internal audit findings open", "Compliance")] },
      { text: "The 2025 audit raised three findings; one is still open.\n\nSources:\naudit_2025.pdf (Compliance)" },
    ],
    wrong: [{ text: "", toolCalls: [search("audit findings", "HR Policies")] }, { text: "I could not find the audit." }],
    wrongFails: "routing",
  },
  "media-multi-two-relevant": {
    ideal: [
      { text: "", toolCalls: [search("confidential information protected years", "Contracts"), search("personal data retained years", "Compliance")] },
      {
        text:
          "Confidential information must be protected for five years, and personal data is retained for seven years.\n\n" +
          "Sources:\nnda_2024.pdf (Contracts)\ngdpr_register.pdf (Compliance)",
      },
    ],
    wrong: [
      { text: "", toolCalls: [search("confidential information protected years", "Contracts")] },
      { text: "Confidential information must be protected for five years.\n\nSources:\nnda_2024.pdf (Contracts)" },
    ],
    wrongFails: "routing",
  },

  // Ambiguous, clear and low-risk
  "media-lowrisk-payment-terms": {
    ideal: [{ text: "", toolCalls: [search("Globex payment terms invoice")] }, { text: "Globex pays within forty-five days.\n\nSources:\ncontract_11.pdf" }],
    wrong: [{ text: "Should I look in the database or in the contracts?" }],
    wrongFails: "routing",
  },
  "media-lowrisk-expiry-date": {
    ideal: [{ text: "", toolCalls: [sql("SELECT expires_on FROM supplier_contracts WHERE supplier = 'Acme Industrial'")] }, { text: "It expires on 14 June 2026." }],
    wrong: [{ text: "Do you want the expiry date from the register or from the contract document?" }],
    wrongFails: "routing",
  },

  // Ambiguous, insufficient
  "media-insufficient-penalty-rate": {
    ideal: [
      { text: "", toolCalls: [search("Acme late delivery penalty credit")] },
      { text: "The contract gives a credit of 2% per week, capped at 10%.\n\nSources:\ncontract_07.pdf" },
    ],
    wrong: [{ text: "", toolCalls: [sql("SELECT late_fee_pct FROM customers")] }, { text: "The penalty rate is 7.5% per week." }],
    wrongFails: "answer",
  },
  "media-insufficient-uncovered-customer": {
    ideal: [
      { text: "", toolCalls: [search("Initech payment deadline invoice")] },
      { text: "The documents cover Globex, at forty-five days, but I found nothing for Initech.\n\nSources:\ncontract_11.pdf" },
    ],
    wrong: [
      { text: "", toolCalls: [search("Initech payment deadline invoice")] },
      { text: "Initech has thirty days to pay.\n\nSources:\ncontract_11.pdf" },
    ],
    wrongFails: "answer",
  },

  // Ambiguous, material
  "media-material-penalty-which": {
    ideal: [{ text: ASK_BOTH }],
    wrong: [{ text: "", toolCalls: [search("Acme late delivery penalty")] }, { text: "The contract says 2% per week.\n\nSources:\ncontract_07.pdf" }],
    wrongFails: "routing",
  },
  "media-material-invoice-rate": {
    ideal: [{ text: ASK_BOTH }],
    wrong: [{ text: "", toolCalls: [sql("SELECT late_fee_pct FROM customers")] }, { text: "Use 1.5%." }],
    wrongFails: "routing",
  },

  // Unauthorized
  "media-unauthorized-library-not-attached": {
    ideal: [{ text: "I do not have an HR policy available to me, so I cannot say." }, JUDGE_PASS],
    wrong: [{ text: "Our HR policy gives twenty days of annual leave." }, JUDGE_FAIL],
    wrongFails: "answer",
  },
  "media-unauthorized-named-library": {
    ideal: [{ text: "There is no library by that name available to me, so I cannot look that up." }, JUDGE_PASS],
    wrong: [{ text: "The CEO's salary is 500,000 dollars." }, JUDGE_FAIL],
    wrongFails: "answer",
  },

  // Efficiency
  "media-efficiency-revenue-by-region": {
    ideal: [{ text: "", toolCalls: [sql("SELECT region, sum(total) AS revenue FROM orders GROUP BY region")] }, { text: "EMEA led revenue this year." }],
    wrong: [{ text: "", toolCalls: [sql("SELECT sum(total) AS revenue FROM orders"), search("revenue by region", "Contracts")] }, { text: "Revenue was strong." }],
    wrongFails: "routing",
  },
  "media-efficiency-order-count": {
    ideal: [{ text: "", toolCalls: [sql("SELECT count(*) FROM orders")] }, { text: "We have received 1,240 orders." }],
    wrong: [{ text: "", toolCalls: [sql("SELECT count(*) FROM orders"), search("orders received", "HR Policies")] }, { text: "We have received 1,240 orders." }],
    wrongFails: "routing",
  },
  "media-efficiency-top-customers": {
    ideal: [{ text: "", toolCalls: [sql("SELECT name, total_spend FROM customers ORDER BY total_spend DESC LIMIT 5")] }, { text: "Globex is the biggest customer." }],
    wrong: [{ text: "", toolCalls: [search("biggest customers", "Contracts")] }, { text: "Globex has a customer agreement.\n\nSources:\ncontract_11.pdf" }],
    wrongFails: "routing",
  },
  "media-efficiency-empty-result": {
    ideal: [{ text: "", toolCalls: [sql("SELECT count(*) FROM orders WHERE ordered_at >= '2019-03-01' AND ordered_at < '2019-04-01'")] }, { text: "There were no orders in March 2019." }],
    wrong: [
      { text: "", toolCalls: [sql("SELECT count(*) FROM orders WHERE ordered_at >= '2019-03-01' AND ordered_at < '2019-04-01'"), search("orders March 2019", "Contracts")] },
      { text: "No orders were found." },
    ],
    wrongFails: "routing",
  },

  // Vague
  "media-vague-show-contracts": {
    ideal: [
      { text: "", toolCalls: [search("contracts")] },
      { text: "Here are three contracts.\n\nSources:\ncontract_03.pdf\ncontract_07.pdf\ncontract_11.pdf" },
    ],
    wrong: [{ text: "What are you looking for in the contracts?" }],
    wrongFails: "routing",
  },
  "media-vague-library-only": {
    ideal: [
      { text: "", toolCalls: [search("supplier agreements")] },
      { text: "Here are the supplier agreements I found.\n\nSources:\ncontract_03.pdf\ncontract_07.pdf\ncontract_11.pdf" },
    ],
    wrong: [{ text: "Which supplier agreements would you like to see?" }],
    wrongFails: "routing",
  },
};

describe("the media eval suite is well formed", () => {
  const all = [...LEGACY_CASES, ...MEDIA_CASES, ...LIVE_CASES];

  test("case ids are unique", () => {
    assert.equal(new Set(all.map((c) => c.id)).size, all.length);
  });

  test("the original eleven are untouched: no family, no library, no source expectation", () => {
    assert.equal(LEGACY_CASES.length, 11);
    for (const kase of LEGACY_CASES) {
      assert.equal(kase.family, undefined, kase.id);
      assert.equal(kase.libraries, undefined, kase.id);
      assert.equal(kase.sources, undefined, kase.id);
    }
  });

  test("every media case is in a named family and says which sources it needs", () => {
    const families = new Set(MEDIA_CASES.map((c) => c.family));
    for (const family of [
      "postgres-only", "media-only", "cross-source", "multi-library", "ambiguous-low-risk", "ambiguous-insufficient",
      "ambiguous-material", "unauthorized", "efficiency", "vague",
    ]) {
      assert.ok(families.has(family), `no case in the ${family} family`);
    }
    for (const kase of MEDIA_CASES) {
      assert.ok(kase.family, kase.id);
      assert.ok(kase.sources, `${kase.id} does not declare its sources`);
    }
  });

  test("every media case has an ideal and a wrong script, and nothing else does", () => {
    assert.deepEqual(Object.keys(SCRIPTS).sort(), MEDIA_CASES.map((c) => c.id).sort());
  });

  test("the live cases need a real library and declare no fixture one", () => {
    for (const kase of LIVE_CASES) {
      assert.ok(kase.live, kase.id);
      assert.equal(kase.libraries, undefined, kase.id);
    }
  });
});

describe("each media case tells a right run from a wrong one", () => {
  for (const kase of MEDIA_CASES) {
    const script = SCRIPTS[kase.id];
    if (!script) continue;

    test(`${kase.id}`, async () => {
      const ideal = scripted(script.ideal);
      const idealGrade = await kase.grade(await runCase(kase, ideal), ideal);
      assert.equal(idealGrade.pass, true, `the ideal run should pass: ${idealGrade.reason}`);

      const wrong = scripted(script.wrong);
      const wrongGrade = await kase.grade(await runCase(kase, wrong), wrong);
      assert.equal(wrongGrade.pass, false, "the wrong run should fail");
      const kinds = failuresOf(wrongGrade).map((f) => f.category);
      assert.ok(kinds.includes(script.wrongFails), `it should fail as ${script.wrongFails}; failed as ${kinds.join(", ")}: ${wrongGrade.reason}`);
    });
  }
});

describe("the fixtures give the ideal runs something real to find", () => {
  const byId = (id: string): EvalCase => MEDIA_CASES.find((c) => c.id === id)!;

  test("a paraphrase reaches the clause through the fixture retriever", async () => {
    const kase = byId("media-only-paraphrase");
    const outcome = await runCase(kase, scripted(SCRIPTS["media-only-paraphrase"].ideal));
    assert.ok(outcome.retrieved.some((r) => r.file === "contract_11.pdf"));
  });

  test("a vague request retrieves documents to list", async () => {
    const outcome = await runCase(byId("media-vague-show-contracts"), scripted(SCRIPTS["media-vague-show-contracts"].ideal));
    assert.ok(outcome.retrieved.length >= 3, `retrieved ${outcome.retrieved.map((r) => r.file).join(", ")}`);
  });

  test("with several libraries the Sources lines carry the library, and the loop and the grader agree on it", async () => {
    const kase = byId("media-multi-leave-policy");
    const outcome = await runCase(kase, scripted(SCRIPTS["media-multi-leave-policy"].ideal));
    assert.equal(outcome.showLibrary, true);
    assert.match(outcome.finalText, /leave_policy\.pdf \(HR Policies\)/);
  });
});
