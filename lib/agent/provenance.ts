/**
 * Where an answer's facts came from, decided by the application.
 *
 * A model can say where it got something. It cannot make that true. So the
 * agent loop keeps a ledger of what actually happened in one run: which
 * databases returned a successful query, and which (library, file) pairs a
 * search returned. When the model closes an answer with a Sources block, the
 * block is not trusted and not copied: each of its lines is looked up in the
 * ledger, the lines the ledger backs are written out again by the application,
 * and every other line is dropped.
 *
 * Rewriting rather than filtering is deliberate. It means nothing in the final
 * block came from the model's hand: not an invented file, not a real file
 * filed under the wrong library, not a line with a claim tacked onto it, and
 * not markup a file name happens to contain. It is also what lets the block be
 * laid out so it survives a Markdown renderer (see `renderBlock`).
 *
 * The model chooses which of the retrieved sources its answer relied on. The
 * application decides which of those are real and how they are written.
 *
 * What this does not do: it does not read the answer's prose. A file named in
 * a sentence is the model's sentence, and this module is not an argument about
 * whether the sentence is true. Nor does it remember earlier turns: a run's
 * ledger is that run's own tool results, because stored history carries no
 * tool results (see `messages` in `runAgent`).
 */

const ENGINE_LABELS: Record<string, string> = {
  postgres: "PostgreSQL",
  mysql: "MySQL",
  bigquery: "BigQuery",
  demo: "Sample data",
};

/** How an engine is named to a reader. An engine this table does not know is named as it is. */
export function engineLabel(engine: string): string {
  return ENGINE_LABELS[engine] ?? engine;
}

/** The line that says a database was queried: "PostgreSQL — Sales". */
export function databaseSourceLine(engine: string, name: string): string {
  return `${engineLabel(engine)} — ${name.trim()}`;
}

/** The line that says a document was used: the file, and its library when a workspace has more than one. */
export function documentSourceLine(file: string, library: string, showLibrary: boolean): string {
  return showLibrary ? `${file} (${library})` : file;
}

/** How Sources lines are written in one workspace. */
export type SourceStyle = {
  /** True when the workspace has more than one library, so a file name alone would not say where it lives. */
  showLibrary: boolean;
};

type DatabaseEntry = { kind: "database"; engine: string; name: string };
type DocumentEntry = { kind: "document"; library: string; file: string };
type LedgerEntry = DatabaseEntry | DocumentEntry;

/**
 * Longest name that can be cited. A real file name is well under this; a
 * longer one is not something worth writing into an answer.
 */
const MAX_NAME_CHARS = 255;

/**
 * A name worth recording, trimmed, or null. Anything that is not a plain
 * one-line string is refused rather than repaired: a repaired name would be a
 * claim about a file that does not exist, and a name with a line break in it
 * could not sit on one line of a block.
 */
function citable(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > MAX_NAME_CHARS) return null;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    // C0 controls, DEL, and the two Unicode line and paragraph separators.
    if (code < 32 || code === 127 || code === 0x2028 || code === 0x2029) return null;
  }
  return text;
}

/**
 * What one run has actually done, as far as sources go. Written only from
 * results the run really received; nothing a model says can add to it.
 */
export class ProvenanceLedger {
  private readonly databases = new Map<string, DatabaseEntry>();
  private readonly documents = new Map<string, DocumentEntry>();

  /** A query on this database succeeded. A failed query never comes here. */
  recordQuery(engine: string, name: string): void {
    const database = citable(name);
    if (!database) return;
    this.databases.set(JSON.stringify([engine, database]), { kind: "database", engine, name: database });
  }

  /** A search of this library returned passages from these files. */
  recordDocuments(library: string, sources: readonly unknown[]): void {
    const where = citable(library);
    if (!where) return;
    for (const source of sources) {
      const file = citable(source);
      if (!file) continue;
      // Library names are unique regardless of case within a workspace, so the
      // key ignores case; the name kept is the one the administrator wrote.
      this.documents.set(JSON.stringify([where.toLowerCase(), file]), { kind: "document", library: where, file });
    }
  }

  /** How many distinct (library, file) pairs a search has returned. Zero means no document was retrieved. */
  get retrievedDocuments(): number {
    return this.documents.size;
  }

  entries(): LedgerEntry[] {
    return [...this.databases.values(), ...this.documents.values()];
  }
}

function plainLine(entry: LedgerEntry, style: SourceStyle): string {
  return entry.kind === "database"
    ? databaseSourceLine(entry.engine, entry.name)
    : documentSourceLine(entry.file, entry.library, style.showLibrary);
}

/**
 * Every way a model's line may be written and still mean one ledger entry,
 * mapped to that entry. A spelling two entries share maps to null: it does not
 * say which one was meant, so it selects neither.
 *
 * The library is always accepted alongside the file, and a bare file name only
 * when exactly one retrieved file has it. Accepting a model's shorthand costs
 * nothing, because what gets written out is the application's own line.
 */
function spellings(ledger: ProvenanceLedger): Map<string, LedgerEntry | null> {
  const found = new Map<string, LedgerEntry | null>();
  const add = (spelling: string, entry: LedgerEntry) => {
    found.set(spelling, found.has(spelling) && found.get(spelling) !== entry ? null : entry);
  };

  const entries = ledger.entries();
  const filesSeen = new Map<string, number>();
  for (const entry of entries) {
    if (entry.kind === "document") filesSeen.set(entry.file, (filesSeen.get(entry.file) ?? 0) + 1);
  }

  for (const entry of entries) {
    if (entry.kind === "database") {
      add(databaseSourceLine(entry.engine, entry.name), entry);
    } else {
      add(documentSourceLine(entry.file, entry.library, true), entry);
      if (filesSeen.get(entry.file) === 1) add(entry.file, entry);
    }
  }
  return found;
}

/** CommonMark lets a backslash escape any ASCII punctuation; a model that escapes a name is still naming it. */
function withoutEscapes(text: string): string {
  return text.replace(/\\([!-/:-@[-`{-~])/g, "$1");
}

/**
 * The plain forms a model's line might be read as, most literal first: as
 * written, without a list marker, without emphasis or code around it, and
 * with a hyphen or en dash where the em dash belongs.
 */
function candidateTexts(raw: string): string[] {
  // As written first, then with runs of whitespace collapsed: a real file name
  // can hold a double space or a non-breaking space, and a model's spacing can
  // drift from it.
  const unescaped = withoutEscapes(raw.replace(/\\\s*$/, ""));
  const forms = new Set<string>([unescaped.trim(), unescaped.replace(/\s+/g, " ").trim()]);

  for (const form of [...forms]) {
    forms.add(form.replace(/^(?:[-*+•]|\d{1,3}[.)])\s+/, ""));
  }

  for (const form of [...forms]) {
    const wrapped = /^(\*\*|__|\*|_|`)(.+)\1$/.exec(form);
    if (wrapped) forms.add(wrapped[2].trim());
  }
  for (const form of [...forms]) {
    forms.add(form.replace(/ (?:–|--|-) /, " — "));
  }
  return [...forms].filter((form) => form.length > 0);
}

/**
 * A bare heading: "Sources:", "**Sources:**", "## Sources", "Source". The
 * emphasis marker, when there is one, has to be the same on both sides.
 */
const BARE_HEADING = /^\s{0,3}(?:#{1,6}\s+)?(?:(\*\*|__|\*|_)\s*)?sources?\s*:?\s*\1?\s*:?\s*$/i;

/** A heading with its one entry on the same line: "Sources: a.pdf" or "**Sources:** a.pdf". */
function inlineRemainder(line: string): string | null {
  const plain = /^\s{0,3}(?:#{1,6}\s+)?sources?\s*:\s+(\S.*)$/i.exec(line);
  if (plain) return plain[1];
  const bold = /^\s{0,3}(?:#{1,6}\s+)?(\*\*|__)\s*sources?\s*:?\s*\1\s*:?\s+(\S.*)$/i.exec(line);
  return bold ? bold[2] : null;
}

const CODE_FENCE = /^\s{0,3}(?:```|~~~)/;
const HEADING_LINE = /^\s{0,3}#{1,6}\s/;
const THEMATIC_BREAK = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;

/** A line that can belong to a block: not blank, and not something that starts another kind of block. */
function belongsToBlock(line: string): boolean {
  return line.trim() !== "" && !CODE_FENCE.test(line) && !HEADING_LINE.test(line) && !THEMATIC_BREAK.test(line);
}

/**
 * Whether text would render as itself if it were written into a paragraph.
 *
 * File names and library names are other people's words, and the answer is
 * drawn by `react-markdown` with GitHub autolinks on. Left alone, a file
 * called `[click](https://example.com).pdf` becomes a link, `_draft_.pdf`
 * becomes emphasis and `www.example.com` becomes a link to a host nobody
 * chose. This is deliberately a list of what is safe rather than of what is
 * not: a name that is not plainly ordinary is treated as unsafe.
 *
 * Backslash escapes are not an answer for the autolinks: they are matched on
 * the parsed text, after escapes have been resolved, so `www\.example.com`
 * links anyway.
 */
function rendersAsItself(text: string): boolean {
  const characters = Array.from(text);
  const isWordCharacter = (character: string | undefined) => character !== undefined && /[\p{L}\p{N}]/u.test(character);

  for (let index = 0; index < characters.length; index++) {
    const character = characters[index];
    if ("\\`*[]<>~|@".includes(character)) return false;
    // Between two letters or digits an underscore is only an underscore.
    if (character === "_" && !(isWordCharacter(characters[index - 1]) && isWordCharacter(characters[index + 1]))) return false;
    if (character === "&" && /^&(?:#\d+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/.test(characters.slice(index).join(""))) return false;
  }
  // A URL scheme or a bare www host, which GitHub-style autolinks turn into links.
  if (text.includes("://") || /(^|[\s(*_~])www\./i.test(text)) return false;
  // What would turn the line into a heading, a list, a quote, a rule or a setext underline.
  if (/^(?:[#+\-=]|\d{1,9}[.)])/.test(text)) return false;
  return true;
}

/**
 * Text as a Markdown fragment that renders as exactly itself.
 *
 * An ordinary name is written as it is, so `contract_03.pdf` is stored and
 * shown as `contract_03.pdf`. Anything else goes into an inline code span,
 * where nothing is interpreted: no link, no emphasis, no HTML, no autolink.
 * The fence is one backtick longer than the longest run inside the text, and a
 * text that starts or ends with a backtick is padded with a space, as
 * CommonMark requires.
 */
export function asLiteralMarkdown(text: string): string {
  if (rendersAsItself(text)) return text;
  const longestRun = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longestRun + 1);
  const padded = text.startsWith("`") || text.endsWith("`") ? ` ${text} ` : text;
  return `${fence}${padded}${fence}`;
}

/** One source as the reader sees it: `plainLine`, with each name made literal. */
function displayLine(entry: LedgerEntry, style: SourceStyle): string {
  if (entry.kind === "database") return `${engineLabel(entry.engine)} — ${asLiteralMarkdown(entry.name)}`;
  return documentSourceLine(asLiteralMarkdown(entry.file), asLiteralMarkdown(entry.library), style.showLibrary);
}

/**
 * The block as the reader gets it.
 *
 * Markdown joins lines that are not separated by a blank line into one
 * paragraph, so "Sources:" followed by two file names on their own lines would
 * be drawn as a single run-on line. Two trailing spaces are a hard line break:
 * invisible in the stored text, and what keeps one source to a line on screen.
 */
function renderBlock(entries: LedgerEntry[], style: SourceStyle): string {
  const all = ["Sources:", ...entries.map((entry) => displayLine(entry, style))];
  return all.map((line, index) => (index < all.length - 1 ? `${line}  ` : line)).join("\n");
}

export type SourcesCheck = {
  /** The answer with its Sources block replaced by one the ledger backs, or removed. Untouched when it had none. */
  text: string;
  /** Lines of the block the ledger backs. Zero means the answer has no valid Sources block. */
  kept: number;
  /** Lines of the block that it did not, and that were dropped. */
  removed: number;
};

/**
 * Replaces an answer's closing Sources block with one the ledger backs.
 *
 * The block is the last bare "Sources" heading and the lines under it, up to
 * the first blank line (one blank line straight after the heading is allowed),
 * a code fence, another heading or a rule. Text after it is left as it is. A
 * "Sources: ..." line with its entry on the same line counts only as the last
 * line of the answer, where it can only be a closing block.
 *
 * Each line is kept only if it names a ledger entry, and is then written by
 * `renderBlock` in the workspace's style rather than copied. A line that names
 * nothing the ledger holds is dropped, whatever it says.
 */
export function checkSources(text: string, ledger: ProvenanceLedger, style: SourceStyle): SourcesCheck {
  const lines = text.split("\n");

  let lastContent = lines.length - 1;
  while (lastContent >= 0 && lines[lastContent].trim() === "") lastContent -= 1;

  let heading = -1;
  let inline: string | null = null;
  for (let index = lines.length - 1; index >= 0; index--) {
    if (BARE_HEADING.test(lines[index])) {
      heading = index;
      break;
    }
    if (index === lastContent) {
      const remainder = inlineRemainder(lines[index]);
      if (remainder !== null) {
        heading = index;
        inline = remainder;
        break;
      }
    }
  }
  if (heading === -1) return { text, kept: 0, removed: 0 };

  let start = heading + 1;
  let end = start;
  let blockLines: string[];
  if (inline !== null) {
    blockLines = [inline];
    end = heading + 1;
  } else {
    if (start < lines.length && lines[start].trim() === "" && start + 1 < lines.length && belongsToBlock(lines[start + 1])) {
      start += 1;
    }
    end = start;
    while (end < lines.length && belongsToBlock(lines[end])) end += 1;
    blockLines = lines.slice(start, end);
  }

  const known = spellings(ledger);
  const chosen = new Set<LedgerEntry>();
  let removed = 0;
  for (const raw of blockLines) {
    let entry: LedgerEntry | null = null;
    for (const candidate of candidateTexts(raw)) {
      const match = known.get(candidate);
      if (match) {
        entry = match;
        break;
      }
    }
    if (entry) chosen.add(entry);
    else removed += 1;
  }

  const before = lines.slice(0, heading).join("\n").trimEnd();
  const after = lines.slice(end).join("\n").trim();
  const block = chosen.size > 0 ? renderBlock([...chosen], style) : "";
  const rebuilt = [before, block, after].filter((part) => part.length > 0).join("\n\n");
  return { text: rebuilt, kept: chosen.size, removed };
}

/** The most lines a correction lists: a run that retrieved more than this is not one anyone is asking to read. */
const MAX_CORRECTION_LINES = 50;

/**
 * What the model is told when it answered from documents and closed without a
 * Sources block the ledger could back. It lists exactly what may be cited, so
 * the second attempt does not have to guess how a line is written.
 */
export function sourcesCorrection(ledger: ProvenanceLedger, style: SourceStyle): string {
  const lines = ledger
    .entries()
    .map((entry) => plainLine(entry, style))
    .slice(0, MAX_CORRECTION_LINES);
  return (
    "Your answer drew on documents but did not end with a Sources block. Write the answer again and finish it " +
    'with a Sources block: the line "Sources:" and then one line for each source you relied on, using only ' +
    `these lines, copied exactly:\n\n${lines.join("\n")}\n\n` +
    "If your answer relied on none of them, give the same answer and leave the block out."
  );
}
