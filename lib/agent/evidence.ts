/**
 * Evidence for a claim the rows cannot carry.
 *
 * Mostly an absence — the claim this codebase cannot check by reading the
 * answer — and, at the bottom of the file, its mirror image: a ranking whose
 * top row is not the winner it looks like. Both are cases where the SQL ran
 * cleanly, the rows came back, the model read them correctly, and the sentence
 * it wrote about them is still false. Nothing in the prose gives that away, so
 * the check has to happen against the query and the result instead.
 *
 * "No observations match that" is the one claim this codebase cannot check by
 * reading the answer. It carries no figure to trace and promises no action, so
 * it looks exactly like a grounded reply — and the retry in `index.ts` says as
 * much in its own comment: that one is not a detector's to solve.
 *
 * What separates a true absence from a missed guess is not in the sentence at
 * all. It is in the query. A value the database has shown us, filtered on and
 * matching nothing, is an absence worth reporting. A value the model spelled
 * from the reader's wording, filtered on and matching nothing, is a guess that
 * missed — and both produce the same empty result and the same sentence.
 *
 * So the check moves off the prose and onto the literal: before an empty result
 * may be reported as "there is none", something the database said has to vouch
 * for the value that was filtered on.
 *
 * Deliberately NOT a source of vouching: the reader's question. A figure the
 * reader supplies is theirs to state, which is why `grounded` in the agent loop
 * counts the question — quoting a number back is not fabrication. A category the
 * reader names is the opposite case. Their wording is precisely the guess under
 * suspicion, and letting the question vouch for it would switch this off in
 * exactly the situation it exists for.
 */

/** A comparison whose right-hand side is a value the query expects to match. */
const COMPARED_LITERAL = /(?:=|<>|!=|~~\*?|\bI?LIKE\b)\s*'((?:[^']|'')*)'/gi;

/** `IN ('a', 'b')` — the same comparison written as a list. */
const IN_LIST = /\bIN\s*\(\s*('(?:[^']|'')*'(?:\s*,\s*'(?:[^']|'')*')*)\s*\)/gi;

const LITERAL = /'((?:[^']|'')*)'/g;

/**
 * Long text does not vouch for anything.
 *
 * A free-text comment holds hundreds of words, and letting it vouch would mean
 * any literal appearing anywhere in any narrative counted as confirmed. The cap
 * keeps vouching to the kind of value a column is actually filtered on.
 */
const MAX_VOUCHING_LENGTH = 120;

/**
 * A literal reduced to the part worth looking up, or null if there is nothing
 * to look up.
 *
 * Dates and numbers drop out: there is no alternative spelling of 2026-08-13
 * hiding in the column, so an empty result from one is a real absence and
 * nudging the model to go verify it would be noise. A pattern is judged on its
 * longest fixed run, so `'%health%'` is looked up as "health" and `'%a%b%'` —
 * which has nothing long enough to identify anything — is left alone.
 *
 * The date case is right about spelling and wrong about absence, which is why
 * `unqueriedDateColumns` below exists. A date has no alternative spelling, but
 * it does have an alternative *column*, and that is the same failure wearing
 * different clothes.
 */
function comparable(raw: string): string | null {
  const value = raw.replace(/''/g, "'").trim();
  if (!value) return null;
  if (/^[\d\s:.,+\/-]+$/.test(value) || /^\d{4}-\d{2}/.test(value)) return null;
  const core = value
    .split("%")
    .map((part) => part.trim())
    .sort((a, b) => b.length - a.length)[0];
  return core.length >= 2 ? core : null;
}

/**
 * The values this query compared a column against, in the spelling it used.
 *
 * Only literals in a comparison, never every literal in the statement: a format
 * string in `to_char(d, 'YYYY-MM')` and an interval in `'30 days'` are parts of
 * the query's machinery, not claims about what the data contains.
 */
export function filterLiteralsIn(sql: string): string[] {
  const found = new Map<string, string>();

  const keep = (raw: string) => {
    const value = comparable(raw);
    if (value) found.set(value.toLowerCase(), value);
  };

  for (const match of sql.matchAll(COMPARED_LITERAL)) keep(match[1]);
  for (const list of sql.matchAll(IN_LIST)) {
    for (const item of list[1].matchAll(LITERAL)) keep(item[1]);
  }

  return [...found.values()];
}

/**
 * Which of those values nothing has vouched for.
 *
 * Substring rather than equality, and in that direction on purpose. A pattern
 * search for "health" is vouched by the value `Health or Hygiene or Ergonomic
 * Hazards` — the query found the real thing and came back empty for some other
 * reason, which is a genuine absence. The reverse is the failure this exists to
 * catch: `Health Hazards` is not a substring of the real value, so nothing
 * vouches for it, and the empty result it produced means the spelling missed.
 */
export function unvouchedLiterals(sql: string, vouched: ReadonlySet<string>): string[] {
  const literals = filterLiteralsIn(sql);
  if (literals.length === 0) return [];

  const known = [...vouched];
  return literals.filter((literal) => {
    const probe = literal.toLowerCase();
    return !vouched.has(probe) && !known.some((value) => value.includes(probe));
  });
}

/**
 * Did this result find anything?
 *
 * Not the same question as "did it return rows", and the difference is the
 * commonest shape of the bug: `SELECT count(*) ... WHERE "c" = 'guess'` comes
 * back as one row holding zero. By row count that is data; to the reader it is
 * the same nothing as an empty SELECT, and the model will report it as one.
 *
 * Reading it as data is not harmless. It makes the contradiction check in the
 * loop tell the model "your last query returned 1 row, so the data is there"
 * about a count of zero — an assertion that is simply untrue, made to argue
 * down an answer that was right.
 */
export function foundNothing(rows: unknown[][], rowCount: number): boolean {
  if (rowCount === 0) return true;
  if (rows.length !== 1) return false;
  return rows[0].every((cell) => cell === null || cell === undefined || cell === 0 || cell === "0" || cell === "");
}

/** A date-shaped literal on the right of a comparison — `>= '2026-09-11'`, `BETWEEN '2026-08-01' AND …`. */
const COMPARED_DATE = /(?:>=|<=|<>|!=|=|>|<|\bBETWEEN\b|\bAND\b)\s*'(\d{4}-\d{2}[^']*)'/i;

/** Does this query pin anything to a calendar date at all? */
export function comparesADate(sql: string): boolean {
  return COMPARED_DATE.test(sql);
}

/**
 * A query that dated its rows by one column while the table dates them several
 * ways, and found nothing.
 *
 * The bug this exists for: asked to open "the September 11 one" — a row the
 * previous turn had listed under that date — the model filtered `"Date"` to
 * September 11 and got nothing back, because the row's `"Date"` is the 10th and
 * only its `"Timestamp"` is the 11th. One table, one row, four date columns
 * (`"Timestamp"`, `"Date"`, `"Last Edited DateTime"`, `"Closer DateTime"`), and
 * the day the reader said belonged to a different one than the day the query
 * asked about.
 *
 * Every other check here was structurally blind to it. `unvouchedLiterals`
 * drops date literals by design; `dateColumnMismatchNote` looks for a text
 * column and `"Date"` really is a timestamp; the contradiction check compares
 * the claim against the row count and the row count really was zero. Nothing
 * was misspelled, mistyped, or misread. The query was well-formed and asked the
 * wrong column, which is visible only in the schema — so, like the type
 * mismatch, it is checked here in code rather than left to a reasoning pass the
 * model may not be running.
 *
 * Membership is by name appearing anywhere in the statement rather than by
 * parsing the WHERE clause, which costs nothing and survives every spelling of
 * the comparison — `DATE_TRUNC('day', "Date") = …`, `"Date"::date`, `BETWEEN`,
 * `EXTRACT`. A date column named in the SELECT list but not filtered is read as
 * filtered; that only makes this quieter, never wrong.
 */
export function unqueriedDateColumns(
  sql: string,
  dateColumns: string[]
): { filtered: string[]; others: string[] } | null {
  if (dateColumns.length < 2 || !comparesADate(sql)) return null;

  const haystack = sql.toLowerCase();
  const filtered: string[] = [];
  const others: string[] = [];
  for (const column of dateColumns) {
    (haystack.includes(column.toLowerCase()) ? filtered : others).push(column);
  }

  return filtered.length > 0 && others.length > 0 ? { filtered, others } : null;
}

/**
 * What an empty date filter does not establish, said next to the empty result.
 *
 * The same move as `unverifiedFilterNote` and for the same reason: by the time
 * the prose says "no observations were found for September 11", the reasoning
 * that produced it has already happened, and a sentence in the system prompt
 * competing with everything else there is not what stops it.
 */
export function otherDateColumnsNote(filtered: string[], others: string[]): string {
  const list = (names: string[]) => names.map((name) => `"${name}"`).join(", ");
  const one = filtered.length === 1;
  return (
    `Nothing matched, and this query dated the rows by ${list(filtered)} alone. This table also dates ` +
    `them by ${list(others)}. Those are different events on the same row — when it was recorded, when ` +
    `it happened, when it was last touched — and they routinely fall on different days, so a row can sit ` +
    `inside your window on one of them and outside it on ${one ? "the one you filtered" : "the ones you filtered"}. ` +
    `An empty result here is that column's answer, not the table's. Before telling the reader there is no ` +
    `such row: if the date came from rows already shown in this conversation, go back and find that row by ` +
    `the identifier it came with rather than by its date — the row is already in front of you and its key ` +
    `cannot miss. If the date came from the reader, try the other date columns before concluding nothing ` +
    `is there, and say which column you dated the answer by.`
  );
}

/** Values from a result, in the form the vouching set holds them. */
export function vouchedFrom(rows: unknown[][]): string[] {
  const values: string[] = [];
  for (const row of rows) {
    for (const cell of row) {
      if (typeof cell !== "string") continue;
      const value = cell.trim().toLowerCase();
      if (value && value.length <= MAX_VOUCHING_LENGTH) values.push(value);
    }
  }
  return values;
}

/**
 * What an empty result does not establish, said next to the empty result.
 *
 * The same move as `samplingNote`: a fact in the payload the model is already
 * reading, rather than another sentence in a system prompt competing with
 * everything else there. This is the half of the fix that works before the
 * answer exists — by the time prose says "there is none", the reasoning that
 * produced it has already happened.
 */
export function unverifiedFilterNote(values: string[]): string {
  const one = values.length === 1;
  const quoted = values.map((value) => `'${value}'`).join(", ");
  return (
    `Nothing matched, and ${one ? "the value" : "the values"} this query filtered on — ${quoted} — ` +
    `${one ? "is" : "are"} not something this database has shown you: not in the schema's list of ` +
    `values for any column, and not in any result you have read in this conversation. An empty result ` +
    `from a value you spelled yourself means the spelling missed, not that nothing is there. Look at ` +
    `what the column actually holds — SELECT DISTINCT on it, or a case-insensitive LIKE — and filter on ` +
    `a value from that list before telling the reader there is none.`
  );
}

/**
 * Keywords inside quoted text are not keywords. Blank the literals first.
 *
 * Both kinds: a column genuinely named `"Group By Area"` would otherwise make
 * every query that selects it look like an aggregate.
 */
export function withoutLiterals(sql: string): string {
  return sql.replace(/'(?:[^']|'')*'/g, "''").replace(/"(?:[^"]|"")*"/g, '""');
}

/**
 * A ranking query: it groups the rows, counts each group, and puts the biggest
 * first. The shape of every "which is the most common" question there is.
 */
export function ranksByCount(sql: string): boolean {
  const bare = withoutLiterals(sql).toLowerCase();
  return (
    /\bgroup\s+by\b/.test(bare) &&
    /\border\s+by\b/.test(bare) &&
    /\bdesc\b/.test(bare) &&
    /\bcount\s*\(/.test(bare)
  );
}

/** A count from a result cell, however the driver typed it — a bigint arrives as a string. */
function asCount(value: unknown): number | null {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return Number.isInteger(value) && value >= 0 ? value : null;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

/** Result columns that could be the tally: a non-negative integer in every row. */
function countCandidates(columns: string[], rows: unknown[][]): number[] {
  const candidates: number[] = [];
  for (let index = 0; index < columns.length; index++) {
    if (rows.every((row) => asCount(row[index]) !== null)) candidates.push(index);
  }
  return candidates;
}

/** The leading `ORDER BY <target> DESC`, read off the statement. */
const ORDER_BY_DESC = /\border\s+by\s+([\s\S]+?)\s+desc\b/i;

/**
 * Which result column this ranking is actually ordered by, or null if that is
 * not a tally at all.
 *
 * The ORDER BY is read from the raw statement rather than the blanked one
 * because the target is frequently a quoted identifier — `ORDER BY "count"
 * DESC` — and blanking the quotes would erase the very thing being looked up.
 *
 * Returning null when the sort resolves to a column that is not a tally is the
 * point of reading it at all: a result ordered by date that happens to carry a
 * `count(*)` alongside is not a frequency ranking, and a 1 in that column means
 * nothing about which value is commonest.
 */
function rankedColumn(sql: string, columns: string[], rows: unknown[][]): number | null {
  const candidates = countCandidates(columns, rows);
  if (candidates.length === 0) return null;

  const target = ORDER_BY_DESC.exec(sql)?.[1]?.trim() ?? "";

  if (/^\d+$/.test(target)) {
    const ordinal = Number(target) - 1;
    return candidates.includes(ordinal) ? ordinal : null;
  }

  const named = target.replace(/^"([\s\S]*)"$/, "$1").replace(/""/g, '"').toLowerCase();
  const byName = columns.findIndex((column) => column.toLowerCase() === named);
  if (byName !== -1) return candidates.includes(byName) ? byName : null;

  // An expression rather than a name — `ORDER BY COUNT(*) DESC`. Take the
  // column that says it is a count, else the last tally, which is where an
  // aggregate conventionally sits.
  const byLabel = candidates.find((index) => /count|freq|tally|total|occurrence|times/i.test(columns[index]));
  return byLabel ?? candidates[candidates.length - 1];
}

export type RankingWithoutAWinner = {
  /** The tally the top group came back with. */
  count: number;
  /** How many of the returned groups share it. */
  tied: number;
  /** The column the rows were grouped by, as the result labelled it. */
  groupedBy: string | null;
  /** The top group's key is NULL: the rows where that column is empty, not a value. */
  topKeyIsNull: boolean;
  /** The top tally is 1, so nothing repeats and there is no most-common value at all. */
  nothingRepeats: boolean;
};

/**
 * A ranking whose top row is not the winner it looks like.
 *
 * The incident: asked for "the most used observation", the model grouped
 * `"Observation or Finding"` — a free-text column holding one narrative
 * sentence per record — counted each group, ordered by the count descending,
 * took the first, and reported "the most used observation is 'Acid plant motor
 * complete rusted…', which was recorded once." The count was 1. With the rows
 * ordered by count descending, a top count of 1 means 1 is the maximum: every
 * value occurs exactly once, there is no most-used anything, and the row that
 * came back is whichever of the hundreds of ties the engine reached first. The
 * same question a month wider returned a NULL key with a count of 1, and that
 * answer generalised from the single group to "the data is incomplete".
 *
 * Every existing check was structurally blind to it, and not by oversight. The
 * query was well-formed and ran. It returned a row, so `foundNothing` is false
 * and the contradiction branch would have insisted the data was there. The
 * filter was a date, which `comparable` drops. `samplingNote` wants a LIMIT
 * with no ORDER BY, and this query has both — an ORDER BY that sorts nothing,
 * because every key it compares is equal. The value quoted in the answer came
 * out of a real result, so `quotesUngroundedValue` passes it, and the figure
 * was a real 1. Read correctly, every one of them; the error is entirely in
 * what the sentence claims of a tie.
 *
 * So it is checked here, against the result, rather than left to a reasoning
 * pass — which with `enableThinking` off does not happen at all.
 */
export function rankingWithoutAWinner(
  sql: string,
  columns: string[],
  rows: unknown[][]
): RankingWithoutAWinner | null {
  if (rows.length === 0 || !ranksByCount(sql)) return null;

  const index = rankedColumn(sql, columns, rows);
  if (index === null) return null;

  const counts = rows.map((row) => asCount(row[index]));
  const top = counts[0];
  if (top === null) return null;

  // Ordered descending, so the ties are the run at the front.
  let tied = 0;
  while (tied < counts.length && counts[tied] === top) tied++;

  const keyIndex = columns.findIndex((_, position) => position !== index);
  const topKey = keyIndex === -1 ? undefined : rows[0][keyIndex];
  const topKeyIsNull = keyIndex !== -1 && (topKey === null || topKey === undefined);
  const nothingRepeats = top === 1;

  if (!nothingRepeats && tied < 2 && !topKeyIsNull) return null;

  return {
    count: top,
    tied,
    groupedBy: keyIndex === -1 ? null : columns[keyIndex],
    topKeyIsNull,
    nothingRepeats,
  };
}

/**
 * What the top row of that ranking does not establish, said next to the row.
 *
 * The same move as `samplingNote` and `unverifiedFilterNote`, for the same
 * reason: by the time the prose says "the most used observation is X", the
 * reasoning that produced it has already happened, and a sentence in the
 * system prompt competing with everything else there is not what stops it.
 */
export function noWinnerNote(finding: RankingWithoutAWinner): string {
  const column = finding.groupedBy ? `"${finding.groupedBy}"` : "the grouped column";
  const parts: string[] = [];

  if (finding.nothingRepeats) {
    parts.push(
      `This ranking has no winner in it. The rows are ordered by their tally descending and the top one ` +
        `holds 1 row, which makes 1 the maximum: no value of ${column} occurs twice anywhere this query ` +
        `looked, so there is no most common, most frequent, most used or most reported one. The row that ` +
        `sorted first is whichever of the ties the engine reached first — any other row would have been ` +
        `equally true — so presenting it as the most used, the top, or the leading anything is a claim ` +
        `this result does not support, even with its count of 1 stated alongside. Free text has no mode: ` +
        `a description, finding, comment, title or id holds a distinct value per record, while a ` +
        `category, type, status, location or person repeats and can be counted. If the reader asked ` +
        `which was most common, group by a column whose values actually repeat and say which one you ` +
        `used, or tell them this column holds one distinct value per record so the question has no ` +
        `answer over it — and say which, rather than naming a tie as the answer.`
    );
  } else if (finding.tied > 1) {
    parts.push(
      `The top ${finding.tied} groups all hold ${finding.count} rows, so the one that sorted first is an ` +
        `arbitrary pick among equals rather than the single most common — which of them leads was decided ` +
        `by the engine, not by the data. Report it as a ${finding.tied}-way tie, or rank by something that ` +
        `distinguishes them, rather than calling the first one the most common.`
    );
  }

  if (finding.topKeyIsNull) {
    parts.push(
      `The top group's key is NULL, which is not a value: it is the rows where ${column} is empty. Those ` +
        `belong in an answer about missing data, said as missing, rather than standing in as the most ` +
        `common value — exclude them (${column} IS NOT NULL) or report them explicitly as rows with none. ` +
        `How much of the column is unpopulated is a count over the whole table and nothing this one group ` +
        `establishes: a NULL at the top of a ranking is not evidence that the field is unpopulated, or ` +
        `that the data is incomplete.`
    );
  }

  return parts.join(" ");
}
