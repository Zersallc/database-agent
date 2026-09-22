/**
 * The media-connection graders, tried on runs built by hand.
 *
 * A grader that cannot tell a right run from a wrong one makes every number the
 * evals report meaningless, so each is checked in both directions here. The
 * provenance graders are also fed what the real loop produces (`checkSources`),
 * to show that the separate implementation used for grading agrees with it where
 * it should and disagrees where it should.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  actedBeforeAnswering,
  askedBeforeActing,
  blockLines,
  didNotAskInstead,
  firstToolWas,
  missingSources,
  neverRanSql,
  neverSearched,
  plain,
  provenanceGenerated,
  provenanceHolds,
  provenanceSanitized,
  searchedLibrary,
  searchedOnly,
  sourcesRenderCorrectly,
  sourcesUsed,
  truth,
  unnecessarySources,
  usedSql,
} from "@/evals/grade-media";
import { allOf, anyOf, failuresOf } from "@/evals/grade";
import type { EvalOutcome, ToolCallRecord } from "@/evals/types";
import { ProvenanceLedger, checkSources } from "@/lib/agent/provenance";

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

const sql = (database = "Sales", ok = true): ToolCallRecord => ({ name: "run_sql", ok, library: null, database });
const search = (library = "Contracts", ok = true): ToolCallRecord => ({ name: "search_documents", ok, library, database: null });

/** What the loop delivers for a raw answer, given what the run really did. */
function delivered(raw: string, run: { retrieved?: { library: string; file: string }[]; queried?: { name: string; engine: string }[]; showLibrary?: boolean }) {
  const ledger = new ProvenanceLedger();
  for (const { name, engine } of run.queried ?? []) ledger.recordQuery(engine, name);
  for (const { library, file } of run.retrieved ?? []) ledger.recordDocuments(library, [file]);
  return checkSources(raw, ledger, { showLibrary: run.showLibrary ?? false }).text;
}

describe("which sources a run used", () => {
  test("databases it tried and libraries a search was accepted for, and not a refused search", () => {
    const run = outcome({ toolCalls: [sql("Sales"), sql("Sales"), search("Contracts"), search("Board Minutes", false)] });
    assert.deepEqual(sourcesUsed(run).sort(), ["db:Sales", "lib:Contracts"]);
  });

  test("a source the question did not need is unnecessary, and one it needed and did not get is missing", () => {
    const run = outcome({ toolCalls: [sql("Sales"), search("HR Policies")] });
    assert.deepEqual(unnecessarySources(run, { required: ["lib:Contracts"], allowed: ["db:Sales"] }), ["lib:HR Policies"]);
    assert.deepEqual(missingSources(run, { required: ["lib:Contracts", "db:Sales"] }), ["lib:Contracts"]);
  });

  test("an allowed source is not unnecessary", () => {
    assert.deepEqual(unnecessarySources(outcome({ toolCalls: [sql()] }), { required: ["lib:Contracts"], allowed: ["db:Sales"] }), []);
  });
});

describe("routing graders", () => {
  test("usedSql and neverRanSql", () => {
    assert.equal(usedSql(outcome({ toolCalls: [sql()] })).pass, true);
    assert.equal(usedSql(outcome({ toolCalls: [search()] })).pass, false);
    assert.equal(neverRanSql(outcome({ toolCalls: [search()] })).pass, true);
    assert.equal(neverRanSql(outcome({ toolCalls: [sql()] })).category, "routing");
  });

  test("neverSearched", () => {
    assert.equal(neverSearched(outcome({ toolCalls: [sql()] })).pass, true);
    const result = neverSearched(outcome({ toolCalls: [sql(), search()] }));
    assert.equal(result.pass, false);
    assert.equal(result.category, "routing");
  });

  test("searchedLibrary needs an accepted search of that library", () => {
    assert.equal(searchedLibrary(outcome({ toolCalls: [search("Contracts")] }), "Contracts").pass, true);
    assert.equal(searchedLibrary(outcome({ toolCalls: [search("Contracts", false)] }), "Contracts").pass, false);
    assert.equal(searchedLibrary(outcome({ toolCalls: [search("HR Policies")] }), "Contracts").pass, false);
  });

  test("searchedOnly fails on a stray library and ignores a refused one", () => {
    assert.equal(searchedOnly(outcome({ toolCalls: [search("HR Policies")] }), ["HR Policies"]).pass, true);
    assert.equal(searchedOnly(outcome({ toolCalls: [search("HR Policies"), search("Contracts")] }), ["HR Policies"]).pass, false);
    assert.equal(searchedOnly(outcome({ toolCalls: [search("HR Policies"), search("Board Minutes", false)] }), ["HR Policies"]).pass, true);
  });

  test("firstToolWas looks at the first call only", () => {
    assert.equal(firstToolWas(outcome({ toolCalls: [search("Contracts"), sql()] }), "search_documents", "Contracts").pass, true);
    assert.equal(firstToolWas(outcome({ toolCalls: [sql(), search("Contracts")] }), "search_documents").pass, false);
    assert.equal(firstToolWas(outcome({ toolCalls: [search("HR Policies")] }), "search_documents", "Contracts").pass, false);
    assert.equal(firstToolWas(outcome(), "run_sql").pass, false);
  });

  test("askedBeforeActing: a question naming both options and no tool call", () => {
    const both = [/billing|database/i, /contract/i];
    assert.equal(askedBeforeActing(outcome({ finalText: "Do you mean the rate set in billing, or the one in the contract?" }), both).pass, true);
    assert.equal(askedBeforeActing(outcome({ finalText: "Do you mean the rate in billing?" }), both).pass, false, "names only one option");
    assert.equal(askedBeforeActing(outcome({ toolCalls: [sql()], finalText: "Which did you mean, billing or the contract?" }), both).pass, false, "acted first");
    assert.equal(askedBeforeActing(outcome({ finalText: "The rate is two percent." }), both).pass, false, "answered without asking");
  });

  test("didNotAskInstead and actedBeforeAnswering", () => {
    assert.equal(didNotAskInstead(outcome({ finalText: "What are you looking for?" })).pass, false);
    assert.equal(didNotAskInstead(outcome({ toolCalls: [search()], finalText: "Found it. Want more?" })).pass, true);
    assert.equal(actedBeforeAnswering(outcome({ toolCalls: [search()] })).pass, true);
    assert.equal(actedBeforeAnswering(outcome({ finalText: "The documents do not cover this." })).pass, false);
  });

  test("allOf and anyOf keep the kind of each failure", () => {
    const failing = neverSearched(outcome({ toolCalls: [search()] }));
    const combined = allOf(failing, { pass: false, reason: "wrong number" }, { pass: true, reason: "fine" });
    assert.deepEqual(failuresOf(combined).map((f) => f.category), ["routing", "answer"]);
    const either = anyOf(failing, { pass: false, reason: "x", category: "retrieval" });
    assert.deepEqual(failuresOf(either).map((f) => f.category), ["routing", "retrieval"]);
    assert.deepEqual(failuresOf(allOf({ pass: true, reason: "ok" })), []);
  });
});

describe("what the run's own results back", () => {
  test("one library: the file alone; several: the file and its library; a database: its kind and name", () => {
    const one = truth(outcome({ retrieved: [{ library: "Contracts", file: "contract_03.pdf" }], queried: [{ name: "Sales", engine: "postgres" }] }));
    assert.deepEqual(one.map((t) => t.line), ["PostgreSQL — Sales", "contract_03.pdf"]);
    const many = truth(outcome({ showLibrary: true, retrieved: [{ library: "Contracts", file: "contract_03.pdf" }] }));
    assert.deepEqual(many.map((t) => t.line), ["contract_03.pdf (Contracts)"]);
  });

  test("a line is read as a reader would", () => {
    assert.equal(plain("- **contract_03.pdf**  "), "contract_03.pdf");
    assert.equal(plain("`contract_03.pdf`"), "contract_03.pdf");
    assert.equal(plain("PostgreSQL - Sales"), "PostgreSQL — Sales");
    assert.equal(plain("contract\\_03.pdf"), "contract_03.pdf");
  });

  test("the block is the lines under the last Sources heading", () => {
    assert.deepEqual(blockLines("Answer.\n\nSources:\na.pdf\nb.pdf\n\nTail."), ["a.pdf", "b.pdf"]);
    assert.equal(blockLines("Answer with no block."), null);
  });
});

describe("provenanceGenerated: the model's own block", () => {
  const run = (rawAnswer: string, extra: Partial<EvalOutcome> = {}) =>
    outcome({ rawAnswer, retrieved: [{ library: "Contracts", file: "contract_03.pdf" }], ...extra });

  test("nothing retrieved means no block was owed", () => {
    assert.equal(provenanceGenerated(outcome({ rawAnswer: "No documents." })).pass, true);
  });

  test("documents retrieved and no block is a generation failure", () => {
    const result = provenanceGenerated(run("The notice is thirty days."));
    assert.equal(result.pass, false);
    assert.equal(result.category, "provenance_generation");
  });

  test("a block that cites something the run did not retrieve is a generation failure", () => {
    const result = provenanceGenerated(run("Answer.\n\nSources:\ncontract_03.pdf\nmade_up.pdf"));
    assert.equal(result.pass, false);
    assert.match(result.reason, /made_up\.pdf/);
  });

  test("a complete honest block passes, in any of the ways a model writes a list", () => {
    for (const block of ["contract_03.pdf", "- contract_03.pdf", "* `contract_03.pdf`", "1. **contract_03.pdf**"]) {
      assert.equal(provenanceGenerated(run(`Answer.\n\nSources:\n${block}`), { cites: ["contract_03.pdf"] }).pass, true, block);
    }
  });

  test("a block that leaves out a file the answer needs to name fails", () => {
    const two = run("Answer.\n\nSources:\nnda_2024.pdf", { retrieved: [{ library: "Contracts", file: "contract_03.pdf" }, { library: "Contracts", file: "nda_2024.pdf" }] });
    const result = provenanceGenerated(two, { cites: ["contract_03.pdf"] });
    assert.equal(result.pass, false);
    assert.match(result.reason, /contract_03\.pdf/);
  });

  test("a file the run never retrieved is not owed a citation: that is a routing failure, not a badly written block", () => {
    const one = run("Answer.\n\nSources:\ncontract_03.pdf");
    assert.equal(provenanceGenerated(one, { cites: ["contract_03.pdf", "nda_2024.pdf"] }).pass, true);
    const noDatabaseQuery = run("Answer.\n\nSources:\ncontract_03.pdf");
    assert.equal(provenanceGenerated(noDatabaseQuery, { citesDatabases: ["Sales"] }).pass, true);
  });

  test("database lines are checked against queries that really ran", () => {
    const both = run("Answer.\n\nSources:\nPostgreSQL — Sales\ncontract_03.pdf", { queried: [{ name: "Sales", engine: "postgres" }] });
    assert.equal(provenanceGenerated(both, { cites: ["contract_03.pdf"], citesDatabases: ["Sales"] }).pass, true);
    const invented = run("Answer.\n\nSources:\nPostgreSQL — Payroll\ncontract_03.pdf", { queried: [{ name: "Sales", engine: "postgres" }] });
    assert.equal(provenanceGenerated(invented).pass, false);
  });

  test("with several libraries the library must be right", () => {
    const many = run("Answer.\n\nSources:\ncontract_03.pdf (Policies)", { showLibrary: true, libraries: ["Contracts", "Policies"] });
    assert.equal(provenanceGenerated(many).pass, false);
    const right = run("Answer.\n\nSources:\ncontract_03.pdf (Contracts)", { showLibrary: true, libraries: ["Contracts", "Policies"] });
    assert.equal(provenanceGenerated(right).pass, true);
  });
});

describe("provenanceSanitized: the application's check, graded from outside", () => {
  const retrieved = [{ library: "Contracts", file: "contract_03.pdf" }];

  test("the real loop's output passes: fabricated lines removed, real ones kept", () => {
    const raw = "Answer.\n\nSources:\ncontract_03.pdf\nmade_up.pdf";
    const run = outcome({ retrieved, rawAnswer: raw, finalText: delivered(raw, { retrieved }) });
    assert.equal(provenanceSanitized(run).pass, true);
    assert.equal(provenanceHolds(run, { cites: ["contract_03.pdf"] }).pass, false, "the model's own block cited a made-up file");
  });

  test("a fabricated line that reaches the reader is a sanitization failure", () => {
    const run = outcome({ retrieved, rawAnswer: "Answer.\n\nSources:\ncontract_03.pdf\nmade_up.pdf", finalText: "Answer.\n\nSources:  \ncontract_03.pdf  \nmade_up.pdf" });
    const result = provenanceSanitized(run);
    assert.equal(result.pass, false);
    assert.equal(result.category, "provenance_sanitization");
    assert.match(result.reason, /made_up\.pdf/);
  });

  test("removing a line the run does back is a sanitization failure too", () => {
    const run = outcome({ retrieved, rawAnswer: "Answer.\n\nSources:\ncontract_03.pdf", finalText: "Answer." });
    const result = provenanceSanitized(run);
    assert.equal(result.pass, false);
    assert.match(result.reason, /removed a line the run backs/);
  });

  test("a database line the run really ran is kept, one it did not is not", () => {
    const queried = [{ name: "Sales", engine: "postgres" }];
    const raw = "Answer.\n\nSources:\nPostgreSQL — Sales\nPostgreSQL — Payroll";
    const run = outcome({ queried, rawAnswer: raw, finalText: delivered(raw, { queried }) });
    assert.equal(provenanceSanitized(run).pass, true);
  });
});

describe("sourcesRenderCorrectly: the delivered block, as a reader sees it", () => {
  const retrieved = [{ library: "Contracts", file: "contract_03.pdf" }, { library: "Contracts", file: "nda_2024.pdf" }];

  test("the block the loop writes draws one source per line", () => {
    const raw = "Answer.\n\nSources:\ncontract_03.pdf\nnda_2024.pdf";
    assert.equal(sourcesRenderCorrectly(outcome({ retrieved, rawAnswer: raw, finalText: delivered(raw, { retrieved }) })).pass, true);
  });

  test("lines that Markdown would join into one fail, and say so", () => {
    const run = outcome({ retrieved, finalText: "Answer.\n\nSources:\ncontract_03.pdf\nnda_2024.pdf" });
    const result = sourcesRenderCorrectly(run);
    assert.equal(result.pass, false);
    assert.equal(result.category, "rendering");
    assert.match(result.reason, /ran together/);
  });

  test("a name that Markdown would turn into a link fails", () => {
    const linky = [{ library: "Contracts", file: "https://evil.example/x.pdf" }];
    const run = outcome({ retrieved: linky, finalText: "Answer.\n\nSources:  \nhttps://evil.example/x.pdf" });
    assert.equal(sourcesRenderCorrectly(run).pass, false);
  });

  test("the loop protects that same name with a code span, and it passes", () => {
    const linky = [{ library: "Contracts", file: "https://evil.example/x.pdf" }];
    const raw = "Answer.\n\nSources:\nhttps://evil.example/x.pdf";
    const run = outcome({ retrieved: linky, rawAnswer: raw, finalText: delivered(raw, { retrieved: linky }) });
    assert.equal(sourcesRenderCorrectly(run).pass, true);
    assert.equal(provenanceSanitized(run).pass, true);
  });

  test("no block is nothing to render", () => {
    assert.equal(sourcesRenderCorrectly(outcome({ finalText: "Answer with no block." })).pass, true);
  });

  test("provenanceHolds reports each failed check under its own kind", () => {
    const run = outcome({
      retrieved,
      rawAnswer: "Answer.\n\nSources:\nmade_up.pdf",
      // The invented file survived the check, and the lines run together on screen.
      finalText: "Answer.\n\nSources:\nmade_up.pdf\nnda_2024.pdf",
    });
    const result = provenanceHolds(run);
    assert.equal(result.pass, false);
    assert.deepEqual([...new Set(failuresOf(result).map((f) => f.category))].sort(), ["provenance_generation", "provenance_sanitization", "rendering"].sort());
  });
});
