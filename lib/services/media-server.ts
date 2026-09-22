/**
 * Where a media connection's documents are served from.
 *
 * A connection record names a server by reference (`server_ref`), never by
 * address or credential. The address and the token live in this deployment's
 * environment, so they are not in the document store, not in any response, not
 * in a log, and not something whoever can create a connection can choose:
 * accepting a per-connection URL would let that person make this server send
 * its bearer token to an address of their choosing.
 *
 * `default` is the one reference there is today. A second syslab-server would
 * be a second reference with its own variables, not a second URL on a record.
 */

type Env = Record<string, string | undefined>;

export type MediaServerConfig = { baseUrl: string; token: string };

/**
 * The only `server_ref` values this deployment understands. A second
 * syslab-server would add to this list alongside its own environment
 * variables, not accept an arbitrary reference from whoever creates a
 * connection — see the file header.
 */
export const SUPPORTED_MEDIA_SERVER_REFS = ["default"] as const;

export function resolveMediaServer(serverRef: string, env: Env = process.env): MediaServerConfig | null {
  if (serverRef.trim() !== "default") return null;
  const baseUrl = env.RETRIEVAL_BASE_URL?.trim();
  const token = env.RETRIEVAL_TOKEN?.trim();
  return baseUrl && token ? { baseUrl, token } : null;
}
