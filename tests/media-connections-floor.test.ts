/**
 * The tolerance floor: a media connection can sit in the store beside the
 * databases, and no database path ever notices it.
 *
 * Media records are stored in the same `connections` collection as databases.
 * That is what lets the existing connection system carry them, and it is also
 * the risk: every place that lists, finds or executes "a connection" would
 * otherwise be handed a record it would try to open as SQL. These tests pin
 * that from three sides, each of which has to hold on its own:
 *
 *   - the lookups return only databases, so a caller is never handed one;
 *   - the entry points that read a credential, open a connector or run a
 *     statement refuse one even if a caller somehow got hold of it;
 *   - the HTTP surface that binds a conversation or runs SQL rejects one.
 *
 * The flag is off throughout: none of this depends on it, and that is the
 * point of the floor.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NextRequest } from "next/server";

import { ApiError } from "@/lib/api/errors";
import { SYSTEM_PARTITION, hashApiKey, type ApiKeyRecord } from "@/lib/api/auth";
import { readListParams, type ListParams } from "@/lib/api/pagination";
import { SUPPORTED_ENGINES, createConnector } from "@/lib/connectors";
import { stores } from "@/lib/providers";
import {
  assertDatabaseConnection,
  connectorOptions,
  createConnection,
  findAnyConnection,
  findConnection,
  getSchema,
  isDatabaseConnection,
  listConnections,
  readCredentials,
  requireConnection,
  testConnection,
  type ConnectionDoc,
  type MediaConnectionDoc,
  type StoredConnectionDoc,
} from "@/lib/services/connections";
import { createConversation } from "@/lib/services/conversations";
import { runQuery } from "@/lib/services/queries";
import { mediaConnectionsEnabled } from "@/lib/services/media-flag";

import { GET as listConnectionsRoute, POST as createConnectionRoute } from "@/app/api/v1/connections/route";
import {
  DELETE as deleteConnectionRoute,
  GET as getConnectionRoute,
  PATCH as patchConnectionRoute,
} from "@/app/api/v1/connections/[connection_id]/route";
import { GET as schemaRoute } from "@/app/api/v1/connections/[connection_id]/schema/route";
import { POST as testRoute } from "@/app/api/v1/connections/[connection_id]/test/route";
import { POST as createConversationRoute } from "@/app/api/v1/conversations/route";
import { GET as getConversationRoute, PATCH as patchConversationRoute } from "@/app/api/v1/conversations/[conversation_id]/route";
import { POST as runRoute } from "@/app/api/v1/conversations/[conversation_id]/runs/route";
import { POST as queryRoute } from "@/app/api/v1/queries/route";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// The store is one in-memory singleton for the whole file, so every test gets
// a tenant of its own rather than sharing state.
let counter = 0;
const newTenant = () => `ten_floor_${++counter}`;
const stamp = (n: number) => new Date(Date.UTC(2026, 8, 1, 0, 0, n)).toISOString();

/** The shape `createConnection` writes today: no `kind`, which is what every existing record looks like. */
function databaseDoc(id: string, name: string, n: number, extra: Partial<ConnectionDoc> = {}): ConnectionDoc {
  return {
    id,
    object: "connection",
    name,
    engine: "demo",
    status: "unknown",
    status_checked_at: null,
    status_detail: null,
    allow_writes: false,
    max_rows: 100,
    default_schema: null,
    credential_handle: null,
    host: null,
    port: null,
    database: null,
    username: null,
    ssl: true,
    created_at: stamp(n),
    updated_at: stamp(n),
    ...extra,
  };
}

function mediaDoc(id: string, name: string, n: number, extra: Partial<MediaConnectionDoc> = {}): MediaConnectionDoc {
  return {
    id,
    object: "connection",
    kind: "media",
    engine: "media",
    name,
    status: "unknown",
    status_checked_at: null,
    status_detail: null,
    media: { alias_id: id, library_ref: "contracts", server_ref: "default" },
    created_at: stamp(n),
    updated_at: stamp(n),
    ...extra,
  };
}

async function seed(tenantId: string, docs: StoredConnectionDoc[]) {
  for (const doc of docs) await stores().documents.put("connections", tenantId, doc);
}

async function collectionSize(collection: "queries" | "conversations" | "messages" | "runs", tenantId: string) {
  return (await stores().documents.list(collection, tenantId, { orderBy: "created_at", order: "asc", limit: 100 })).length;
}

/** Counts every secret read, so a test can say "and it never got as far as a credential". */
function watchSecrets() {
  const secrets = stores().secrets;
  const original = secrets.read.bind(secrets);
  const reads: string[] = [];
  secrets.read = async (handle: string) => {
    reads.push(handle);
    return original(handle);
  };
  return {
    reads,
    stop: () => {
      secrets.read = original;
    },
  };
}

async function apiKeyFor(tenantId: string): Promise<string> {
  const key = `floor-test-key-${tenantId}`;
  const record: ApiKeyRecord = {
    id: await hashApiKey(key),
    key_id: `key_${tenantId}`,
    key_hint: "test",
    tenant_id: tenantId,
    user_id: "usr_floor_test",
    role: "admin",
    created_at: stamp(0),
  };
  await stores().documents.put("api_keys", SYSTEM_PARTITION, record);
  return key;
}

function request(method: string, pathname: string, key: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "Idempotency-Key": randomUUID(),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const context = <P>(params: P) => ({ params: Promise.resolve(params) });

function rejectedWith(code: string) {
  return (error: unknown) => error instanceof ApiError && error.code === code;
}

// ---------------------------------------------------------------------------
// What counts as a database
// ---------------------------------------------------------------------------

describe("what counts as a database", () => {
  test("a record with no kind is one, because every existing record is like that", () => {
    assert.equal(isDatabaseConnection(databaseDoc("c1", "Sales", 1)), true);
  });

  test("kind 'database' is one", () => {
    assert.equal(isDatabaseConnection(databaseDoc("c1", "Sales", 1, { kind: "database" })), true);
  });

  test("a media record is not", () => {
    assert.equal(isDatabaseConnection(mediaDoc("m1", "Contracts", 1)), false);
  });

  test("engine 'media' is not, even with no kind written", () => {
    const doc = { ...databaseDoc("c1", "Sales", 1), engine: "media" } as unknown as StoredConnectionDoc;
    assert.equal(isDatabaseConnection(doc), false);
  });

  test("a kind that does not exist yet is not: the check fails closed", () => {
    const doc = { ...databaseDoc("c1", "Sales", 1), kind: "notebook" } as unknown as StoredConnectionDoc;
    assert.equal(isDatabaseConnection(doc), false);
  });

  test("a media record is not made a database by carrying a real engine name", () => {
    const doc = { ...mediaDoc("m1", "Contracts", 1), engine: "postgres" } as unknown as StoredConnectionDoc;
    assert.equal(isDatabaseConnection(doc), false);
  });
});

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

async function walk(tenantId: string, limit: number, order: "asc" | "desc") {
  const pages: { names: string[]; has_more: boolean; next_cursor: string | null }[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 20; guard++) {
    const params: ListParams = readListParams(
      new URL(`http://x/?limit=${limit}&order=${order}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`)
    );
    const page = await listConnections(tenantId, params);
    pages.push({ names: page.data.map((d) => d.name), has_more: page.has_more, next_cursor: page.next_cursor });
    if (!page.has_more) return pages;
    cursor = page.next_cursor;
  }
  throw new Error("pagination did not terminate");
}

describe("listing databases", () => {
  test("a media record is not listed", async () => {
    const tenant = newTenant();
    await seed(tenant, [
      databaseDoc("c1", "Sales", 1),
      mediaDoc("m1", "Contracts", 2),
      databaseDoc("c2", "Analytics", 3),
    ]);
    const page = await listConnections(tenant, readListParams(new URL("http://x/?limit=50&order=asc")));
    assert.deepEqual(page.data.map((d) => d.id), ["c1", "c2"]);
    assert.equal(page.has_more, false);
    assert.equal(page.next_cursor, null);
  });

  test("with no media records the page is exactly what it always was", async () => {
    const tenant = newTenant();
    const docs = [databaseDoc("c1", "Sales", 1), databaseDoc("c2", "Analytics", 2)];
    await seed(tenant, docs);
    const page = await listConnections(tenant, readListParams(new URL("http://x/?limit=50&order=asc")));
    assert.deepEqual(page, { data: docs, has_more: false, next_cursor: null });
  });

  test("paging through databases gives the same pages with or without media records between them", async () => {
    const databases = [1, 2, 3, 4, 5].map((n) => databaseDoc(`c${n}`, `Db ${n}`, n * 10));
    const media = [15, 25, 26, 27, 55].map((n) => mediaDoc(`m${n}`, `Lib ${n}`, n));

    const plain = newTenant();
    await seed(plain, databases);
    const mixed = newTenant();
    await seed(mixed, [...databases, ...media]);

    for (const order of ["asc", "desc"] as const) {
      for (const limit of [1, 2, 3, 5]) {
        assert.deepEqual(
          await walk(mixed, limit, order),
          await walk(plain, limit, order),
          `limit ${limit}, ${order}`
        );
      }
    }
  });

  test("a page is not short because a library sat where it would have ended", async () => {
    const tenant = newTenant();
    // One database, then four libraries, then another database. With a page of
    // one, the first window the store returns holds nothing but a library.
    await seed(tenant, [
      databaseDoc("c1", "First", 1),
      mediaDoc("m1", "A", 2),
      mediaDoc("m2", "B", 3),
      mediaDoc("m3", "C", 4),
      mediaDoc("m4", "D", 5),
      databaseDoc("c2", "Second", 6),
    ]);
    const pages = await walk(tenant, 1, "asc");
    assert.deepEqual(pages.map((p) => p.names), [["First"], ["Second"]]);
    assert.deepEqual(pages.map((p) => p.has_more), [true, false]);
  });

  test("the status filter still applies, and still skips media", async () => {
    const tenant = newTenant();
    await seed(tenant, [
      databaseDoc("c1", "Up", 1, { status: "connected" }),
      databaseDoc("c2", "Down", 2, { status: "offline" }),
      mediaDoc("m1", "Lib", 3, { status: "connected" }),
    ]);
    const page = await listConnections(tenant, readListParams(new URL("http://x/?limit=50")), {
      status: "connected",
    });
    assert.deepEqual(page.data.map((d) => d.id), ["c1"]);
  });
});

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

describe("looking a connection up", () => {
  test("a database is found exactly as stored", async () => {
    const tenant = newTenant();
    const doc = databaseDoc("c1", "Sales", 1);
    await seed(tenant, [doc]);
    assert.deepEqual(await findConnection(tenant, "c1"), doc);
    assert.deepEqual(await requireConnection(tenant, "c1"), doc);
  });

  test("a media record is not found as a database, and requiring it is a plain not_found", async () => {
    const tenant = newTenant();
    await seed(tenant, [mediaDoc("m1", "Contracts", 1)]);
    assert.equal(await findConnection(tenant, "m1"), null);
    await assert.rejects(() => requireConnection(tenant, "m1"), rejectedWith("not_found"));
  });

  test("that is the same answer a missing id gets", async () => {
    const tenant = newTenant();
    await seed(tenant, [mediaDoc("m1", "Contracts", 1)]);
    const forMedia = await requireConnection(tenant, "m1").catch((e: ApiError) => e);
    const forMissing = await requireConnection(tenant, "nope").catch((e: ApiError) => e);
    assert.ok(forMedia instanceof ApiError && forMissing instanceof ApiError);
    assert.equal(forMedia.code, forMissing.code);
    assert.equal(forMedia.status, 404);
  });

  test("the record is not deleted, only invisible: the explicit lookup still returns it", async () => {
    const tenant = newTenant();
    const doc = mediaDoc("m1", "Contracts", 1);
    await seed(tenant, [doc]);
    assert.deepEqual(await findAnyConnection(tenant, "m1"), doc);
  });

  test("a record in another workspace is not found in this one", async () => {
    const mine = newTenant();
    const theirs = newTenant();
    await seed(theirs, [mediaDoc("m1", "Contracts", 1), databaseDoc("c1", "Sales", 2)]);
    assert.equal(await findAnyConnection(mine, "m1"), null);
    assert.equal(await findConnection(mine, "c1"), null);
  });
});

// ---------------------------------------------------------------------------
// The second wall
// ---------------------------------------------------------------------------

describe("nothing that is not a database reaches a credential, a connector or a statement", () => {
  // Typed as a database on purpose: this is what a caller that went round the
  // lookups would be holding.
  const smuggled = (id: string) => mediaDoc(id, "Contracts", 1) as unknown as ConnectionDoc;

  test("the assertion refuses it as an invalid request", () => {
    assert.throws(() => assertDatabaseConnection(smuggled("m1")), rejectedWith("invalid_request"));
    assert.doesNotThrow(() => assertDatabaseConnection(databaseDoc("c1", "Sales", 1)));
  });

  test("reading credentials, building connector options, testing and reading a schema all refuse it", async () => {
    const tenant = newTenant();
    const doc = smuggled("m1");
    const spy = watchSecrets();
    try {
      await assert.rejects(() => readCredentials(doc), rejectedWith("invalid_request"));
      await assert.rejects(() => connectorOptions(doc), rejectedWith("invalid_request"));
      await assert.rejects(() => testConnection(tenant, doc), rejectedWith("invalid_request"));
      await assert.rejects(() => getSchema(tenant, doc), rejectedWith("invalid_request"));
    } finally {
      spy.stop();
    }
    assert.deepEqual(spy.reads, [], "no secret may be read on behalf of a media record");
  });

  test("a cached schema does not answer for it", async () => {
    const tenant = newTenant();
    // The key format is connections.ts's own; this is the scenario it guards
    // against, so it is written out rather than imported.
    await stores().kv.set(
      `schema:${tenant}:m1`,
      { tables: [{ schema: "public", name: "leaked", description: null, row_estimate: 1, columns: [] }], fetched_at: stamp(0) },
      60
    );
    await assert.rejects(() => getSchema(tenant, smuggled("m1")), rejectedWith("invalid_request"));
  });

  test("running a statement against it is refused before anything is recorded", async () => {
    const tenant = newTenant();
    const spy = watchSecrets();
    try {
      await assert.rejects(
        () => runQuery(tenant, smuggled("m1"), { sql: "SELECT 1", userId: "usr_x" }),
        rejectedWith("invalid_request")
      );
    } finally {
      spy.stop();
    }
    assert.deepEqual(spy.reads, []);
    assert.equal(await collectionSize("queries", tenant), 0, "a refused statement must not leave a query record");
  });

  test("the connector registry has no factory for it", () => {
    assert.equal((SUPPORTED_ENGINES as string[]).includes("media"), false);
    assert.throws(
      () => createConnector("media" as never, { credentials: {}, maxRows: 1, allowWrites: false }),
      (error: unknown) => error instanceof ApiError
    );
  });

  test("nothing can create one through the database service either", async () => {
    const tenant = newTenant();
    await assert.rejects(
      () => createConnection(tenant, { name: "Sneaky", engine: "media", allow_writes: false, max_rows: 1 }),
      rejectedWith("invalid_request")
    );
    assert.equal((await stores().documents.list("connections", tenant, { orderBy: "created_at", order: "asc", limit: 10 })).length, 0);
  });
});

// ---------------------------------------------------------------------------
// The HTTP surface
// ---------------------------------------------------------------------------

describe("the API cannot be steered onto a media connection", () => {
  async function workspace() {
    const tenant = newTenant();
    const media = mediaDoc("conn_media", "Contracts", 2);
    await seed(tenant, [databaseDoc("conn_db", "Sales", 1), media]);
    return { tenant, key: await apiKeyFor(tenant), media };
  }

  test("the connection list holds the database and not the library", async () => {
    const { key } = await workspace();
    const response = await listConnectionsRoute(request("GET", "/api/v1/connections", key));
    assert.equal(response.status, 200);
    const body = (await response.json()) as { data: { id: string }[]; has_more: boolean };
    assert.deepEqual(body.data.map((d) => d.id), ["conn_db"]);
    assert.equal(body.has_more, false);
  });

  test("a media id is a 404 on every database endpoint, and the database still answers", async () => {
    const { key } = await workspace();
    const get = (id: string) => getConnectionRoute(request("GET", `/api/v1/connections/${id}`, key), context({ connection_id: id }));
    assert.equal((await get("conn_db")).status, 200);
    assert.equal((await get("conn_media")).status, 404);

    const schema = await schemaRoute(request("GET", "/api/v1/connections/conn_media/schema", key), context({ connection_id: "conn_media" }));
    assert.equal(schema.status, 404);
    const probe = await testRoute(request("POST", "/api/v1/connections/conn_media/test", key), context({ connection_id: "conn_media" }));
    assert.equal(probe.status, 404);
  });

  test("changing or deleting it through the database endpoints leaves it exactly as it was", async () => {
    const { tenant, key, media } = await workspace();
    const patch = await patchConnectionRoute(
      request("PATCH", "/api/v1/connections/conn_media", key, { name: "Renamed" }),
      context({ connection_id: "conn_media" })
    );
    assert.equal(patch.status, 404);
    // Delete is idempotent by design and answers 204 for anything it cannot
    // find, so what matters here is that the record survives it.
    await deleteConnectionRoute(request("DELETE", "/api/v1/connections/conn_media", key), context({ connection_id: "conn_media" }));
    assert.deepEqual(await findAnyConnection(tenant, "conn_media"), media);
  });

  test("a statement addressed to it is a 404 and nothing runs or is recorded", async () => {
    const { tenant, key } = await workspace();
    const spy = watchSecrets();
    let response: Response;
    try {
      response = await queryRoute(request("POST", "/api/v1/queries", key, { connection_id: "conn_media", sql: "SELECT 1" }));
    } finally {
      spy.stop();
    }
    assert.equal(response.status, 404);
    assert.deepEqual(spy.reads, []);
    assert.equal(await collectionSize("queries", tenant), 0);
  });

  test("the database endpoint that does run a statement still does", async () => {
    const { key } = await workspace();
    const response = await queryRoute(request("POST", "/api/v1/queries", key, { connection_id: "conn_db", sql: "SELECT 1 AS one LIMIT 1" }));
    assert.equal(response.status, 201);
    const body = (await response.json()) as { status: string };
    assert.equal(body.status, "succeeded");
  });

  test("a media connection cannot be created through the database endpoint", async () => {
    const { tenant, key } = await workspace();
    const before = (await stores().documents.list("connections", tenant, { orderBy: "created_at", order: "asc", limit: 50 })).length;
    const response = await createConnectionRoute(
      request("POST", "/api/v1/connections", key, { name: "Sneaky", engine: "media" })
    );
    assert.ok(response.status >= 400 && response.status < 500, `got ${response.status}`);
    const after = (await stores().documents.list("connections", tenant, { orderBy: "created_at", order: "asc", limit: 50 })).length;
    assert.equal(after, before);
  });
});

describe("a conversation cannot bind to a media connection", () => {
  async function workspace() {
    const tenant = newTenant();
    await seed(tenant, [databaseDoc("conn_db", "Sales", 1), mediaDoc("conn_media", "Contracts", 2)]);
    return { tenant, key: await apiKeyFor(tenant) };
  }

  test("creating one bound to it is refused and no conversation is left behind", async () => {
    const { tenant, key } = await workspace();
    const response = await createConversationRoute(
      request("POST", "/api/v1/conversations", key, { title: "x", connection_id: "conn_media" })
    );
    assert.equal(response.status, 404);
    assert.equal(await collectionSize("conversations", tenant), 0);
  });

  test("creating one bound to a database still works", async () => {
    const { key } = await workspace();
    const response = await createConversationRoute(
      request("POST", "/api/v1/conversations", key, { title: "x", connection_id: "conn_db" })
    );
    assert.equal(response.status, 201);
    assert.equal(((await response.json()) as { connection_id: string }).connection_id, "conn_db");
  });

  test("an existing conversation cannot be re-bound to it, and keeps the database it had", async () => {
    const { tenant, key } = await workspace();
    const conversation = await createConversation(tenant, { connectionId: "conn_db", userId: "usr_x" });
    const response = await patchConversationRoute(
      request("PATCH", `/api/v1/conversations/${conversation.id}`, key, { connection_id: "conn_media" }),
      context({ conversation_id: conversation.id })
    );
    assert.equal(response.status, 404);
    const after = await getConversationRoute(
      request("GET", `/api/v1/conversations/${conversation.id}`, key),
      context({ conversation_id: conversation.id })
    );
    assert.equal(((await after.json()) as { connection_id: string }).connection_id, "conn_db");
  });

  test("a run that names it is refused before a message or a run is created", async () => {
    const { tenant, key } = await workspace();
    const conversation = await createConversation(tenant, { connectionId: null, userId: "usr_x" });
    const response = await runRoute(
      request("POST", `/api/v1/conversations/${conversation.id}/runs`, key, {
        content: "How many rows?",
        connection_id: "conn_media",
      }),
      context({ conversation_id: conversation.id })
    );
    assert.equal(response.status, 404);
    assert.equal(await collectionSize("messages", tenant), 0);
    assert.equal(await collectionSize("runs", tenant), 0);
  });

  test("a conversation that already points at one, however it got there, cannot run against it", async () => {
    const { tenant, key } = await workspace();
    const conversation = await createConversation(tenant, { connectionId: null, userId: "usr_x" });
    // Written straight to the store: the API refuses to do this, which is the
    // point, so this is what a record from some other route would look like.
    await stores().documents.patch("conversations", tenant, conversation.id, { connection_id: "conn_media" });
    const spy = watchSecrets();
    let response: Response;
    try {
      response = await runRoute(
        request("POST", `/api/v1/conversations/${conversation.id}/runs`, key, { content: "How many rows?" }),
        context({ conversation_id: conversation.id })
      );
    } finally {
      spy.stop();
    }
    assert.equal(response.status, 404);
    assert.deepEqual(spy.reads, []);
    assert.equal(await collectionSize("messages", tenant), 0);
    assert.equal(await collectionSize("runs", tenant), 0);
  });
});

// ---------------------------------------------------------------------------
// Existing databases are unaffected
// ---------------------------------------------------------------------------

describe("databases behave as before", () => {
  test("a database made through the service is listed, found, introspected and queried", async () => {
    const tenant = newTenant();
    const created = await createConnection(tenant, { name: "Sample", engine: "demo", allow_writes: false, max_rows: 50 });
    assert.equal(created.kind, undefined, "a database record still carries no kind");

    const page = await listConnections(tenant, readListParams(new URL("http://x/?limit=50")));
    assert.deepEqual(page.data.map((d) => d.id), [created.id]);
    assert.deepEqual(await requireConnection(tenant, created.id), created);

    const schema = await getSchema(tenant, created);
    assert.ok(schema.tables.length > 0);

    const query = await runQuery(tenant, created, { sql: "SELECT 1 AS one LIMIT 2", userId: "usr_x" });
    assert.equal(query.status, "succeeded");
    assert.equal(query.row_count, 2);
  });

  test("a media record in the same workspace changes none of that", async () => {
    const tenant = newTenant();
    const created = await createConnection(tenant, { name: "Sample", engine: "demo", allow_writes: false, max_rows: 50 });
    const before = await getSchema(tenant, created);

    await seed(tenant, [mediaDoc("m1", "Contracts", 9999)]);

    const page = await listConnections(tenant, readListParams(new URL("http://x/?limit=50")));
    assert.deepEqual(page.data.map((d) => d.id), [created.id]);
    assert.deepEqual((await getSchema(tenant, created)).tables, before.tables);
    const query = await runQuery(tenant, created, { sql: "SELECT 1 AS one LIMIT 2", userId: "usr_x" });
    assert.equal(query.status, "succeeded");
  });
});

// ---------------------------------------------------------------------------
// Tripwires
// ---------------------------------------------------------------------------

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(): { file: string; text: string }[] {
  const found: { file: string; text: string }[] = [];
  for (const dir of ["lib", "app", "components", "hooks"]) {
    for (const entry of readdirSync(path.join(ROOT, dir), { recursive: true }) as string[]) {
      if (!/[.]tsx?$/.test(entry)) continue;
      const full = path.join(ROOT, dir, entry);
      found.push({ file: [dir, ...entry.split(path.sep)].join("/"), text: readFileSync(full, "utf8") });
    }
  }
  return found;
}

describe("tripwires that keep the floor from being walked round later", () => {
  test("only the connections service touches the connections collection", () => {
    // A call on the document store naming the collection, with or without a
    // type argument: `documents.list<Foo>("connections", ...)`. Not the bare
    // word, which is also a settings tab.
    const storeCall = /documents\s*\.\s*\w+\s*(<[^>]*>)?\s*\(\s*["']connections["']/;
    const allowed = new Set(["lib/services/connections.ts"]);
    const offenders = sourceFiles()
      .filter(({ file, text }) => !allowed.has(file) && storeCall.test(text))
      .map(({ file }) => file);
    assert.deepEqual(
      offenders,
      [],
      "reading the collection directly bypasses the lookups that skip media records; go through connections.ts"
    );
  });

  test("the lookup that returns any kind of connection has no callers yet", () => {
    // Deliberately empty. The phase that first needs to see a media record adds
    // its file here, in the same commit, so the decision to look past the
    // database-only lookups is visible in review rather than in a diff of a
    // route.
    const allowed = new Set(["lib/services/connections.ts"]);
    const callers = sourceFiles()
      .filter(({ file, text }) => !allowed.has(file) && text.includes("findAnyConnection"))
      .map(({ file }) => file);
    assert.deepEqual(callers, []);
  });

  test("this suite runs with the media flag off", () => {
    assert.equal(mediaConnectionsEnabled(), false);
  });
});
