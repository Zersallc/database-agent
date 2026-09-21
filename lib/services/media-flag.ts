/**
 * The switch for media connections (document libraries beside the databases).
 *
 * Off unless the deployment says otherwise, and read at the moment it is asked
 * rather than at import, so turning it off is an environment change and a
 * container recreate, not a rebuild.
 *
 * This is deliberately NOT what keeps SQL paths away from media records.
 * That holds whether the flag is on or off (see `isDatabaseConnection`): a
 * kill switch that a database path depended on would be a safety property that
 * disappears the day someone flips it.
 */

export const MEDIA_CONNECTIONS_ENV = "MEDIA_CONNECTIONS_ENABLED";

type Env = Record<string, string | undefined>;

/** Only an explicit "true" or "1" turns it on. Unset, empty and anything else is off. */
export function mediaConnectionsEnabled(env: Env = process.env): boolean {
  const value = env[MEDIA_CONNECTIONS_ENV]?.trim().toLowerCase();
  return value === "true" || value === "1";
}

/**
 * Whether a media connection may be offered to the agent: the deployment has
 * the feature on, and this connection has not been switched off individually.
 * A record with no `enabled` field counts as enabled.
 */
export function isMediaConnectionActive(doc: { enabled?: boolean }, env: Env = process.env): boolean {
  return mediaConnectionsEnabled(env) && doc.enabled !== false;
}
