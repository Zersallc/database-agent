/**
 * Rate limiting.
 *
 * A limit the client cannot see is a limit the client will hit by surprise, so
 * every response carries the limit, what is left, and when it resets — not just
 * the 429. A well-behaved integrator should be able to pace itself without ever
 * seeing an error.
 *
 * Limits are per tenant per class, not global: one tenant's batch job must not
 * be able to throttle everyone else. The classes are separate because the costs
 * are wildly different — listing conversations is cheap, and an agent run is a
 * model call plus one or more database queries.
 *
 * This is a fixed window, which permits a burst of up to 2x across a window
 * boundary. That is an accepted trade: it costs one counter per tenant per
 * window instead of the per-request timestamp set a sliding window needs, and
 * the burst is bounded and brief. Move to a sliding window if the boundary
 * burst ever actually hurts.
 */

import { ApiError } from "./errors";
import { stores } from "@/lib/providers";

export type RateLimitClass = "read" | "write" | "query" | "run";

type Budget = { limit: number; windowSeconds: number };

const DEFAULT_BUDGETS: Record<RateLimitClass, Budget> = {
  read: { limit: 600, windowSeconds: 60 },
  write: { limit: 120, windowSeconds: 60 },
  query: { limit: 60, windowSeconds: 60 },
  run: { limit: 30, windowSeconds: 60 },
};

/**
 * Per-class overrides, e.g. `RATE_LIMIT_RUN=60`. Tenant-specific plans belong
 * on the tenant record; this is the deployment-wide default.
 */
function budgetFor(rateClass: RateLimitClass): Budget {
  const override = Number(process.env[`RATE_LIMIT_${rateClass.toUpperCase()}`]);
  const base = DEFAULT_BUDGETS[rateClass];
  return Number.isInteger(override) && override > 0 ? { ...base, limit: override } : base;
}

export type RateLimitState = {
  limit: number;
  remaining: number;
  /** Unix seconds at which the window resets. */
  reset: number;
};

export function rateLimitHeaders(state: RateLimitState): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(state.limit),
    "X-RateLimit-Remaining": String(state.remaining),
    "X-RateLimit-Reset": String(state.reset),
  };
}

/**
 * Counts this request against the tenant's budget.
 *
 * Returns the state to put on the response, or throws a 429 carrying
 * `Retry-After` — a concrete number of seconds, never a bare rejection the
 * client has to guess its way out of.
 */
export async function enforceRateLimit(
  tenantId: string,
  rateClass: RateLimitClass
): Promise<RateLimitState> {
  const { limit, windowSeconds } = budgetFor(rateClass);
  const window = Math.floor(Date.now() / (windowSeconds * 1000));
  const key = `ratelimit:${tenantId}:${rateClass}:${window}`;

  const { value, expiresAt } = await stores().kv.increment(key, windowSeconds);
  const reset = Math.ceil(expiresAt / 1000);
  const state: RateLimitState = { limit, remaining: Math.max(0, limit - value), reset };

  if (value > limit) {
    const retryAfter = Math.max(1, reset - Math.floor(Date.now() / 1000));
    throw new ApiError(
      "rate_limit_exceeded",
      `Rate limit of ${limit} ${rateClass} requests per ${windowSeconds}s exceeded. Retry after ${retryAfter}s.`,
      {
        retryAfter,
        details: { limit, window_seconds: windowSeconds, rate_limit_class: rateClass },
      }
    );
  }

  return state;
}
