/**
 * Document libraries as the agent sees them.
 *
 * The principle this file exists to keep: the model decides WHETHER to search
 * documents and WITH WHAT WORDS. It never decides WHERE. A library is handed to
 * the agent already resolved by the application, with the credentials, the
 * address and the syslab key sealed inside its `search` function, so there is
 * nothing here for a model to name, guess or override except a library's
 * display name, and that is checked against the set the application built.
 *
 * A tool's `enum` is advice to the model, not a check: a model can emit any
 * string. The check is `resolveLibrary`, which runs on every call.
 */

import type { ToolDefinition } from "./providers/types";

export const SEARCH_DOCUMENTS_TOOL_NAME = "search_documents";

/** Never longer than this reaches a prompt. */
const MAX_DESCRIPTION_CHARS = 300;

/**
 * The C0 control characters and DEL, built from their code points so that this
 * source file holds none of them. Line and paragraph separators are ordinary
 * whitespace to `\s`, which the second pass in `sanitizeDescription` collapses.
 */
const CONTROL_CHARACTERS = new RegExp(
  "[" + String.fromCharCode(0) + "-" + String.fromCharCode(31) + String.fromCharCode(127) + "]+",
  "g"
);

export type DocumentSearchResult = {
  passages: { source: string; text: string; found_by: string[] }[];
  coverage: { searched: number; matched: number; returned: number };
  what_this_means: string;
};

/**
 * One library the current user's workspace may search.
 *
 * `search` takes the question and nothing else. Which server, which key and
 * which credential it uses were fixed by the application when it built this
 * object; none of them is a parameter, so none can be supplied by a model.
 */
export type AgentLibrary = {
  /** What the model calls it. Chosen by an administrator, shown as data. */
  name: string;
  /** What it holds, in an administrator's words. Optional. */
  description: string | null;
  search: (query: string) => Promise<DocumentSearchResult>;
};

/**
 * Why a search failed, in the only terms a model or a browser is told.
 *
 * A failure's real cause (the server's address, its reply, which token was
 * refused) is for an operator's log. What crosses to the model and to the
 * person reading the chat is one of these sentences and nothing derived from
 * the underlying error.
 */
export type DocumentSearchCategory = "not_configured" | "not_linked" | "auth" | "unavailable" | "timeout";

export const DOCUMENT_SEARCH_MESSAGES: Record<DocumentSearchCategory | "unknown", string> = {
  not_configured: "Document search is not set up for this workspace.",
  not_linked: "This document library is not linked to its documents yet.",
  auth: "The document service refused the request.",
  unavailable: "The document service could not be reached.",
  timeout: "The document service took too long to answer.",
  unknown: "The document search failed unexpectedly.",
};

export class DocumentSearchError extends Error {
  readonly category: DocumentSearchCategory;

  constructor(category: DocumentSearchCategory) {
    super(DOCUMENT_SEARCH_MESSAGES[category]);
    this.name = "DocumentSearchError";
    this.category = category;
  }
}

/**
 * The sentence to show for any failure. Only a `DocumentSearchError` carries a
 * message that was written to be shown; anything else is reduced to the
 * generic line, because an unknown error's text can contain anything.
 */
export function describeSearchFailure(error: unknown): string {
  return error instanceof DocumentSearchError ? error.message : DOCUMENT_SEARCH_MESSAGES.unknown;
}

/**
 * An administrator's description, made safe to place in a prompt.
 *
 * It ends up inside the system prompt on every turn, so it is reduced to one
 * short line of plain text: control characters and line breaks collapse to
 * spaces (a description cannot start a new heading or a new instruction line),
 * and it is capped. Nothing here strips words: a description that says
 * something odd is the administrator's to fix, and it is shown quoted as data.
 */
export function sanitizeDescription(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.replace(CONTROL_CHARACTERS, " ").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > MAX_DESCRIPTION_CHARS ? text.slice(0, MAX_DESCRIPTION_CHARS - 1).trimEnd() + "…" : text;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Display names, once each however they are cased, in the order the workspace has them. */
export function libraryNames(libraries: readonly { name: string }[]): string[] {
  const names: string[] = [];
  for (const library of libraries) {
    if (!names.some((existing) => same(existing, library.name))) names.push(library.name.trim());
  }
  return names;
}

/**
 * `library` exists only when there is a choice to make, exactly as `database`
 * does on `run_sql`: asking the model to name the one thing it already has
 * would cost tokens for nothing.
 */
export function buildSearchDocumentsTool(libraries: readonly AgentLibrary[]): ToolDefinition {
  const names = libraryNames(libraries);
  const multiple = libraries.length > 1;
  return {
    name: SEARCH_DOCUMENTS_TOOL_NAME,
    description:
      (multiple
        ? "Search one of this workspace's document libraries for passages that bear on a question. " +
          'Say which one with "library". '
        : "Search this workspace's document library for passages that bear on a question. ") +
      "Use it for what a document says: a clause, term, obligation or policy. " +
      "Never use it for counts, totals or other figures, which the database holds and run_sql answers. " +
      "Search with the most relevant words of the request. It returns passages, not whole documents, " +
      "and it cannot list what a library contains.",
    parameters: {
      type: "object",
      properties: {
        ...(multiple
          ? {
              library: {
                type: "string",
                enum: names,
                description: `Exact library name, one of: ${names.join(", ")}.`,
              },
            }
          : {}),
        query: { type: "string", description: "What to search for, in natural language." },
      },
      required: multiple ? ["library", "query"] : ["query"],
      additionalProperties: false,
    },
  };
}

export type LibraryResolution = { library: AgentLibrary } | { error: string };

/**
 * Which library does this call mean, among the ones this run was given?
 *
 * The only input a model contributes is a display name, and it is matched
 * against the authorized set and nothing else. An unknown name, a missing one
 * when there is a choice, and a name two libraries share (which would mean
 * picking one for the model) are all refused, and the refusal names only
 * libraries the caller may use.
 *
 * With exactly one library there is nothing to choose, so a name the model
 * volunteers is ignored rather than trusted or refused.
 */
export function resolveLibrary(libraries: readonly AgentLibrary[], requested: unknown): LibraryResolution {
  if (libraries.length === 0) return { error: "Document search is not available in this workspace." };
  if (libraries.length === 1) return { library: libraries[0] };

  const available = libraryNames(libraries).join(", ");
  const wanted = typeof requested === "string" ? requested.trim() : "";
  if (!wanted) return { error: `Say which library to search with "library". Available: ${available}.` };

  const matches = libraries.filter((library) => same(library.name, wanted));
  if (matches.length === 1) return { library: matches[0] };
  if (matches.length > 1) {
    return {
      error:
        `More than one library is named "${matches[0].name.trim()}", so it cannot be chosen safely. ` +
        "Tell the user the libraries need distinct names.",
    };
  }
  return { error: `No document library named ${JSON.stringify(wanted.slice(0, 80))}. Available: ${available}.` };
}
