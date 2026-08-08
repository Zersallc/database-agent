/**
 * One error shape for the whole API.
 *
 * `code` is the stable contract: integrators branch on it, so a code never
 * changes meaning and never disappears within a major version. Adding a new
 * code is backward compatible — clients are told to treat unknown codes as
 * generic — but repurposing one is not.
 *
 * `message` is prose for a human debugging at 2am. It may be reworded freely;
 * nothing should ever parse it.
 */

export const ERROR_CODES = {
  // 400 — the request itself is wrong.
  invalid_request: 400,
  validation_failed: 400,
  invalid_cursor: 400,
  missing_idempotency_key: 400,

  // 401 / 403 — who you are, and what you may do.
  unauthorized: 401,
  invalid_api_key: 401,
  insufficient_scope: 403,
  insufficient_role: 403,

  // 404 / 409 / 413 / 422 — the request is well formed but cannot be honored.
  not_found: 404,
  idempotency_key_reused: 409,
  resource_conflict: 409,
  payload_too_large: 413,
  sql_not_read_only: 422,
  sql_multiple_statements: 422,
  last_admin_required: 422,
  unprocessable: 422,

  // 429 — slow down.
  rate_limit_exceeded: 429,

  // 5xx — our fault, or a dependency's.
  internal_error: 500,
  not_implemented: 501,
  upstream_database_error: 502,
  upstream_model_error: 502,
  provider_unavailable: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export type ErrorBody = {
  code: ErrorCode | string;
  message: string;
  details?: Record<string, unknown>;
  request_id: string;
  docs_url?: string;
};

const DOCS_BASE = "https://docs.example.com/api/v1/errors";

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;
  /** Seconds the client should wait. Only meaningful on 429. */
  readonly retryAfter?: number;

  constructor(
    code: ErrorCode,
    message: string,
    options: { details?: Record<string, unknown>; retryAfter?: number; cause?: unknown } = {}
  ) {
    super(message, { cause: options.cause });
    this.name = "ApiError";
    this.code = code;
    this.status = ERROR_CODES[code];
    this.details = options.details;
    this.retryAfter = options.retryAfter;
  }

  toBody(requestId: string): ErrorBody {
    return {
      code: this.code,
      message: this.message,
      ...(this.details ? { details: this.details } : {}),
      request_id: requestId,
      docs_url: `${DOCS_BASE}#${this.code}`,
    };
  }
}

/**
 * Not-found is deliberately indistinguishable from not-yours: a caller must not
 * be able to probe for the existence of another tenant's resources.
 */
export function notFound(resource: string, id?: string): ApiError {
  return new ApiError(
    "not_found",
    id
      ? `No ${resource} with ID '${id}' in this workspace.`
      : `No such ${resource} in this workspace.`
  );
}

export function invalidRequest(message: string, details?: Record<string, unknown>): ApiError {
  return new ApiError("invalid_request", message, { details });
}

/** Wraps anything thrown into an ApiError so the handler always has one shape. */
export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new ApiError("internal_error", "An unexpected error occurred.", {
    details: process.env.NODE_ENV === "production" ? undefined : { cause: message },
    cause: err,
  });
}
