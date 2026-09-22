/**
 * The ledger and the Sources check.
 *
 * The property under test: a model may say where an answer came from, and the
 * application decides what is true. A line survives only if this run's own tool
 * results back it, and what reaches the reader is written by the application,
 * so nothing in the final block is the model's hand: not an invented file, not
 * a real file under the wrong library, not a claim tacked onto a real name.
 *
 * The functions are pure, so these tests need no model, no store and no network.
 * The same guarantees are exercised through the agent loop in
 * agent-provenance.test.ts and through the real renderer in
 * provenance-render.test.ts.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  ProvenanceLedger,
  asLiteralMarkdown,
  checkSources,
  databaseSourceLine,
  documentSourceLine,
  engineLabel,
  sourcesCorrection,
} from "@/lib/agent/provenance";

const ONE = { showLibrary: false };
const MANY = { showLibrary: true };

function ledgerWith(options: { documents?: Record<string, string[]>; databases?: [string, string][] } = {}) {
  const ledger = new ProvenanceLedger();
  for (const [engine, name] of options.databases ?? []) ledger.recordQuery(engine, name);
  for (const [library, files] of Object.entries(options.documents ?? {})) ledger.recordDocuments(library, files);
  return ledger;
}

/**
 * A block as the application writes it: a hard line break (two trailing spaces)
 * ends every line but the last. The two tests under "the agreed format" spell
 * the bytes out; the rest use this so they say what is kept, not how it is padded.
 */
const written = (...lines: string[]) =>
  ["Sources:", ...lines].map((line, index, all) => (index < all.length - 1 ? `${line}  ` : line)).join("\n");

describe("the ledger records only what really came back", () => {
  test("nothing recorded means no document was retrieved", () => {
    assert.equal(new ProvenanceLedger().retrievedDocuments, 0);
    assert.deepEqual(new ProvenanceLedger().entries(), []);
  });

  test("a document counts only when its name is one plain line of text", () => {
    const ledger = new ProvenanceLedger();
    const longName = "x".repeat(300);
    ledger.recordDocuments("Contracts", ["contract_03.pdf", 5, null, undefined, {}, ["a.pdf"], "", "   ", longName, "two\nlines.pdf", "tab\there.pdf"]);
    assert.equal(ledger.retrievedDocuments, 1);
  });

  test("a name is trimmed, and the same file twice is one entry", () => {
    const ledger = new ProvenanceLedger();
    ledger.recordDocuments("Contracts", [" contract_03.pdf ", "contract_03.pdf"]);
    ledger.recordDocuments("Contracts", ["contract_03.pdf"]);
    assert.equal(ledger.retrievedDocuments, 1);
  });

  test("the same file in two libraries is two entries; a library's name is the same however it is cased", () => {
    const ledger = new ProvenanceLedger();
    ledger.recordDocuments("Contracts", ["shared.pdf"]);
    ledger.recordDocuments("Policies", ["shared.pdf"]);
    assert.equal(ledger.retrievedDocuments, 2);
    ledger.recordDocuments("contracts", ["shared.pdf"]);
    assert.equal(ledger.retrievedDocuments, 2);
  });

  test("a library with no usable name records nothing", () => {
    const ledger = new ProvenanceLedger();
    ledger.recordDocuments("", ["a.pdf"]);
    ledger.recordDocuments("  ", ["a.pdf"]);
    assert.equal(ledger.retrievedDocuments, 0);
  });

  test("a query is recorded once per database, and a database without a usable name is not recorded", () => {
    const ledger = new ProvenanceLedger();
    ledger.recordQuery("postgres", "Sales");
    ledger.recordQuery("postgres", "Sales");
    ledger.recordQuery("postgres", "");
    assert.equal(ledger.entries().length, 1);
  });

  test("a query on a database does not count as retrieving a document", () => {
    assert.equal(ledgerWith({ databases: [["postgres", "Sales"]] }).retrievedDocuments, 0);
  });
});

describe("how a source is written", () => {
  test("a database is its kind and its name", () => {
    assert.equal(databaseSourceLine("postgres", "Sales"), "PostgreSQL — Sales");
    assert.equal(databaseSourceLine("mysql", " Ops "), "MySQL — Ops");
    assert.equal(databaseSourceLine("bigquery", "Warehouse"), "BigQuery — Warehouse");
  });

  test("an engine this file does not know is named as it is", () => {
    assert.equal(engineLabel("clickhouse"), "clickhouse");
    assert.equal(databaseSourceLine("clickhouse", "Events"), "clickhouse — Events");
  });

  test("a document is its file, with its library only when the workspace has several", () => {
    assert.equal(documentSourceLine("contract_03.pdf", "Contracts", false), "contract_03.pdf");
    assert.equal(documentSourceLine("contract_03.pdf", "Contracts", true), "contract_03.pdf (Contracts)");
  });
});

describe("checkSources: an answer with nothing to check", () => {
  test("an answer with no Sources block comes back exactly as it was", () => {
    const answer = "  The notice period is 30 days.\n\nSee clause 4.  \n";
    const result = checkSources(answer, ledgerWith({ documents: { Contracts: ["contract_03.pdf"] } }), ONE);
    assert.equal(result.text, answer);
    assert.equal(result.kept, 0);
    assert.equal(result.removed, 0);
  });

  test("the word 'sources' inside a sentence is not a block", () => {
    const answer = "Both sources agree.\nSources of revenue are listed below.\nSources of emissions: scope 1.";
    assert.equal(checkSources(answer, ledgerWith(), ONE).text, answer);
  });
});

describe("checkSources: what the ledger backs is kept, and written by the application", () => {
  const ledger = ledgerWith({ databases: [["postgres", "Sales"]], documents: { Contracts: ["contract_03.pdf"] } });

  test("the agreed format, with one library", () => {
    const result = checkSources("Revenue rose and the contract allows it.\n\nSources:\nPostgreSQL — Sales\ncontract_03.pdf", ledger, ONE);
    assert.equal(result.kept, 2);
    assert.equal(result.removed, 0);
    // Two trailing spaces are a Markdown hard break; see provenance-render.test.ts for why they are there.
    assert.equal(result.text, "Revenue rose and the contract allows it.\n\nSources:  \nPostgreSQL — Sales  \ncontract_03.pdf");
  });

  test("the agreed format, with several libraries", () => {
    const both = ledgerWith({ documents: { Contracts: ["contract_03.pdf"], Policies: ["policy_12.pdf"] } });
    const result = checkSources("Answer.\n\nSources:\ncontract_03.pdf (Contracts)\npolicy_12.pdf (Policies)", both, MANY);
    assert.equal(result.text, "Answer.\n\nSources:  \ncontract_03.pdf (Contracts)  \npolicy_12.pdf (Policies)");
    assert.equal(result.kept, 2);
  });

  test("the model's order is kept, and a line written twice is one line", () => {
    const both = ledgerWith({ documents: { Contracts: ["a.pdf", "b.pdf", "c.pdf"] } });
    const result = checkSources("Answer.\n\nSources:\nc.pdf\na.pdf\nc.pdf", both, ONE);
    assert.equal(result.text, "Answer.\n\nSources:  \nc.pdf  \na.pdf");
    assert.equal(result.kept, 2);
  });

  test("the model does not have to list everything that was retrieved", () => {
    const both = ledgerWith({ documents: { Contracts: ["a.pdf", "b.pdf"] } });
    assert.equal(checkSources("Answer.\n\nSources:\nb.pdf", both, ONE).text, `Answer.\n\n${written("b.pdf")}`);
  });
});

describe("checkSources: what the ledger does not back is dropped", () => {
  const ledger = ledgerWith({ databases: [["postgres", "Sales"]], documents: { Contracts: ["contract_03.pdf"] } });

  test("a file that no search returned", () => {
    const result = checkSources("Answer.\n\nSources:\ncontract_03.pdf\nboard_minutes_2019.pdf", ledger, ONE);
    assert.equal(result.text, `Answer.\n\n${written("contract_03.pdf")}`);
    assert.equal(result.kept, 1);
    assert.equal(result.removed, 1);
  });

  test("a database that was not queried", () => {
    const result = checkSources("Answer.\n\nSources:\nPostgreSQL — Sales\nPostgreSQL — Payroll\nMySQL — Sales", ledger, ONE);
    assert.equal(result.text, `Answer.\n\n${written("PostgreSQL — Sales")}`);
    assert.equal(result.removed, 2);
  });

  test("a real file filed under a library it did not come from", () => {
    const both = ledgerWith({ documents: { Contracts: ["contract_03.pdf"], Policies: ["policy_12.pdf"] } });
    const result = checkSources("Answer.\n\nSources:\ncontract_03.pdf (Policies)\npolicy_12.pdf (Contracts)", both, MANY);
    assert.equal(result.kept, 0);
    assert.equal(result.removed, 2);
    assert.equal(result.text, "Answer.");
  });

  test("a real file with a claim attached to the line", () => {
    const result = checkSources("Answer.\n\nSources:\ncontract_03.pdf — signed by the CFO on 3 May\ncontract_03.pdf (approved)", ledger, ONE);
    assert.equal(result.kept, 0);
    assert.equal(result.text, "Answer.");
  });

  test("a name that differs by even one character", () => {
    const result = checkSources("Answer.\n\nSources:\ncontract_3.pdf\nContract_03.pdf\ncontract_03.PDF\ncontract_03.pdf.exe", ledger, ONE);
    assert.equal(result.kept, 0);
    assert.equal(result.removed, 4);
  });

  test("a line for a source when nothing at all was retrieved or queried", () => {
    const result = checkSources("Answer.\n\nSources:\ncontract_03.pdf\nPostgreSQL — Sales", ledgerWith(), ONE);
    assert.equal(result.text, "Answer.");
    assert.equal(result.kept, 0);
    assert.equal(result.removed, 2);
  });

  test("when every line goes, the heading goes with it and the answer is what is left", () => {
    const result = checkSources("First paragraph.\n\nSecond paragraph.\n\nSources:\nmade_up.pdf", ledger, ONE);
    assert.equal(result.text, "First paragraph.\n\nSecond paragraph.");
    assert.ok(!/sources/i.test(result.text));
  });

  test("a heading with nothing under it is removed", () => {
    for (const answer of ["Answer.\n\nSources:", "Answer.\n\nSources:\n", "Answer.\n\nSources:\n\n\n"]) {
      assert.equal(checkSources(answer, ledger, ONE).text, "Answer.", JSON.stringify(answer));
    }
  });

  test("a line that two different sources would both be written as selects neither", () => {
    // A file whose own name ends in "(Policies)", and a file called "report" in the Policies library:
    // the line "report (Policies)" is the library-qualified name of one and the bare name of the other.
    const collide = ledgerWith({ documents: { Contracts: ["report (Policies)"], Policies: ["report"] } });
    const result = checkSources("Answer.\n\nSources:\nreport (Policies)", collide, MANY);
    assert.equal(result.kept, 0);
    assert.equal(result.removed, 1);
  });

  test("a file named like a database line does not stand in for the database", () => {
    const collide = ledgerWith({ databases: [["postgres", "Sales"]], documents: { Contracts: ["PostgreSQL — Sales"] } });
    const result = checkSources("Answer.\n\nSources:\nPostgreSQL — Sales", collide, ONE);
    assert.equal(result.kept, 0);
    assert.equal(result.text, "Answer.");
  });

  test("a shorthand that could mean two files selects neither", () => {
    const both = ledgerWith({ documents: { Contracts: ["shared.pdf"], Policies: ["shared.pdf"] } });
    const bare = checkSources("Answer.\n\nSources:\nshared.pdf", both, MANY);
    assert.equal(bare.kept, 0);
    const named = checkSources("Answer.\n\nSources:\nshared.pdf (Policies)", both, MANY);
    assert.equal(named.text, `Answer.\n\n${written("shared.pdf (Policies)")}`);
  });
});

describe("checkSources: a line is read generously and written strictly", () => {
  const ledger = ledgerWith({ databases: [["postgres", "Sales"]], documents: { Contracts: ["contract_03.pdf"] } });
  const expected = `Answer.\n\n${written("PostgreSQL — Sales", "contract_03.pdf")}`;

  test("list markers, emphasis and code around a line are read through", () => {
    const decorated = [
      "- PostgreSQL — Sales\n- contract_03.pdf",
      "* PostgreSQL — Sales\n* `contract_03.pdf`",
      "1. **PostgreSQL — Sales**\n2. **contract_03.pdf**",
      "• PostgreSQL — Sales\n• contract_03.pdf",
    ];
    for (const block of decorated) {
      assert.equal(checkSources(`Answer.\n\nSources:\n${block}`, ledger, ONE).text, expected, block);
    }
  });

  test("a hyphen, en dash or double hyphen for the em dash is read as the em dash", () => {
    for (const dash of ["-", "–", "--", "—"]) {
      const result = checkSources(`Answer.\n\nSources:\nPostgreSQL ${dash} Sales`, ledger, ONE);
      assert.equal(result.kept, 1, dash);
      assert.match(result.text, /PostgreSQL — Sales/);
    }
  });

  test("a file name with a double space or a non-breaking space is matched as it is written", () => {
    const spaced = ledgerWith({ documents: { Contracts: ["two  spaces.pdf", `non${String.fromCharCode(160)}breaking.pdf`] } });
    const result = checkSources(`Answer.\n\nSources:\ntwo  spaces.pdf\nnon${String.fromCharCode(160)}breaking.pdf`, spaced, ONE);
    assert.equal(result.kept, 2);
    assert.equal(result.removed, 0);
  });

  test("a model that escaped a name is still naming it", () => {
    const result = checkSources("Answer.\n\nSources:\ncontract\\_03.pdf", ledger, ONE);
    assert.equal(result.kept, 1);
    assert.match(result.text, /contract_03\.pdf/);
  });

  test("with one library, naming the library is harmless and is not written out", () => {
    const result = checkSources("Answer.\n\nSources:\ncontract_03.pdf (Contracts)", ledger, ONE);
    assert.equal(result.text, `Answer.\n\n${written("contract_03.pdf")}`);
  });

  test("with several, a file only one library returned may be named without it, and is written with it", () => {
    const both = ledgerWith({ documents: { Contracts: ["contract_03.pdf"], Policies: ["policy_12.pdf"] } });
    const result = checkSources("Answer.\n\nSources:\ncontract_03.pdf", both, MANY);
    assert.equal(result.text, `Answer.\n\n${written("contract_03.pdf (Contracts)")}`);
  });

  test("the heading may be bold, a Markdown heading, singular or upper case", () => {
    for (const heading of ["Sources:", "**Sources:**", "**Sources**:", "## Sources", "### Sources:", "Source:", "SOURCES", "_Sources_", "  Sources:  "]) {
      const result = checkSources(`Answer.\n\n${heading}\ncontract_03.pdf`, ledger, ONE);
      assert.equal(result.kept, 1, heading);
      assert.equal(result.text, `Answer.\n\n${written("contract_03.pdf")}`, heading);
    }
  });

  test("the block may follow a blank line under its heading", () => {
    const result = checkSources("Answer.\n\n## Sources\n\n- contract_03.pdf\n- made_up.pdf", ledger, ONE);
    assert.equal(result.text, `Answer.\n\n${written("contract_03.pdf")}`);
    assert.equal(result.removed, 1);
  });

  test("Windows line endings are read the same way", () => {
    const result = checkSources("Answer.\r\n\r\nSources:\r\ncontract_03.pdf\r\nmade_up.pdf\r\n", ledger, ONE);
    assert.equal(result.kept, 1);
    assert.equal(result.removed, 1);
    assert.match(result.text, /contract_03\.pdf$/);
  });
});

describe("checkSources: where the block starts and ends", () => {
  const ledger = ledgerWith({ documents: { Contracts: ["contract_03.pdf"] } });

  test("text before the block and text after it are left as they are", () => {
    const result = checkSources("Before.\n\nSources:\ncontract_03.pdf\nmade_up.pdf\n\nLet me know if you want more detail.", ledger, ONE);
    assert.equal(result.text, `Before.\n\n${written("contract_03.pdf")}\n\nLet me know if you want more detail.`);
  });

  test("only the last heading is the closing block", () => {
    const answer = "## Sources\n\nThe two energy sources are solar and wind.\n\nSources:\ncontract_03.pdf\nmade_up.pdf";
    const result = checkSources(answer, ledger, ONE);
    assert.equal(result.text, `## Sources\n\nThe two energy sources are solar and wind.\n\n${written("contract_03.pdf")}`);
  });

  test("a code fence ends the block", () => {
    const result = checkSources("Answer.\n\nSources:\ncontract_03.pdf\n```sql\nSELECT 1\n```", ledger, ONE);
    assert.equal(result.text, `Answer.\n\n${written("contract_03.pdf")}\n\n\`\`\`sql\nSELECT 1\n\`\`\``);
  });

  test("a heading or a rule under the block ends it", () => {
    const result = checkSources("Answer.\n\nSources:\ncontract_03.pdf\n## Next steps\nDo the thing.", ledger, ONE);
    assert.equal(result.kept, 1);
    assert.match(result.text, /## Next steps\nDo the thing\.$/);
  });

  test("Sources: with its entries on the same line counts only as the last line of the answer", () => {
    const valid = checkSources("Answer.\n\nSources: contract_03.pdf", ledger, ONE);
    assert.equal(valid.text, `Answer.\n\n${written("contract_03.pdf")}`);

    const bold = checkSources("Answer.\n\n**Sources:** contract_03.pdf", ledger, ONE);
    assert.equal(bold.text, `Answer.\n\n${written("contract_03.pdf")}`);

    const listed = checkSources("Answer.\n\nSources: contract_03.pdf, made_up.pdf", ledger, ONE);
    assert.equal(listed.text, "Answer.", "a list on one line cannot be told apart from a claim, so none of it is kept");
    assert.equal(listed.kept, 0);

    const notLast = "Sources: made_up.pdf\n\nAnd then more text.";
    assert.equal(checkSources(notLast, ledger, ONE).text, notLast);
  });

  test("checking what a check produced changes nothing", () => {
    const ledgerBoth = ledgerWith({ databases: [["postgres", "Sales"]], documents: { Contracts: ["contract_03.pdf"], Policies: ["policy_12.pdf"] } });
    const once = checkSources("Answer.\n\nSources:\n- PostgreSQL — Sales\n- contract_03.pdf (Contracts)\n- made_up.pdf", ledgerBoth, MANY);
    const twice = checkSources(once.text, ledgerBoth, MANY);
    assert.equal(twice.text, once.text);
    assert.equal(twice.kept, once.kept);
    assert.equal(twice.removed, 0);
  });
});

describe("asLiteralMarkdown: text that has to read as itself", () => {
  test("an ordinary name is written exactly as it is", () => {
    for (const name of ["contract_03.pdf", "Q3 report (final).pdf", "R&D plan.pdf", "Annual-Report 2025.docx", "Sales", "Vertrag für Müller.pdf", "報告書.pdf", "file.name.with.dots.pdf"]) {
      assert.equal(asLiteralMarkdown(name), name, name);
    }
  });

  test("anything that Markdown would read as something else goes in a code span", () => {
    const risky = [
      "_draft_.pdf",
      "[click](https://example.com).pdf",
      "www.example.com report.pdf",
      "https://evil.example/x.pdf",
      "a@b.com.pdf",
      "# Heading.pdf",
      "- item.pdf",
      "1. first.pdf",
      "> quote.pdf",
      "=== .pdf",
      "a*b*c.pdf",
      "a|b.pdf",
      "~~gone~~.pdf",
      "<b>x</b>.pdf",
      "&amp; x.pdf",
      "back\\slash.pdf",
    ];
    for (const name of risky) {
      const literal = asLiteralMarkdown(name);
      assert.ok(literal.startsWith("`") && literal.endsWith("`"), `${name} -> ${literal}`);
      assert.ok(literal.includes(name), `${name} -> ${literal}`);
    }
  });

  test("a backtick in the name lengthens the fence, and an edge backtick is padded", () => {
    assert.equal(asLiteralMarkdown("tick`tick.pdf"), "``tick`tick.pdf``");
    assert.equal(asLiteralMarkdown("`edge`.pdf"), "`` `edge`.pdf ``");
    assert.equal(asLiteralMarkdown("a``b`c.pdf"), "```a``b`c.pdf```");
  });
});

describe("sourcesCorrection: what a second attempt is told", () => {
  test("it lists exactly what may be cited, written the way the block writes it", () => {
    const ledger = ledgerWith({ databases: [["postgres", "Sales"]], documents: { Contracts: ["contract_03.pdf"], Policies: ["policy_12.pdf"] } });
    const message = sourcesCorrection(ledger, MANY);
    assert.match(message, /Sources:/);
    assert.match(message, /PostgreSQL — Sales\ncontract_03\.pdf \(Contracts\)\npolicy_12\.pdf \(Policies\)/);
    assert.match(message, /leave the block out/);
  });

  test("with one library the lines carry no library", () => {
    const message = sourcesCorrection(ledgerWith({ documents: { Contracts: ["contract_03.pdf"] } }), ONE);
    assert.match(message, /\ncontract_03\.pdf\n/);
    assert.ok(!message.includes("(Contracts)"));
  });

  test("it is not made unboundedly long by a run that retrieved a great deal", () => {
    const files = Array.from({ length: 500 }, (_, index) => `file_${index}.pdf`);
    const message = sourcesCorrection(ledgerWith({ documents: { Contracts: files } }), ONE);
    assert.ok(message.split("\n").filter((line) => line.startsWith("file_")).length <= 50);
  });
});
