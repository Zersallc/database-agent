/**
 * Turns one media connection into the `search` function the agent is handed.
 *
 * Everything that decides where a search goes is fixed HERE, from the
 * connection record and the deployment's environment, and sealed inside the
 * returned function: the library's key (its `alias_id`), the server, the
 * token. The function takes a question and nothing else, so nothing a model
 * says can change any of it.
 *
 * It also owns what happens when a search fails. The underlying error (which
 * carries the server's address and part of its reply) is reduced to a
 * category, logged for an operator with the connection id, the category and
 * the HTTP status and nothing more, and replaced by a `DocumentSearchError`
 * whose message was written to be shown. The raw error never leaves this file.
 */

import {
  DocumentSearchError,
  type DocumentSearchCategory,
  type DocumentSearchResult,
} from "@/lib/agent/libraries";
import type { MediaConnectionDoc } from "./connections";
import { resolveMediaServer } from "./media-server";
import { RetrievalClient, RetrievalError } from "./retrieval-client";

type Env = Record<string, string | undefined>;

export function categorizeRetrievalFailure(error: unknown): DocumentSearchCategory {
  if (error instanceof RetrievalError) {
    if (error.kind === "config") return "not_configured";
    if (error.kind === "timeout") return "timeout";
    if (error.status === 404) return "not_linked";
    if (error.status === 401 || error.status === 403) return "auth";
  }
  return "unavailable";
}

export function searchFor(
  connection: MediaConnectionDoc,
  env: Env = process.env
): (query: string) => Promise<DocumentSearchResult> {
  // Read once, now, from the record. Not a parameter of the returned function.
  const key = connection.media.alias_id;
  const serverRef = connection.media.server_ref;

  return async (query) => {
    const server = resolveMediaServer(serverRef, env);
    if (!server) {
      console.error("[documents] search failed", { connection_id: connection.id, category: "not_configured", status: null });
      throw new DocumentSearchError("not_configured");
    }

    try {
      const client = new RetrievalClient({ baseUrl: server.baseUrl, token: server.token });
      const result = await client.retrieve(query, key);
      return {
        passages: result.passages.map((passage) => ({
          source: passage.source,
          text: passage.text,
          found_by: passage.found_by,
        })),
        coverage: result.coverage,
        what_this_means: result.what_this_means,
      };
    } catch (error) {
      const category = categorizeRetrievalFailure(error);
      console.error("[documents] search failed", {
        connection_id: connection.id,
        category,
        status: error instanceof RetrievalError ? (error.status ?? null) : null,
      });
      throw new DocumentSearchError(category);
    }
  };
}
