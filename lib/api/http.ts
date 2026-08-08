/**
 * Response construction. Every response in the API is built here, which is what
 * makes "the headers are always present" true rather than aspirational.
 */

import { ApiError, toApiError } from "./errors";
import { rateLimitHeaders, type RateLimitState } from "./rate-limit";

export type ResponseInit_ = {
  status?: number;
  headers?: Record<string, string>;
};

export function baseHeaders(
  requestId: string,
  rateLimit?: RateLimitState | null
): Record<string, string> {
  return {
    "X-Request-Id": requestId,
    // API responses are per-caller and change constantly; a shared cache
    // holding one tenant's data and serving it to another is the failure this
    // prevents.
    "Cache-Control": "no-store",
    ...(rateLimit ? rateLimitHeaders(rateLimit) : {}),
  };
}

export function json(
  body: unknown,
  requestId: string,
  rateLimit?: RateLimitState | null,
  init: ResponseInit_ = {}
): Response {
  return Response.json(body, {
    status: init.status ?? 200,
    headers: { ...baseHeaders(requestId, rateLimit), ...init.headers },
  });
}

export function noContent(
  requestId: string,
  rateLimit?: RateLimitState | null,
  headers: Record<string, string> = {}
): Response {
  return new Response(null, {
    status: 204,
    headers: { ...baseHeaders(requestId, rateLimit), ...headers },
  });
}

export function errorResponse(
  error: unknown,
  requestId: string,
  rateLimit?: RateLimitState | null
): Response {
  const apiError = toApiError(error);
  const headers: Record<string, string> = {
    ...baseHeaders(requestId, rateLimit),
    ...(apiError.retryAfter ? { "Retry-After": String(apiError.retryAfter) } : {}),
  };
  return Response.json(apiError.toBody(requestId), { status: apiError.status, headers });
}

export { ApiError };
