/**
 * Fixture document libraries for the eval suite.
 *
 * A case declares what its documents say (`EvalLibrary`); this builds the
 * `AgentLibrary` the agent loop searches and keeps a log of every search and
 * every file returned. That log is what provenance is graded against, so it has
 * to come from what the fixture actually returned and nothing else.
 *
 * The retriever is a stand-in for syslab-server's hybrid search and is meant to
 * behave like it where behavior matters to a grade:
 *
 * - It returns only passages that match, and an empty list when none do, with
 *   the sentence the real service uses for that. A model that is told nothing
 *   matched must not read it as "the documents do not discuss this", and the
 *   real message says so; the fixture says the same.
 * - A document may carry `aliases`: words a paraphrase would use that the text
 *   does not. Real retrieval finds a passage about terminating a contract from
 *   a question about "ending the deal"; a keyword match over the text alone
 *   would not, and the miss would be counted against the model.
 *
 * It does not rank like the real thing and does not try to. What is measured
 * here is what the model does with what comes back.
 */

import type { AgentLibrary, DocumentSearchResult } from "@/lib/agent/libraries";

import type { EvalLibrary, SearchRecord } from "./types";

const STOPWORDS = new Set([
  "the", "and", "for", "are", "our", "does", "what", "how", "many", "much", "any", "all", "with", "that", "this",
  "have", "has", "from", "into", "about", "when", "where", "which", "who", "whom", "there", "their", "them",
  "they", "you", "your", "can", "could", "would", "should", "will", "was", "were", "been", "being", "say", "says",
  "tell", "show", "give", "get", "let", "please", "want", "need", "know", "not", "but", "its", "than", "then",
]);

/** A word reduced to a prefix, so "terminate", "terminated" and "termination" meet. */
function stem(word: string): string {
  return word.length > 5 ? word.slice(0, 5) : word;
}

function stems(text: string): Set<string> {
  const found = new Set<string>();
  for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    if (word.length < 3 || STOPWORDS.has(word)) continue;
    found.add(stem(word));
  }
  return found;
}

/** The most passages one search returns, like a small `k`. */
const MAX_PASSAGES = 3;

export function searchFixture(library: EvalLibrary, query: string): DocumentSearchResult {
  const wanted = stems(query);
  const scored = library.documents
    .map((document) => {
      const have = stems(`${document.text} ${(document.aliases ?? []).join(" ")}`);
      let score = 0;
      for (const word of wanted) if (have.has(word)) score += 1;
      return { document, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  const returned = scored.slice(0, MAX_PASSAGES);
  const coverage = { searched: library.documents.length, matched: scored.length, returned: returned.length };

  if (returned.length === 0) {
    return {
      passages: [],
      coverage,
      // The real service's sentence for this case, word for word.
      what_this_means:
        "Nothing in this customer's indexed passages matched those words. That is not evidence the material " +
        "does not discuss it: a paraphrase of words the document does not use will not be found by keyword search.",
    };
  }

  return {
    passages: returned.map(({ document }) => ({ source: document.file, text: document.text, found_by: ["keyword", "vector"] })),
    coverage,
    what_this_means:
      "These passages CONTAIN or RESEMBLE the words asked about. " +
      (returned.length < scored.length
        ? `This is a sample, not a census: ${returned.length} of ${scored.length} matching passages were returned.`
        : `All ${scored.length} matching passages were returned.`),
  };
}

/**
 * The libraries a run is given, each logging what is asked of it and what it
 * returns into `log`. The names are the fixtures' own, so a case and its
 * graders talk about the same libraries the model sees.
 */
export function buildFixtureLibraries(fixtures: EvalLibrary[], log: SearchRecord[]): AgentLibrary[] {
  return fixtures.map((fixture) => ({
    name: fixture.name,
    description: fixture.description,
    search: async (query: string) => {
      const result = searchFixture(fixture, query);
      log.push({ library: fixture.name, query, returned: result.passages.map((passage) => passage.source) });
      return result;
    },
  }));
}
