/**
 * Registered tables: one persisted record per table in a connection, not one
 * record per connection.
 *
 * Before this, "what tables does this connection have" was answered by
 * introspecting live on every page load (lib/services/connections.ts's
 * getSchema, cached briefly in the KV store). That's fine for the chat
 * agent, which needs the schema fresh on every question, but Database
 * Mapping wants each table to be its own manageable thing — something with
 * an identity that survives a page reload and that other features can
 * reference. So registration introspects once and writes the result down as
 * real documents; nothing here re-introspects on read.
 */

import { notFound } from "@/lib/api/errors";
import type { SchemaColumn } from "@/lib/connectors";
import { stores } from "@/lib/providers";
import { getSchema, type ConnectionDoc } from "./connections";

export type RegisteredTableDoc = {
  id: string;
  object: "registered_table";
  connection_id: string;
  schema: string | null;
  table_name: string;
  /** The one JSONB-shaped field: column name, type, nullable, PK, description. */
  columns: SchemaColumn[];
  row_estimate: number | null;
  registered_at: string;
  created_at: string;
  updated_at: string;
};

function docId(connectionId: string, schema: string | null, tableName: string): string {
  return `${connectionId}::${schema ?? ""}.${tableName}`;
}

export function serializeRegisteredTable(doc: RegisteredTableDoc) {
  return {
    id: doc.id,
    object: doc.object,
    connection_id: doc.connection_id,
    schema: doc.schema,
    table_name: doc.table_name,
    columns: doc.columns,
    row_estimate: doc.row_estimate,
    registered_at: doc.registered_at,
    created_at: doc.created_at,
    updated_at: doc.updated_at,
  };
}

export async function listRegisteredTables(
  tenantId: string,
  connectionId?: string
): Promise<RegisteredTableDoc[]> {
  const docs = await stores().documents.list<RegisteredTableDoc>("registered_tables", tenantId, {
    where: connectionId ? [{ field: "connection_id", equals: connectionId }] : undefined,
    orderBy: "table_name",
    order: "asc",
    limit: 1000,
  });
  return docs;
}

/**
 * Introspects the real connection and upserts one record per table found —
 * a fresh registration replaces each table's stored columns, and tables
 * that no longer exist are removed rather than left stale.
 */
export async function registerTablesForConnection(
  tenantId: string,
  connection: ConnectionDoc
): Promise<RegisteredTableDoc[]> {
  const schema = await getSchema(tenantId, connection, { refresh: true });
  const now = new Date().toISOString();
  const seenIds = new Set<string>();

  const registered = await Promise.all(
    schema.tables.map(async (table) => {
      const id = docId(connection.id, table.schema, table.name);
      seenIds.add(id);
      const doc: RegisteredTableDoc = {
        id,
        object: "registered_table",
        connection_id: connection.id,
        schema: table.schema,
        table_name: table.name,
        columns: table.columns,
        row_estimate: table.row_estimate,
        registered_at: now,
        created_at: now,
        updated_at: now,
      };
      return stores().documents.put("registered_tables", tenantId, doc);
    })
  );

  // Drop records for tables that existed before but are gone now (renamed,
  // dropped, or access to them revoked) — a registration is a full sync of
  // this connection's tables, not an accumulation.
  const existing = await listRegisteredTables(tenantId, connection.id);
  const stale = existing.filter((doc) => !seenIds.has(doc.id));
  await Promise.all(stale.map((doc) => stores().documents.delete("registered_tables", tenantId, doc.id)));

  return registered;
}

export async function requireRegisteredTable(tenantId: string, id: string): Promise<RegisteredTableDoc> {
  const doc = await stores().documents.get<RegisteredTableDoc>("registered_tables", tenantId, id);
  if (!doc) throw notFound("registered_table", id);
  return doc;
}

export async function deleteRegisteredTablesForConnection(
  tenantId: string,
  connectionId: string
): Promise<number> {
  return stores().documents.deleteWhere("registered_tables", tenantId, [
    { field: "connection_id", equals: connectionId },
  ]);
}
