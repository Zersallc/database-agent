/**
 * Deprecation signalling.
 *
 * Removing an endpoint is a promise you break with silence, so nothing here
 * disappears without warning first. A deprecated endpoint keeps working for its
 * whole runway and says three things on every single response: that it is
 * deprecated (RFC 9745 `Deprecation`), when it goes away (RFC 8594 `Sunset`),
 * and where the replacement is (`Link rel="successor-version"`).
 *
 * The runway is not a formality. Announce, signal, watch usage per consumer,
 * reach out to whoever is left, and only then remove. See
 * docs/api/versioning.md for the full lifecycle.
 */

export type Deprecation = {
  /** When the endpoint was announced as deprecated. */
  deprecatedAt: Date;
  /** When it stops working. Must leave a humane runway — months, not sprints. */
  sunsetAt: Date;
  /** URL of the replacement, so the header is actionable on its own. */
  successor: string;
  /** One line for logs and the changelog. */
  reason: string;
};

export function deprecationHeaders(deprecation: Deprecation): Record<string, string> {
  return {
    // RFC 9745: an HTTP-date marking when the deprecation took effect.
    Deprecation: deprecation.deprecatedAt.toUTCString(),
    // RFC 8594: when the resource becomes unresponsive.
    Sunset: deprecation.sunsetAt.toUTCString(),
    Link: `<${deprecation.successor}>; rel="successor-version"`,
    Warning: `299 - "${deprecation.reason}"`,
  };
}

/**
 * Logs a call to a deprecated endpoint.
 *
 * Signalling without measuring is how a sunset date arrives with partners still
 * calling. These lines are what the deprecation-usage dashboard reads, so the
 * decision to remove is made from traffic, not from the calendar alone.
 */
export function recordDeprecatedUsage(
  endpoint: string,
  deprecation: Deprecation,
  context: { requestId: string; tenantId?: string; userAgent?: string | null }
): void {
  console.warn(
    JSON.stringify({
      event: "deprecated_endpoint_called",
      endpoint,
      successor: deprecation.successor,
      sunset_at: deprecation.sunsetAt.toISOString(),
      request_id: context.requestId,
      tenant_id: context.tenantId ?? null,
      user_agent: context.userAgent ?? null,
    })
  );
}
