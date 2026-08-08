/**
 * The route wrapper.
 *
 * Every v1 endpoint is `defineRoute({...})`. That is the point: authentication,
 * tenancy, scope checks, rate limiting, idempotency, error shaping, and the
 * standard headers happen in exactly one place, so no endpoint can quietly skip
 * one. A handler that forgets to check a scope is not a bug you find in review
 * — it is a route that declares no scope, which is visible in the config line.
 *
 * Handlers return a plain `{status, body}` result. The wrapper serializes it,
 * which is also what makes idempotent replay possible: it has the response
 * value in hand and can store it. Handlers that need to stream return a
 * `Response` directly and opt out of replay.
 */

import type { NextRequest } from "next/server";
import { authenticate, requireScope, type Principal, type Scope } from "./auth";
import { ApiError } from "./errors";
import { errorResponse, json, noContent } from "./http";
import { beginIdempotent, readIdempotencyKey } from "./idempotency";
import { newRequestId } from "./ids";
import { enforceRateLimit, type RateLimitClass, type RateLimitState } from "./rate-limit";
import { readJson } from "./validate";

export type RouteResult =
  | { status?: number; body?: unknown; headers?: Record<string, string> }
  | Response;

export type RouteContext<P> = {
  request: NextRequest;
  url: URL;
  params: P;
  principal: Principal;
  requestId: string;
  /** Parsed JSON body. `{}` when the request had none. */
  body: unknown;
};

export type RouteConfig<P> = {
  /** Scopes the caller must hold. All of them, not any of them. */
  scopes?: Scope[];
  /** Which budget this endpoint draws from. Omit for unmetered endpoints like health. */
  rateLimit?: RateLimitClass;
  /** Set false for endpoints that must work without credentials (health only). */
  auth?: boolean;
  /**
   * Require and honor `Idempotency-Key`. Use on every endpoint that creates
   * something or has a side effect a client would not want twice.
   */
  idempotent?: boolean;
  handler: (context: RouteContext<P>) => Promise<RouteResult>;
};

const BODYLESS_METHODS = new Set(["GET", "HEAD", "DELETE"]);

export function defineRoute<P = Record<string, never>>(config: RouteConfig<P>) {
  return async function handle(
    request: NextRequest,
    context: { params: Promise<P> } = { params: Promise.resolve({} as P) }
  ): Promise<Response> {
    const requestId = newRequestId();
    let rateLimit: RateLimitState | null = null;

    try {
      const principal =
        config.auth === false
          ? null
          : await authenticate(request);

      if (principal) {
        for (const scope of config.scopes ?? []) requireScope(principal, scope);
      }

      if (config.rateLimit && principal) {
        rateLimit = await enforceRateLimit(principal.tenantId, config.rateLimit);
      }

      const params = (await context.params) ?? ({} as P);
      const body = BODYLESS_METHODS.has(request.method) ? {} : await readJson(request);

      const routeContext: RouteContext<P> = {
        request,
        url: new URL(request.url),
        params,
        // `auth: false` routes never read the principal; the cast keeps the
        // handler signature uniform instead of making every handler null-check.
        principal: principal as Principal,
        requestId,
        body,
      };

      if (config.idempotent && principal) {
        return await runIdempotent(config, routeContext, principal, requestId, rateLimit);
      }

      return finalize(await config.handler(routeContext), requestId, rateLimit);
    } catch (error) {
      return errorResponse(error, requestId, rateLimit);
    }
  };
}

async function runIdempotent<P>(
  config: RouteConfig<P>,
  context: RouteContext<P>,
  principal: Principal,
  requestId: string,
  rateLimit: RateLimitState | null
): Promise<Response> {
  const key = readIdempotencyKey(context.request);
  const route = `${context.request.method} ${new URL(context.request.url).pathname}`;
  const outcome = await beginIdempotent<{ status: number; body: unknown }>(
    principal.tenantId,
    route,
    key,
    context.body
  );

  if (outcome.replayed) {
    const replayed = outcome.body as { status: number; body: unknown };
    return json(replayed.body, requestId, rateLimit, {
      status: replayed.status,
      headers: { "Idempotent-Replay": "true" },
    });
  }

  const result = await config.handler(context);

  // A streamed response cannot be captured and replayed. The key still guards
  // against a concurrent duplicate; it just will not serve a cached body.
  if (result instanceof Response) return result;

  const status = result.status ?? 200;
  if (status < 400) {
    await outcome.commit(status, { status, body: result.body });
  }
  return finalize(result, requestId, rateLimit);
}

function finalize(
  result: RouteResult,
  requestId: string,
  rateLimit: RateLimitState | null
): Response {
  if (result instanceof Response) return result;
  const status = result.status ?? 200;
  if (status === 204 || result.body === undefined) {
    return noContent(requestId, rateLimit, result.headers);
  }
  return json(result.body, requestId, rateLimit, { status, headers: result.headers });
}

/** Convenience for path params that must be present and non-empty. */
export function requireParam(value: string | undefined, name: string): string {
  if (!value) throw new ApiError("invalid_request", `Missing '${name}' in the request path.`);
  return value;
}
