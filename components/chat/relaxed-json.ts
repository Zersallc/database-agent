/**
 * Parsing the JSON-ish payloads the model writes into fenced blocks.
 *
 * Every interactive block in `Markdown.tsx` is gated on its payload parsing:
 * a ```chart that fails `JSON.parse` falls back to a plain code block, so the
 * reader gets the ECharts option as text instead of a chart. Which is exactly
 * what happens whenever the model writes that option the way ECharts' own
 * documentation writes it —
 *
 *     { title: { text: 'Observations by Category' }, series: [{ type: 'bar' }] }
 *
 * — a JavaScript object literal, not JSON. It is the same object either way;
 * only the quoting differs, and the reader loses the whole chart over it. The
 * prompt asks for strict JSON and usually gets it, but "usually" is not a
 * rendering contract, so accept the literal form too: single-quoted strings,
 * unquoted keys, trailing commas, and comments.
 *
 * This is a rewrite to strict JSON, not an evaluator — nothing here executes
 * the block's contents, and anything it cannot make sense of still fails the
 * parse and falls back the way it did before.
 */

const IDENTIFIER_START = /[A-Za-z_$]/;
const IDENTIFIER_PART = /[A-Za-z0-9_$]/;

const STRING_ESCAPES: Record<string, string> = {
  n: "\n",
  t: "\t",
  r: "\r",
  b: "\b",
  f: "\f",
  v: "\v",
  "0": "\0",
};

/**
 * Reads one quoted string starting at `start`, in either quote style, and
 * returns its decoded value plus the index just past the closing quote.
 *
 * Decoding rather than copying is what makes the rewrite safe: the value goes
 * back out through `JSON.stringify`, so a `'` inside a double-quoted string, a
 * `"` inside a single-quoted one, and an already-escaped sequence all come out
 * correctly escaped for JSON without any of them being special-cased here.
 */
function readString(source: string, start: number): { value: string; next: number } {
  const quote = source[start];
  let value = "";
  let i = start + 1;

  while (i < source.length) {
    const ch = source[i];

    if (ch === "\\") {
      const escape = source[i + 1];
      if (escape === "u" && /^[0-9a-fA-F]{4}$/.test(source.slice(i + 2, i + 6))) {
        value += String.fromCharCode(parseInt(source.slice(i + 2, i + 6), 16));
        i += 6;
        continue;
      }
      // An escape with no special meaning stands for the character itself,
      // which is how `\'` and `\/` survive the trip.
      value += STRING_ESCAPES[escape] ?? escape ?? "";
      i += 2;
      continue;
    }

    if (ch === quote) return { value, next: i + 1 };

    value += ch;
    i++;
  }

  // Unterminated — a half-streamed block, most likely. Hand back what there is
  // and let the parse fail; the caller falls back to rendering it as text
  // until the rest of the tokens arrive.
  return { value, next: i };
}

/** Index of the next character that is neither whitespace nor a comment. */
function skipFiller(source: string, from: number): number {
  let i = from;

  while (i < source.length) {
    const ch = source[i];

    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }
    if (ch === "/" && source[i + 1] === "/") {
      const end = source.indexOf("\n", i + 2);
      i = end === -1 ? source.length : end + 1;
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    break;
  }

  return i;
}

/**
 * Rewrites JavaScript object-literal syntax into the equivalent strict JSON.
 *
 * Structure outside strings is copied through untouched; the scanner exists
 * only so that a `{`, `:` or `,` *inside* a string — `formatter: '{b}: {c}'`
 * is a real ECharts option and full of them — is never mistaken for syntax.
 */
function toStrictJson(source: string): string {
  let out = "";
  let i = 0;

  while (i < source.length) {
    const ch = source[i];

    if (ch === '"' || ch === "'") {
      const { value, next } = readString(source, i);
      out += JSON.stringify(value);
      i = next;
      continue;
    }

    if (ch === "/" && (source[i + 1] === "/" || source[i + 1] === "*")) {
      i = skipFiller(source, i);
      continue;
    }

    if (ch === ",") {
      // A trailing comma is legal JavaScript and not legal JSON.
      const next = skipFiller(source, i + 1);
      if (source[next] === "}" || source[next] === "]") {
        i = next;
        continue;
      }
      out += ",";
      i++;
      continue;
    }

    if (IDENTIFIER_START.test(ch)) {
      let end = i;
      while (end < source.length && IDENTIFIER_PART.test(source[end])) end++;
      const word = source.slice(i, end);
      // Unquoted keys are the common case. A bare word somewhere a value
      // belongs is far more likely to be an unquoted string than anything
      // else, so quoting both is the same rule and the right one.
      out +=
        word === "true" || word === "false" || word === "null"
          ? word
          : JSON.stringify(word);
      i = end;
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

/**
 * `JSON.parse`, falling back to the object-literal rewrite above, and to
 * `null` when neither reading works.
 */
export function parseRelaxedJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    // Not strict JSON — try reading it as an object literal below.
  }

  try {
    return JSON.parse(toStrictJson(text)) as T;
  } catch {
    return null;
  }
}

/**
 * Whether a payload the model tagged something other than `chart` is in fact
 * an ECharts option.
 *
 * `series` is the tell: no ECharts option draws anything without one, and no
 * result set the other handlers expect carries one. The prompt asks for a
 * `chart` fence and this is the half that does not depend on the model
 * remembering — a chart written under a `json` fence is still a chart, and
 * printing its option object at the reader is never the intended answer.
 */
export function asChartOption(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const option = value as Record<string, unknown>;
  const series = option.series;
  const hasSeries = Array.isArray(series)
    ? series.length > 0
    : typeof series === "object" && series !== null;

  return hasSeries ? option : null;
}
