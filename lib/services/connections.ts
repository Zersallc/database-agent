/**
 * Database connections.
 *
 * The one rule that shapes this whole file: credentials go into the secret
 * store and come back out only inside a connector call. They are never stored
 * in the document store, never returned by an endpoint, and never logged. The
 * connection document holds a handle, not a password.
 */

import { ApiError, notFound } from "@/lib/api/errors";
import { newId } from "@/lib/api/ids";
import { buildPage, type ListParams, type Page } from "@/lib/api/pagination";
import {
  createConnector,
  isSupportedEngine,
  translateConnectorError,
  withConnector,
  type ConnectorOptions,
  type Credentials,
  type Engine,
  type SchemaTable,
} from "@/lib/connectors";
import { stores } from "@/lib/providers";

export type ConnectionStatus = "connected" | "degraded" | "offline" | "unknown";

export type ConnectionDoc = {
  id: string;
  object: "connection";
  /**
   * Absent on every connection written before other kinds existed, and still
   * not written for a database: absent and "database" mean the same thing, so
   * no stored document has to change. See `isDatabaseConnection`.
   */
  kind?: "database";
  name: string;
  /**
   * What this database holds, in an administrator's words. Optional and, for
   * now, nothing writes it. It is shown to the agent as data (see
   * `sanitizeDescription`), never as an instruction.
   */
  description?: string | null;
  engine: Engine;
  status: ConnectionStatus;
  status_checked_at: string | null;
  status_detail: string | null;
  allow_writes: boolean;
  max_rows: number;
  default_schema: string | null;
  /** Points at the secret store. Never leaves this module. */
  credential_handle: string | null;
  /**
   * Host, port, database name, username and ssl are not secrets — only the
   * password is — so they are kept in plain text here too, duplicated out of
   * the encrypted credentials at write time. This is what lets the UI group
   * connections from different companies that point at the same physical
   * database, and show/edit a connection's settings, without ever reading a
   * password back out of the secret store.
   */
  host: string | null;
  port: number | null;
  database: string | null;
  username: string | null;
  ssl: boolean;
  created_at: string;
  updated_at: string;
};

/**
 * A document library, stored beside the databases in the same collection.
 *
 * It is not a database and nothing on the SQL side may treat it as one, so it
 * is a separate type rather than another `Engine`: `engine: "media"` here is
 * not a member of `Engine`, and `createConnector` has no factory for it. This
 * step only defines the record and makes every database path ignore it; nothing
 * creates one yet.
 */
export type MediaConnectionDoc = {
  id: string;
  object: "connection";
  kind: "media";
  engine: "media";
  name: string;
  /** What this library holds, in an administrator's words. Optional; shown to the agent as data. */
  description?: string | null;
  /**
   * Absent means enabled, so a record written without it is usable. A
   * disabled one stays in the store and is simply not offered to the agent.
   */
  enabled?: boolean;
  status: ConnectionStatus;
  status_checked_at: string | null;
  status_detail: string | null;
  /**
   * Where this connection's documents live. The syslab-server URL and token are
   * deployment configuration resolved through `server_ref`, never stored here.
   * `library_ref` is an opaque note of which library this points at, for people
   * to read: nothing may branch on its value.
   */
  media: { alias_id: string; library_ref: string | null; server_ref: string };
  created_at: string;
  updated_at: string;
};

/** Whatever the `connections` collection can hold. */
export type StoredConnectionDoc = ConnectionDoc | MediaConnectionDoc;

/**
 * Is this record a database this app can open a connector for?
 *
 * The one place that decides it, and it fails closed. A record counts as a
 * database only when `kind` is absent (everything written before this existed)
 * or "database", and its engine is not "media". A `kind` this code has never
 * heard of is therefore not a database either: a later version adding a third
 * kind must not find this version running SQL against it.
 */
export function isDatabaseConnection(doc: StoredConnectionDoc): doc is ConnectionDoc {
  const { kind, engine } = doc as { kind?: unknown; engine?: unknown };
  return (kind === undefined || kind === "database") && engine !== "media";
}

/**
 * Refuses anything that is not a database, at the points that would otherwise
 * read a credential, open a connector or run a statement.
 *
 * The lookups below already return only databases, so reaching this with
 * anything else means a caller went round them. Refusing here is the second
 * wall, and it is what keeps "never treated as a database" true of code that
 * has not been written yet.
 */
export function assertDatabaseConnection(doc: StoredConnectionDoc): asserts doc is ConnectionDoc {
  if (!isDatabaseConnection(doc)) {
    throw new ApiError("invalid_request", `Connection '${doc.id}' is not a database connection.`);
  }
}

/** The wire shape. Anything not listed here does not leave the server. */
export function serializeConnection(doc: ConnectionDoc) {
  return {
    id: doc.id,
    object: doc.object,
    name: doc.name,
    engine: doc.engine,
    status: doc.status,
    status_checked_at: doc.status_checked_at,
    status_detail: doc.status_detail,
    allow_writes: doc.allow_writes,
    max_rows: doc.max_rows,
    default_schema: doc.default_schema,
    host: doc.host,
    port: doc.port,
    database: doc.database,
    username: doc.username,
    ssl: doc.ssl,
    created_at: doc.created_at,
    updated_at: doc.updated_at,
  };
}

function credentialHandle(connectionId: string): string {
  return `connection-credentials-${connectionId}`;
}

/**
 * The workspace's databases. Only databases: a media connection stored in the
 * same collection is skipped here, which is what keeps every caller that turns
 * these into SQL connectors (the agent, Database Mapping, the API) from ever
 * being handed one. Asking for anything else takes `findAnyConnection`.
 */
export async function listConnections(
  tenantId: string,
  params: ListParams,
  filters: { status?: ConnectionStatus } = {}
): Promise<Page<ConnectionDoc>> {
  // One more than a page, to learn whether another exists.
  const wanted = params.limit + 1;
  const databases: ConnectionDoc[] = [];
  let startAfter = params.cursor ? { sort: params.cursor.sort, id: params.cursor.id } : undefined;

  // One round trip, the same query as before, unless a media record sat inside
  // the window. Only then does it read on, so a page is never short merely
  // because a library was stored between two databases.
  for (;;) {
    const batch = await stores().documents.list<StoredConnectionDoc>("connections", tenantId, {
      where: filters.status ? [{ field: "status", equals: filters.status }] : undefined,
      orderBy: "created_at",
      order: params.order,
      startAfter,
      limit: wanted,
    });
    for (const doc of batch) {
      if (isDatabaseConnection(doc)) databases.push(doc);
    }
    if (databases.length >= wanted || batch.length < wanted) break;
    const last = batch[batch.length - 1];
    startAfter = { sort: last.created_at, id: last.id };
  }

  return buildPage(databases.slice(0, wanted), params, (doc) => ({ sort: doc.created_at, id: doc.id }));
}

/**
 * A connection of any kind, by id. The deliberate exception to the lookups
 * around it: nothing that runs SQL, binds a conversation or lists databases may
 * call this, and a test keeps that list of callers short and named.
 */
export async function findAnyConnection(
  tenantId: string,
  connectionId: string
): Promise<StoredConnectionDoc | null> {
  return stores().documents.get<StoredConnectionDoc>("connections", tenantId, connectionId);
}

/**
 * Is this record a usable media connection?
 *
 * Exact on purpose. Only `kind: "media"` with `engine: "media"` counts, and it
 * must carry the two things a search needs: a key for the library and a server
 * reference. Anything else that is not a database (a kind added later, a
 * half-written record) is neither a database nor a library, and is skipped
 * rather than guessed at.
 */
export function isMediaConnection(doc: StoredConnectionDoc): doc is MediaConnectionDoc {
  const candidate = doc as { kind?: unknown; engine?: unknown; name?: unknown; media?: unknown };
  const media = candidate.media as { alias_id?: unknown; server_ref?: unknown } | null | undefined;
  return (
    candidate.kind === "media" &&
    candidate.engine === "media" &&
    typeof candidate.name === "string" &&
    candidate.name.trim() !== "" &&
    typeof media?.alias_id === "string" &&
    media.alias_id.trim() !== "" &&
    typeof media?.server_ref === "string" &&
    media.server_ref.trim() !== ""
  );
}

/** Reads at most this many records looking for libraries. A workspace has a handful. */
const MEDIA_SCAN_LIMIT = 1000;

/**
 * This workspace's media connections, oldest first.
 *
 * The one place that lists them. It is the counterpart of `listConnections`
 * and, like it, is decided here and not by a caller: `listConnections` returns
 * only databases and this returns only libraries, so no caller can be handed
 * the wrong kind by asking the wrong question. Only the source resolver calls
 * it, and a test keeps that list short.
 */
export async function listMediaConnections(tenantId: string): Promise<MediaConnectionDoc[]> {
  const found: MediaConnectionDoc[] = [];
  const pageSize = 100;
  let startAfter: { sort: string; id: string } | undefined;

  for (let scanned = 0; scanned < MEDIA_SCAN_LIMIT; scanned += pageSize) {
    const batch = await stores().documents.list<StoredConnectionDoc>("connections", tenantId, {
      orderBy: "created_at",
      order: "asc",
      startAfter,
      limit: pageSize,
    });
    for (const doc of batch) {
      if (isMediaConnection(doc)) found.push(doc);
    }
    if (batch.length < pageSize) break;
    const last = batch[batch.length - 1];
    startAfter = { sort: last.created_at, id: last.id };
  }
  return found;
}

/** A database by id. A media connection's id is not found here, as if it did not exist. */
export async function findConnection(
  tenantId: string,
  connectionId: string
): Promise<ConnectionDoc | null> {
  const doc = await findAnyConnection(tenantId, connectionId);
  return doc && isDatabaseConnection(doc) ? doc : null;
}

export async function requireConnection(
  tenantId: string,
  connectionId: string
): Promise<ConnectionDoc> {
  const doc = await findConnection(tenantId, connectionId);
  if (!doc) throw notFound("connection", connectionId);
  return doc;
}

export type CreateConnectionInput = {
  name: string;
  engine: string;
  credentials?: Credentials;
  allow_writes: boolean;
  max_rows: number;
  default_schema?: string;
};

export async function createConnection(
  tenantId: string,
  input: CreateConnectionInput
): Promise<ConnectionDoc> {
  if (!isSupportedEngine(input.engine)) {
    const { ApiError } = await import("@/lib/api/errors");
    throw new ApiError("invalid_request", `Engine '${input.engine}' has no connector.`, {
      details: { fields: [{ path: "engine", issue: "unsupported engine" }] },
    });
  }

  const id = newId("connection");
  const now = new Date().toISOString();
  const hasCredentials = input.credentials && Object.keys(input.credentials).length > 0;

  if (hasCredentials) {
    await stores().secrets.write(credentialHandle(id), JSON.stringify(input.credentials));
  }

  const doc: ConnectionDoc = {
    id,
    object: "connection",
    name: input.name,
    engine: input.engine,
    status: "unknown",
    status_checked_at: null,
    status_detail: null,
    allow_writes: input.allow_writes,
    max_rows: input.max_rows,
    default_schema: input.default_schema ?? null,
    credential_handle: hasCredentials ? credentialHandle(id) : null,
    host: input.credentials?.host ?? null,
    port: input.credentials?.port ?? null,
    database: input.credentials?.database ?? null,
    username: input.credentials?.username ?? null,
    ssl: input.credentials?.ssl ?? true,
    created_at: now,
    updated_at: now,
  };

  return stores().documents.put("connections", tenantId, doc);
}

export type UpdateConnectionInput = {
  name?: string;
  credentials?: Credentials;
  allow_writes?: boolean;
  max_rows?: number;
  default_schema?: string;
};

export async function updateConnection(
  tenantId: string,
  connectionId: string,
  input: UpdateConnectionInput
): Promise<ConnectionDoc> {
  const existing = await requireConnection(tenantId, connectionId);
  const changes: Partial<ConnectionDoc> = { updated_at: new Date().toISOString() };

  if (input.name !== undefined) changes.name = input.name;
  if (input.allow_writes !== undefined) changes.allow_writes = input.allow_writes;
  if (input.max_rows !== undefined) changes.max_rows = input.max_rows;
  if (input.default_schema !== undefined) changes.default_schema = input.default_schema;

  if (input.credentials && Object.keys(input.credentials).length > 0) {
    const handle = credentialHandle(connectionId);
    await stores().secrets.write(handle, JSON.stringify(input.credentials));
    changes.credential_handle = handle;
    changes.host = input.credentials.host ?? null;
    changes.port = input.credentials.port ?? null;
    changes.database = input.credentials.database ?? null;
    changes.username = input.credentials.username ?? null;
    changes.ssl = input.credentials.ssl ?? true;
    // Credentials changed, so the recorded status is about the old ones.
    changes.status = "unknown";
    changes.status_checked_at = null;
    changes.status_detail = null;
    await invalidateSchemaCache(tenantId, connectionId);
  }

  const updated = await stores().documents.patch<ConnectionDoc>(
    "connections",
    tenantId,
    connectionId,
    changes
  );
  return updated ?? existing;
}

export async function deleteConnection(tenantId: string, connectionId: string): Promise<void> {
  const existing = await findConnection(tenantId, connectionId);
  if (!existing) return;
  if (existing.credential_handle) {
    await stores().secrets.delete(existing.credential_handle);
  }
  await invalidateSchemaCache(tenantId, connectionId);
  await stores().documents.delete("connections", tenantId, connectionId);
}

/** Reads a connection's raw credentials. One of two paths to a secret (see connectorOptions). */
export async function readCredentials(doc: ConnectionDoc): Promise<Credentials> {
  assertDatabaseConnection(doc);
  if (!doc.credential_handle) return {};
  const raw = await stores().secrets.read(doc.credential_handle);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Credentials;
  } catch {
    // A corrupt secret is not a caller error and its contents must not be
    // echoed. Fall through to empty credentials; the connector will fail
    // with a connection error the operator can act on.
    return {};
  }
}

/** Reads credentials and assembles connector options. The other path to a secret. */
export async function connectorOptions(doc: ConnectionDoc): Promise<ConnectorOptions> {
  assertDatabaseConnection(doc);
  const credentials = await readCredentials(doc);
  return {
    credentials,
    maxRows: doc.max_rows,
    allowWrites: doc.allow_writes,
    defaultSchema: doc.default_schema,
  };
}

export async function testConnection(tenantId: string, doc: ConnectionDoc) {
  assertDatabaseConnection(doc);
  const connector = createConnector(doc.engine, await connectorOptions(doc));
  try {
    const probe = await connector.probe();
    const checkedAt = new Date().toISOString();
    const status: ConnectionStatus = probe.ok ? "connected" : "offline";

    await stores().documents.patch<ConnectionDoc>("connections", tenantId, doc.id, {
      status,
      status_checked_at: checkedAt,
      status_detail: probe.detail,
      updated_at: checkedAt,
    });

    return {
      connection_id: doc.id,
      status,
      checked_at: checkedAt,
      latency_ms: probe.latency_ms,
      detail: probe.detail,
    };
  } catch (error) {
    throw translateConnectorError(error);
  } finally {
    await connector.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Schema introspection, cached
// ---------------------------------------------------------------------------

const SCHEMA_TTL_SECONDS = Number(process.env.SCHEMA_CACHE_TTL_SECONDS ?? 900);

function schemaCacheKey(tenantId: string, connectionId: string): string {
  return `schema:${tenantId}:${connectionId}`;
}

export async function invalidateSchemaCache(tenantId: string, connectionId: string): Promise<void> {
  await stores().kv.delete(schemaCacheKey(tenantId, connectionId));
}

/**
 * The schema goes into the agent's system prompt on every single turn, so
 * re-introspecting per request would add a round trip to the database to every
 * question — and information_schema queries are not cheap on a large instance.
 */
export async function getSchema(
  tenantId: string,
  doc: ConnectionDoc,
  options: { refresh?: boolean } = {}
): Promise<{ tables: SchemaTable[]; cached: boolean; fetched_at: string }> {
  // Before the cache is read: a cached schema must not answer for a record
  // that is not a database.
  assertDatabaseConnection(doc);
  const key = schemaCacheKey(tenantId, doc.id);

  if (!options.refresh) {
    const cached = await stores().kv.get<{ tables: SchemaTable[]; fetched_at: string }>(key);
    if (cached) return { ...cached, cached: true };
  }

  const tables = await withConnector(doc.engine, await connectorOptions(doc), (connector) =>
    connector.introspect()
  );
  const fetched_at = new Date().toISOString();
  await stores().kv.set(key, { tables, fetched_at }, SCHEMA_TTL_SECONDS);
  return { tables, fetched_at, cached: false };
}
