/**
 * Which of the ways a run can end is the model's, and which is the measuring
 * equipment's.
 *
 * A pass rate is only about the model if the runs behind it were the model's to
 * pass or fail. A gateway that rate-limits partway through a suite produces
 * runs that failed for a reason with nothing to do with any case, and counting
 * them as failures makes a busy server look like a regression. So every failed
 * run is classified here, from what the provider actually said, before anyone
 * grades anything.
 *
 * The rules are about the HTTP status the provider returned, captured at the
 * client before the agent loop turns it into a message (see `meter.ts`). The
 * loop's own text is not read: it says "rate limiting" for a 429 and "the model
 * provider failed: <whatever>" for everything else, and matching on prose is how
 * a wording change becomes a wrong number.
 */

import type { RunFailure, RunStatus } from "./types";

/** What the provider (or the network in front of it) answered, as seen at the client. */
export type ProviderError = { status: number | undefined; message: string };

export type Classification = {
  status: RunStatus;
  /**
   * A setup mistake, which every later run would reproduce identically: a
   * rejected key, or a model name the server does not serve. The suite stops on
   * these rather than spending its remaining runs proving the same 404.
   */
  setup: boolean;
  http_status: number | null;
};

export function classifyRun(failure: RunFailure | null, provider: ProviderError | null): Classification {
  const http_status = provider?.status ?? null;
  if (!failure) return { status: "valid", setup: false, http_status };

  if (provider?.status === 429 || (failure.retryAfter !== null && !provider)) {
    return { status: "rate_limited", setup: false, http_status };
  }

  if (provider) {
    const { status } = provider;
    // Credentials, or a model the server does not serve: nothing later will differ.
    if (status === 401 || status === 403 || status === 404) {
      return { status: "execution_failure", setup: true, http_status };
    }
    // The provider or the network did not answer: no status at all (a refused
    // connection, a reset, a timeout, a stream that ended early), a server
    // error, or a request timeout.
    if (status === undefined || status >= 500 || status === 408) {
      return { status: "infrastructure", setup: false, http_status };
    }
    // Any other 4xx is the provider rejecting what was sent, which is not the
    // network's fault and not the model's either.
    return { status: "execution_failure", setup: false, http_status };
  }

  // The loop failed without the provider erroring: a refusal, a reply cut off at
  // the output limit, or something inside the agent itself.
  return { status: "execution_failure", setup: false, http_status };
}

/** The status and message of an error thrown from a model client, however it was thrown. */
export function providerErrorOf(error: unknown): ProviderError {
  const status = (error as { status?: unknown } | null)?.status;
  return {
    status: typeof status === "number" ? status : undefined,
    message: error instanceof Error ? error.message : String(error),
  };
}
