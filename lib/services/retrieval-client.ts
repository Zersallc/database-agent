/**
 * A thin client for syslab-server's retrieval plane, `POST /api/v1/retrieve`.
 *
 * Deliberately the same shape as `lib/agent/providers/openai-compatible.ts`:
 * raw `fetch`, an `AbortController` for the timeout, one error type. This is
 * one POST to one endpoint that already exists and is already frozen
 * (`syslab-server/scripts/check_api_compat.py`) — a client library would be a
 * dependency on a contract this file already owns completely.
 *
 * WHAT THIS MODULE DOES NOT DO: it does not embed, rank, fuse or store
 * anything. Every one of those is syslab-server's job (`app/vectors.py`,
 * `app/retrieve.py`); duplicating any of it here would be a second
 * implementation of something already built, tested and measured there.
 */

/**
 * What kind of failure this was, so a caller can decide what to tell someone
 * without reading the message. The message is for an operator's eyes: it can
 * carry the server's address and part of its reply, which is why nothing shown
 * to a model or a browser is built from it (see lib/services/document-search.ts).
 */
export type RetrievalErrorKind = "config" | "timeout" | "unreachable" | "http" | "malformed";

export class RetrievalError extends Error {
  readonly kind: RetrievalErrorKind;

  constructor(
    message: string,
    readonly status: number | undefined,
    options: { cause?: unknown; kind?: RetrievalErrorKind } = {}
  ) {
    super(message, { cause: options.cause });
    this.name = "RetrievalError";
    this.kind = options.kind ?? (status === undefined ? "unreachable" : "http");
  }
}

export type RetrievedPassage = {
  chunk_id: string;
  source: string;
  text: string;
  start: number;
  end: number;
  tokens: number;
  rank: number;
  found_by: string[];
};

export type RetrievalResult = {
  query: string;
  retrievers: string[];
  retrievers_unavailable: Record<string, string>;
  passages: RetrievedPassage[];
  coverage: { searched: number; matched: number; returned: number };
  tokens_returned: number;
  truncated: boolean;
  what_this_means: string;
};

export type RetrievalClientConfig = {
  /** syslab-server's retrieval plane, e.g. http://<host>:8080/api/v1 — no trailing slash required. */
  baseUrl: string;
  /** One value from that syslab-server's RETRIEVAL_TOKENS. */
  token: string;
};

/** Generous relative to a chat turn, since this is one call inside a tool loop the user is waiting on. */
const REQUEST_TIMEOUT_MS = Number(process.env.RETRIEVAL_REQUEST_TIMEOUT_MS ?? 15000);

export class RetrievalClient {
  private readonly baseUrl: string;

  constructor(private readonly config: RetrievalClientConfig) {
    if (!config.baseUrl) {
      throw new RetrievalError("RetrievalClient needs a base URL.", undefined, { kind: "config" });
    }
    if (!config.token) {
      throw new RetrievalError("RetrievalClient needs a token.", undefined, { kind: "config" });
    }
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
  }

  /**
   * `externalTenantId` is this system's key for one library, sent verbatim as
   * `X-Syslab-Tenant` — never validated or transformed here. syslab-server's own
   * plane.py is explicit that a foreign id is only ever a lookup key into its
   * `tenant_alias` table, keyed by (this system's name, this id); an operator
   * links it with `py scripts/tenant.py alias link <system> <externalTenantId> <their id>`.
   * An id with no link answers 404, which surfaces here as a RetrievalError
   * the same as any other non-2xx.
   *
   * The caller decides what the key is. For a media connection it is that
   * connection's own alias, read from the connection record on the server and
   * never from anything a model wrote.
   */
  async retrieve(
    query: string,
    externalTenantId: string,
    options: { k?: number; sources?: string[] | null } = {}
  ): Promise<RetrievalResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/retrieve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.token}`,
          "X-Syslab-Tenant": externalTenantId,
        },
        body: JSON.stringify({
          query,
          ...(options.k !== undefined ? { k: options.k } : {}),
          ...(options.sources !== undefined ? { sources: options.sources } : {}),
        }),
        signal: controller.signal,
      });
    } catch (cause) {
      if ((cause as Error).name === "AbortError") {
        throw new RetrievalError(
          `syslab-server did not answer within ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s.`,
          undefined,
          { cause, kind: "timeout" }
        );
      }
      throw new RetrievalError(`Could not reach ${this.baseUrl}: ${(cause as Error).message}`, undefined, {
        cause,
        kind: "unreachable",
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new RetrievalError(
        `syslab-server returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`,
        response.status
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (cause) {
      throw new RetrievalError("syslab-server returned something that is not JSON.", response.status, {
        cause,
        kind: "malformed",
      });
    }
    return body as RetrievalResult;
  }
}
