/**
 * Graders for the media-connection cases: which tools and sources a run used,
 * and whether the Sources block it ended with can be trusted.
 *
 * Two rules keep these honest.
 *
 * Every grade says what KIND of failure it is (see `FailureCategory`), because
 * a report that says "70% pass" cannot say whether to fix the prompt, the
 * check or the renderer.
 *
 * Provenance is graded against the run's own record of what happened, taken from
 * the fixture library and the database stub (`outcome.retrieved`,
 * `outcome.queried`), and by code that is separate from the loop's own
 * `checkSources`. If the check had a bug, grading its output with the check would
 * agree with it. Here a line is right if the fixture really returned that file
 * or the database really ran that query, however the loop decided it.
 */

import { renderAnswer, tagsIn, visibleLines } from "./render";
import type { EvalOutcome, GradeResult, SourceExpectation, SourceRef } from "./types";

const pass = (reason: string): GradeResult => ({ pass: true, reason });
const fail = (category: NonNullable<GradeResult["category"]>, reason: string): GradeResult => ({
  pass: false,
  reason,
  category,
});

// -- What a run used ---------------------------------------------------------

/** The sources a run reached: databases it tried to query and libraries a search was accepted for. */
export function sourcesUsed(outcome: EvalOutcome): SourceRef[] {
  const used = new Set<SourceRef>();
  for (const call of outcome.toolCalls) {
    if (call.name === "run_sql" && call.database) used.add(`db:${call.database}`);
    if (call.name === "search_documents" && call.ok && call.library) used.add(`lib:${call.library}`);
  }
  return [...used];
}

/** Sources the run used that the question did not need. */
export function unnecessarySources(outcome: EvalOutcome, expectation: SourceExpectation): SourceRef[] {
  const wanted = new Set([...expectation.required, ...(expectation.allowed ?? [])]);
  return sourcesUsed(outcome).filter((source) => !wanted.has(source));
}

/** Sources the question needed that the run never used. */
export function missingSources(outcome: EvalOutcome, expectation: SourceExpectation): SourceRef[] {
  const used = new Set(sourcesUsed(outcome));
  return expectation.required.filter((source) => !used.has(source));
}

// -- Routing -----------------------------------------------------------------

const searches = (outcome: EvalOutcome) => outcome.toolCalls.filter((call) => call.name === "search_documents");
const sqlCalls = (outcome: EvalOutcome) => outcome.toolCalls.filter((call) => call.name === "run_sql");

export function usedSql(outcome: EvalOutcome, why = "the question is about figures in the database"): GradeResult {
  return sqlCalls(outcome).length > 0
    ? pass("ran a query")
    : fail("routing", `never ran a query (${why}); tools used: ${toolNames(outcome)}`);
}

export function neverRanSql(outcome: EvalOutcome, why = "the answer is in the documents"): GradeResult {
  const n = sqlCalls(outcome).length;
  return n === 0 ? pass("ran no query") : fail("routing", `ran ${n} quer${n === 1 ? "y" : "ies"} (${why})`);
}

export function neverSearched(outcome: EvalOutcome, why = "the question is answered by the database"): GradeResult {
  const n = searches(outcome).length;
  return n === 0 ? pass("searched no documents") : fail("routing", `searched documents ${n} time(s) (${why})`);
}

export function searchedLibrary(outcome: EvalOutcome, name: string): GradeResult {
  const reached = searches(outcome).some((call) => call.ok && call.library === name);
  return reached
    ? pass(`searched "${name}"`)
    : fail("routing", `never searched "${name}"; tools used: ${toolNames(outcome)}`);
}

/** Every accepted search went to one of these libraries. */
export function searchedOnly(outcome: EvalOutcome, names: string[]): GradeResult {
  const stray = [...new Set(searches(outcome).filter((call) => call.ok && call.library && !names.includes(call.library)).map((call) => call.library))];
  return stray.length === 0
    ? pass(`searched only ${names.join(", ")}`)
    : fail("routing", `also searched ${stray.join(", ")}, which the question did not need`);
}

/** The run did something before answering, rather than only asking. */
export function actedBeforeAnswering(outcome: EvalOutcome): GradeResult {
  return outcome.toolCalls.length > 0
    ? pass("used a tool before answering")
    : fail("routing", `answered without using any tool: ${excerpt(outcome.finalText)}`);
}

export function firstToolWas(outcome: EvalOutcome, tool: "run_sql" | "search_documents", target?: string): GradeResult {
  const first = outcome.toolCalls[0];
  if (!first) return fail("routing", `used no tool at all; expected ${tool} first`);
  const wrongTarget = target !== undefined && (first.library ?? first.database) !== target;
  return first.name === tool && !wrongTarget
    ? pass(`${tool}${target ? ` on ${target}` : ""} came first`)
    : fail("routing", `first tool was ${first.name} on ${first.library ?? first.database ?? "?"}; expected ${tool}${target ? ` on ${target}` : ""}`);
}

/**
 * No tool call at all before a clarifying question, and the question names each
 * of the options. For a question where a wrong choice of source would change a
 * figure or a conclusion, acting first is the failure.
 */
export function askedBeforeActing(outcome: EvalOutcome, options: RegExp[]): GradeResult {
  if (outcome.toolCalls.length > 0) {
    return fail("routing", `used ${toolNames(outcome)} before asking, though a wrong source would have changed the answer`);
  }
  if (!outcome.finalText.includes("?")) {
    return fail("routing", `neither used a tool nor asked a question: ${excerpt(outcome.finalText)}`);
  }
  const missing = options.filter((option) => !option.test(outcome.finalText));
  return missing.length === 0
    ? pass("asked a question that names both options, before using anything")
    : fail("routing", `asked, but the question does not name every option (missing ${missing.map(String).join(", ")}): ${excerpt(outcome.finalText)}`);
}

/** The run did not end in a question, when it had what it needed to answer. */
export function didNotAskInstead(outcome: EvalOutcome): GradeResult {
  return /\?\s*$/.test(outcome.finalText.trim()) && outcome.toolCalls.length === 0
    ? fail("routing", `asked instead of acting: ${excerpt(outcome.finalText)}`)
    : pass("did not ask instead of acting");
}

// -- Provenance --------------------------------------------------------------

const ENGINE_LABELS: Record<string, string> = { postgres: "PostgreSQL", mysql: "MySQL", bigquery: "BigQuery", demo: "Sample data" };

type Truth = { line: string; kind: "document" | "database"; file?: string; library?: string; name?: string };

/** What the run's own results back, one canonical plain line each, as the agreed format writes them. */
export function truth(outcome: EvalOutcome): Truth[] {
  const found: Truth[] = [];
  const seen = new Set<string>();
  for (const { name, engine } of outcome.queried) {
    const line = `${ENGINE_LABELS[engine] ?? engine} — ${name}`;
    if (!seen.has(line)) {
      seen.add(line);
      found.push({ line, kind: "database", name });
    }
  }
  for (const { library, file } of outcome.retrieved) {
    const line = outcome.showLibrary ? `${file} (${library})` : file;
    if (!seen.has(line)) {
      seen.add(line);
      found.push({ line, kind: "document", file, library });
    }
  }
  return found;
}

const HEADING = /^\s{0,3}(?:#{1,6}\s+)?(?:(\*\*|__)\s*)?sources?\s*:?\s*\1?\s*:?\s*$/i;

/** The lines under the last bare "Sources" heading, up to a blank line, a fence or a heading. Null if there is no such heading. */
export function blockLines(text: string): string[] | null {
  const lines = text.split("\n");
  let at = -1;
  for (let index = lines.length - 1; index >= 0; index--) {
    if (HEADING.test(lines[index])) {
      at = index;
      break;
    }
  }
  if (at === -1) return null;
  let start = at + 1;
  if (start < lines.length && lines[start].trim() === "" && start + 1 < lines.length && lines[start + 1].trim() !== "") start += 1;
  const found: string[] = [];
  for (let index = start; index < lines.length; index++) {
    const line = lines[index];
    if (line.trim() === "" || /^\s{0,3}(?:```|~~~)/.test(line) || /^\s{0,3}#{1,6}\s/.test(line)) break;
    found.push(line);
  }
  return found;
}

/** A line as a reader would read it: no list marker, no emphasis or code around it, no escapes, one kind of dash. */
export function plain(line: string): string {
  let text = line
    .replace(/\s+$/, "")
    .replace(/\\([!-/:-@[-`{-~])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  text = text.replace(/^(?:[-*+•]|\d{1,3}[.)])\s+/, "");
  const wrapped = /^(\*\*|__|\*|_|`+)\s?(.+?)\s?\1$/.exec(text);
  if (wrapped) text = wrapped[2].trim();
  return text.replace(/ (?:–|--|-) /, " — ");
}

/** The canonical line a model's line means, if it means one this run backs. */
function backedLine(raw: string, backed: Truth[], libraries: string[]): string | null {
  const candidates = [plain(raw)];
  // With one library, naming it is harmless. With several, the library named is
  // part of the claim, and a wrong one must not be read as no library at all.
  const parenthesised = /^(.*) \((.+)\)$/.exec(candidates[0]);
  if (parenthesised && libraries.length === 1 && libraries[0] === parenthesised[2]) candidates.push(parenthesised[1]);
  for (const candidate of candidates) {
    const exact = backed.find((entry) => entry.line === candidate);
    if (exact) return exact.line;
    // A bare file name is enough when only one retrieved file has it.
    const byFile = backed.filter((entry) => entry.kind === "document" && entry.file === candidate);
    if (byFile.length === 1) return byFile[0].line;
  }
  return null;
}

/**
 * The model's own Sources block, before the application's check, is complete and
 * honest: present when documents came back, every line one the run really
 * retrieved or queried, and naming what the answer needs to name.
 *
 * Read from `rawAnswer`, the text since the last reset, so after a corrective
 * retry it is the second attempt. Whether the first attempt needed the retry is
 * recorded separately (`provenance_retry`), and is the measure of how often the
 * model gets it right unprompted.
 */
export function provenanceGenerated(
  outcome: EvalOutcome,
  options: { cites?: string[]; citesDatabases?: string[] } = {}
): GradeResult {
  if (outcome.retrieved.length === 0) return pass("no document was retrieved, so no block was owed");

  const raw = blockLines(outcome.rawAnswer);
  if (!raw || raw.length === 0) {
    return fail("provenance_generation", "documents were retrieved but the model's answer ends without a Sources block");
  }

  const backed = truth(outcome);
  const mapped = raw.map((line) => ({ line, canonical: backedLine(line, backed, outcome.libraries) }));
  const unbacked = mapped.filter((entry) => entry.canonical === null).map((entry) => plain(entry.line));
  if (unbacked.length > 0) {
    return fail("provenance_generation", `the model's block cites ${unbacked.length} line(s) the run did not retrieve or query: ${unbacked.join(" | ")}`);
  }

  // Only what the run actually retrieved or queried can be owed a citation. A
  // file the model never searched its way to is a routing failure, already
  // reported as one; demanding it here would count the same mistake twice, under
  // a kind that says the model wrote its block badly when it wrote it correctly.
  const named = new Set(mapped.map((entry) => entry.canonical));
  const missing = [
    ...(options.cites ?? []).filter(
      (file) => backed.some((entry) => entry.file === file) && !backed.some((entry) => entry.file === file && named.has(entry.line))
    ),
    ...(options.citesDatabases ?? []).filter(
      (db) => backed.some((entry) => entry.name === db) && !backed.some((entry) => entry.name === db && named.has(entry.line))
    ),
  ];
  return missing.length === 0
    ? pass("the model's block is complete and every line is backed")
    : fail("provenance_generation", `the model's block does not name ${missing.join(", ")}`);
}

/**
 * The application's check did its job on this run: nothing the run does not back
 * reached the reader, and nothing it does back was removed.
 */
export function provenanceSanitized(outcome: EvalOutcome): GradeResult {
  const backed = truth(outcome);
  const delivered = blockLines(outcome.finalText) ?? [];

  const strays = delivered.map(plain).filter((line) => !backed.some((entry) => entry.line === line));
  if (strays.length > 0) {
    return fail("provenance_sanitization", `a line the run does not back reached the reader: ${strays.join(" | ")}`);
  }

  const raw = blockLines(outcome.rawAnswer) ?? [];
  const shown = new Set(delivered.map(plain));
  const lost = raw
    .map((line) => backedLine(line, backed, outcome.libraries))
    .filter((canonical): canonical is string => canonical !== null && !shown.has(canonical));
  return lost.length === 0
    ? pass("nothing unbacked was let through and nothing backed was removed")
    : fail("provenance_sanitization", `the check removed a line the run backs: ${[...new Set(lost)].join(" | ")}`);
}

/** The delivered Sources block draws as one source per line, with nothing in it but text. */
export function sourcesRenderCorrectly(outcome: EvalOutcome): GradeResult {
  const delivered = blockLines(outcome.finalText);
  if (!delivered || delivered.length === 0) return pass("no Sources block was delivered, so there is nothing to render");

  const html = renderAnswer(outcome.finalText);
  const paragraph = /<p>(?:(?!<\/p>)[\s\S])*?Sources:(?:(?!<\/p>)[\s\S])*<\/p>/.exec(html)?.[0];
  if (!paragraph) return fail("rendering", "the Sources block did not render as its own paragraph");

  const tags = [...tagsIn(paragraph)].filter((tag) => !["p", "br", "code"].includes(tag));
  if (tags.length > 0) return fail("rendering", `the Sources block renders with <${tags.join(">, <")}>, which a file name should never produce`);

  const shown = visibleLines(paragraph);
  if (shown[0]?.startsWith("Sources:") && shown[0] !== "Sources:") {
    return fail("rendering", `the block's lines ran together on one line: ${JSON.stringify(shown[0])}`);
  }
  if (shown[0] !== "Sources:") return fail("rendering", `the block's first visible line is ${JSON.stringify(shown[0])}, not "Sources:"`);
  if (shown.length !== delivered.length + 1) {
    return fail("rendering", `the block has ${delivered.length} source line(s) but draws as ${shown.length - 1}: the lines ran together`);
  }
  const backed = truth(outcome);
  const strays = shown.slice(1).filter((line) => !backed.some((entry) => entry.line === line));
  return strays.length === 0
    ? pass("the block draws one source per line")
    : fail("rendering", `the block draws text the run does not back: ${strays.join(" | ")}`);
}

/**
 * All three provenance checks for a case whose answer must cite its sources.
 * `cites` and `citesDatabases` are what the model's block must name.
 */
export function provenanceHolds(outcome: EvalOutcome, options: { cites?: string[]; citesDatabases?: string[] } = {}): GradeResult {
  const grades = [provenanceGenerated(outcome, options), provenanceSanitized(outcome), sourcesRenderCorrectly(outcome)];
  const failed = grades.filter((grade) => !grade.pass);
  return {
    pass: failed.length === 0,
    reason: failed.length === 0 ? "the Sources block is valid, backed and renders correctly" : failed.map((grade) => grade.reason).join("; "),
    ...(failed.length > 0 ? { failures: failed.map((grade) => ({ category: grade.category ?? "provenance_generation", reason: grade.reason })) } : {}),
  };
}

// -- Answers and retrieval ---------------------------------------------------

/** The final answer matches `pattern`: a fact it had to state. */
export function answerMatches(outcome: EvalOutcome, pattern: RegExp, why: string): GradeResult {
  return pattern.test(outcome.finalText)
    ? pass(`the answer matched ${pattern} (${why})`)
    : fail("answer", `the answer never matched ${pattern} — ${why}: ${excerpt(outcome.finalText)}`);
}

/** The final answer does not match `pattern`: a claim it must not make. */
export function answerAvoids(outcome: EvalOutcome, pattern: RegExp, why: string): GradeResult {
  return pattern.test(outcome.finalText)
    ? fail("answer", `the answer matched ${pattern} — ${why}: ${excerpt(outcome.finalText)}`)
    : pass(`the answer avoided ${pattern} (${why})`);
}

/**
 * No search the run made failed. A failed search is the retrieval service's,
 * not the model's, and is reported under its own kind so a flaky service is not
 * read as a routing regression.
 */
export function retrievalSucceeded(outcome: EvalOutcome): GradeResult {
  const failed = outcome.toolCalls.filter((call) => call.name === "search_documents" && !call.ok && outcome.libraries.includes(call.library ?? ""));
  return failed.length === 0
    ? pass("every search the run made succeeded")
    : fail("retrieval", `${failed.length} search(es) of an attached library failed`);
}

/** Every percentage an answer states, as written: "2%", "10 percent". */
export function percentagesIn(text: string): string[] {
  return text.match(/\d+(?:\.\d+)?\s*(?:%|percent\b)/gi) ?? [];
}

// -- Shared ------------------------------------------------------------------

function toolNames(outcome: EvalOutcome): string {
  return outcome.toolCalls.length ? outcome.toolCalls.map((call) => call.name).join(" → ") : "(none)";
}

function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 160 ? `${flat.slice(0, 160)}…` : flat || "(empty)";
}
