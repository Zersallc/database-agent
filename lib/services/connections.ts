/**
 * Database connections.
 *
 * The one rule that shapes this whole file: credentials go into the secret
 * store and come back out only inside a connector call. They are never stored
 * in the document store, never returned by an endpoint, and never logged. The
 * connection document holds a handle, not a password.
 */

import { notFound } from "@/lib/api/errors";
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
  name: string;
  engine: Engine;
  status: ConnectionStatus;
  status_checked_at: string | null;
  status_detail: string | null;
  allow_writes: boolean;
  max_rows: number;
  default_schema: string | null;
  /** Points at the secret store. Never leaves this module. */
  credential_handle: string | null;
  created_at: string;
  updated_at: string;
};

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
    created_at: doc.created_at,
    updated_at: doc.updated_at,
  };
}

function credentialHandle(connectionId: string): string {
  return `connection-credentials-${connectionId}`;
}

export async function listConnections(
  tenantId: string,
  params: ListParams,
  filters: { status?: ConnectionStatus } = {}
): Promise<Page<ConnectionDoc>> {
  const docs = await stores().documents.list<ConnectionDoc>("connections", tenantId, {
    where: filters.status ? [{ field: "status", equals: filters.status }] : undefined,
    orderBy: "created_at",
    order: params.order,
    startAfter: params.cursor ? { sort: params.cursor.sort, id: params.cursor.id } : undefined,
    limit: params.limit + 1,
  });
  return buildPage(docs, params, (doc) => ({ sort: doc.created_at, id: doc.id }));
}

export async function findConnection(
  tenantId: string,
  connectionId: string
): Promise<ConnectionDoc | null> {
  return stores().documents.get<ConnectionDoc>("connections", tenantId, connectionId);
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

/** Reads credentials and assembles connector options. The only path to a secret. */
export async function connectorOptions(doc: ConnectionDoc): Promise<ConnectorOptions> {
  let credentials: Credentials = {};
  if (doc.credential_handle) {
    const raw = await stores().secrets.read(doc.credential_handle);
    if (raw) {
      try {
        credentials = JSON.parse(raw) as Credentials;
      } catch {
        // A corrupt secret is not a caller error and its contents must not be
        // echoed. Fall through to empty credentials; the connector will fail
        // with a connection error the operator can act on.
      }
    }
  }
  return {
    credentials,
    maxRows: doc.max_rows,
    allowWrites: doc.allow_writes,
    defaultSchema: doc.default_schema,
  };
}

export async function testConnection(tenantId: string, doc: ConnectionDoc) {
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
