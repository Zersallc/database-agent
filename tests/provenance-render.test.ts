/**
 * What the reader actually sees of a Sources block.
 *
 * These render through `components/chat/Markdown.tsx`, the component the chat
 * uses for every answer, so they test the rendered result rather than the text
 * that produces it. Two things are at stake:
 *
 * - The agreed format is one source per line. Markdown joins consecutive lines
 *   into one paragraph, so without help the block is drawn as a run-on line.
 * - The block is built from file names, which are other people's words. A name
 *   that Markdown reads as a link, emphasis or a heading must still be drawn as
 *   the name and nothing else.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { ProvenanceLedger, checkSources } from "@/lib/agent/provenance";

import { renderAnswer as render, tagsIn, visibleLines } from "./helpers/render-answer";

function answerWith(files: string[], style = { showLibrary: true }) {
  const ledger = new ProvenanceLedger();
  ledger.recordDocuments("Contracts", files);
  // Listed the way a model lists them: a bare "# Heading.pdf" line would be a
  // heading to Markdown itself, and ends a block by design.
  return checkSources(`Answer.\n\nSources:\n${files.map((file) => `- ${file}`).join("\n")}`, ledger, style);
}

describe("the block is drawn one source to a line", () => {
  test("as the model would write it, Markdown runs the lines together (which is why the application writes it)", () => {
    const html = render("Answer.\n\nSources:\nPostgreSQL — Sales\ncontract_03.pdf");
    assert.ok(!html.includes("<br"), html);
    assert.deepEqual(visibleLines(html.replace(/\n/g, " ")), ["Answer.", "Sources: PostgreSQL — Sales contract_03.pdf"]);
  });

  test("as the application writes it, every source has its own line", () => {
    const ledger = new ProvenanceLedger();
    ledger.recordQuery("postgres", "Sales");
    ledger.recordDocuments("Contracts", ["contract_03.pdf"]);
    const { text } = checkSources("Answer.\n\nSources:\nPostgreSQL — Sales\ncontract_03.pdf", ledger, { showLibrary: false });
    const html = render(text);
    assert.deepEqual(visibleLines(html), ["Answer.", "Sources:", "PostgreSQL — Sales", "contract_03.pdf"]);
    assert.equal((html.match(/<br\s*\/?>/g) ?? []).length, 2);
  });

  test("with several libraries, each line names its library", () => {
    const ledger = new ProvenanceLedger();
    ledger.recordDocuments("Contracts", ["contract_03.pdf"]);
    ledger.recordDocuments("Policies", ["policy_12.pdf"]);
    const { text } = checkSources("Answer.\n\nSources:\ncontract_03.pdf (Contracts)\npolicy_12.pdf (Policies)", ledger, { showLibrary: true });
    assert.deepEqual(visibleLines(render(text)), ["Answer.", "Sources:", "contract_03.pdf (Contracts)", "policy_12.pdf (Policies)"]);
  });
});

describe("a file name is drawn as the name and nothing else", () => {
  const names = [
    "contract_03.pdf",
    "Q3 report (final).pdf",
    "R&D plan.pdf",
    "_draft_.pdf",
    "**bold**.pdf",
    "[click](https://example.com).pdf",
    "![pixel](https://example.com/p.png).png",
    "www.example.com report.pdf",
    "https://evil.example/x.pdf",
    "a@b.com.pdf",
    "mailto:someone@example.com",
    "# Heading.pdf",
    "- item.pdf",
    "1. first.pdf",
    "> quote.pdf",
    "=== .pdf",
    "a|b|c.pdf",
    "~~gone~~.pdf",
    "<script>alert(1)</script>.pdf",
    "<b>bold</b>.pdf",
    "&amp; &lt;b&gt;.pdf",
    "back\\slash.pdf",
    "tick`tick.pdf",
    "`edge`.pdf",
    `a${String.fromCharCode(160)}b.pdf`,
    "two  spaces.pdf",
  ];

  for (const name of names) {
    test(JSON.stringify(name), () => {
      const result = answerWith([name]);
      assert.equal(result.kept, 1, "the name is one the ledger holds, so it is kept");

      const html = render(result.text);
      const allowed = new Set(["div", "p", "br", "code"]);
      for (const tag of tagsIn(html)) assert.ok(allowed.has(tag), `unexpected <${tag}> in ${html}`);
      assert.deepEqual(visibleLines(html), ["Answer.", "Sources:", `${name} (Contracts)`]);
    });
  }

  test("an ordinary name is stored as plain text, with no code span around it", () => {
    const { text } = answerWith(["contract_03.pdf", "Q3 report (final).pdf", "R&D plan.pdf"]);
    assert.ok(!text.includes("`"), text);
  });
});

describe("what was stripped is not on the page", () => {
  test("a line the ledger does not back is absent from the rendered answer", () => {
    const ledger = new ProvenanceLedger();
    ledger.recordDocuments("Contracts", ["contract_03.pdf"]);
    const { text } = checkSources(
      "The notice period is 30 days.\n\nSources:\ncontract_03.pdf\nboard_minutes_2019.pdf\n[Fake](https://evil.example)",
      ledger,
      { showLibrary: false }
    );
    const html = render(text);
    const shown = visibleLines(html).join("\n");
    assert.match(shown, /contract_03\.pdf/);
    assert.ok(!shown.includes("board_minutes_2019"), shown);
    assert.ok(!shown.includes("evil.example"), shown);
    assert.ok(!html.includes("<a"), html);
  });

  test("when every line is stripped the reader sees the answer and no Sources heading", () => {
    const ledger = new ProvenanceLedger();
    ledger.recordDocuments("Contracts", ["contract_03.pdf"]);
    const { text } = checkSources("The notice period is 30 days.\n\nSources:\nmade_up.pdf", ledger, { showLibrary: false });
    assert.deepEqual(visibleLines(render(text)), ["The notice period is 30 days."]);
  });
});
