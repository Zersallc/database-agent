/**
 * Idempotency for creates.
 *
 * Networks fail after the server has already done the work. Without this, every
 * integrator eventually double-creates a connection, double-charges a query
 * budget, or double-posts a message — and they discover it in production, not
 * in testing.
 *
 * The rule: same key + same body returns the original response and sets
 * `Idempotent-Replay: true`. Same key + *different* body is a 409, because that
 * is not a retry, it is a client bug, and silently answering one of the two
 * requests would hide it.
 *
 * A request still in flight also 409s. Two concurrent attempts with one key
 * means the client raced itself; telling it to retry is safer than running the
 * side effect twice.
 */

import { ApiError } from "./errors";
import { stores } from "@/lib/providers";

const TTL_SECONDS = 24 * 60 * 60;

type Record_ =
  | { state: "in_progress"; fingerprint: string }
  | { state: "complete"; fingerprint: string; status: number; body: unknown };

export type IdempotencyOutcome<T> =
  | { replayed: false; commit: (status: number, body: T) => Promise<void> }
  | { replayed: true; status: number; body: T };

/** Body fingerprint, so a replay with different content can be detected. */
async function fingerprint(route: string, body: unknown): Promise<string> {
  const canonical = `${route}\n${stableStringify(body)}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Buffer.from(digest).toString("base64url");
}

/** Key order must not change the fingerprint — clients serialize objects however they like. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(",")}}`;
}

export function readIdempotencyKey(request: Request): string {
  const key = request.headers.get("Idempotency-Key")?.trim();
  if (!key) {
    throw new ApiError(
      "missing_idempotency_key",
      "This endpoint requires an 'Idempotency-Key' header so a retried request cannot create the resource twice. Send any unique string, such as a UUID."
    );
  }
  if (key.length > 255) {
    throw new ApiError("invalid_request", "'Idempotency-Key' must be at most 255 characters.");
  }
  return key;
}

/**
 * Claims the key. On a fresh key you get a `commit` to call once the work has
 * succeeded; on a repeat you get the stored response to return verbatim.
 *
 * `commit` is deliberately called *after* the operation rather than before: if
 * the handler throws, nothing is stored and the client is free to retry the
 * same key. Only successful responses are replayable.
 */
export async function beginIdempotent<T>(
  tenantId: string,
  route: string,
  key: string,
  body: unknown
): Promise<IdempotencyOutcome<T>> {
  const { kv } = stores();
  const storageKey = `idem:${tenantId}:${route}:${key}`;
  const print = await fingerprint(route, body);

  const claimed = await kv.setIfAbsent<Record_>(
    storageKey,
    { state: "in_progress", fingerprint: print },
    TTL_SECONDS
  );

  if (claimed) {
    return {
      replayed: false,
      commit: async (status, value) => {
        await kv.set<Record_>(
          storageKey,
          { state: "complete", fingerprint: print, status, body: value },
          TTL_SECONDS
        );
      },
    };
  }

  const existing = await kv.get<Record_>(storageKey);
  if (!existing) {
    // The record expired between the claim attempt and this read. Treating it
    // as fresh is the right call: the original response is gone anyway.
    return {
      replayed: false,
      commit: async (status, value) => {
        await kv.set<Record_>(
          storageKey,
          { state: "complete", fingerprint: print, status, body: value },
          TTL_SECONDS
        );
      },
    };
  }

  if (existing.fingerprint !== print) {
    throw new ApiError(
      "idempotency_key_reused",
      `Idempotency-Key '${key}' was already used with a different request body. Use a new key for a new request, and reuse a key only to retry the exact same one.`
    );
  }

  if (existing.state === "in_progress") {
    throw new ApiError(
      "resource_conflict",
      `A request with Idempotency-Key '${key}' is still being processed. Retry in a moment.`,
      { retryAfter: 2 }
    );
  }

  return { replayed: true, status: existing.status, body: existing.body as T };
}
