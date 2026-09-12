/**
 * Evidence for an absence.
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
