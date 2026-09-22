/**
 * A4: the media connection CRUD service functions (lib/services/connections.ts)
 * and the route-level authorization gate in front of them
 * (app/api/v1/companies/[company_id]/media-connections/*).
 *
 * Route bodies are exercised directly against the service layer (the same
 * approach tests/sources.test.ts already uses for resolveSources): every
 * write a route can make goes through createMediaConnection /
 * updateMediaConnection / deleteMediaConnection, so testing those functions
 * against the real in-memory store covers what a route does once it is past
 * its auth gate.
 *
 * The auth gate itself IS exercised through the real route handlers, the
 * same way tests/media-connections-floor.test.ts drives /v1/connections: a
 * Bearer API key is always supplied. What is deliberately NOT attempted here
 * is a true "no credentials at all" request — every existing v1 route test
 * in this repo avoids that path too, because it falls through to NextAuth's
 * real auth(), which depends on request-scoped internals (next/headers) that
 * do not exist when a handler is called directly from node:test rather than
 * through Next's own server runtime. The property that matters most for
 * these routes — that a Bearer API key can never manage media connections,
 * regardless of role — does not need that path: requireDeveloperRole
 * rejects every API key before any tenant lookup runs.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

import { ApiError } from "@/lib/api/errors";
import { SYSTEM_PARTITION, hashApiKey, type ApiKeyRecord, type Role } from "@/lib/api/auth";
import { stores } from "@/lib/providers";
import {
  createMediaConnection,
  deleteMediaConnection,
  findMediaConnection,
  requireMediaConnection,
  serializeMediaConnection,
  updateMediaConnection,
  type ConnectionDoc,
} from "@/lib/services/connections";
import { resolveSources } from "@/lib/services/sources";

import { GET as listRoute, POST as createRoute } from "@/app/api/v1/companies/[company_id]/media-connections/route";
import {
  DELETE as deleteRoute,
  GET as getRoute,
  PATCH as patchRoute,
} from "@/app/api/v1/companies/[company_id]/media-connections/[connection_id]/route";

let counter = 0;
const newTenant = () => `ten_mcr_${++counter}`;
const stamp = (n: number) => new Date(Date.UTC(2026, 8, 1, 0, 0, n)).toISOString();

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

async function seedDatabase(tenantId: string, doc: ConnectionDoc) {
  await stores().documents.put("connections", tenantId, doc);
}

function rejectedWith(code: string) {
  return (error: unknown) => error instanceof ApiError && error.code === code;
}

// ---------------------------------------------------------------------------
// createMediaConnection
// ---------------------------------------------------------------------------

describe("createMediaConnection", () => {
  test("writes alias_id as the connection's own id, never as anything a caller supplies", async () => {
    const tenant = newTenant();
    const doc = await createMediaConnection(tenant, { name: "Contracts" });
    assert.equal(doc.media.alias_id, doc.id);
    assert.equal(doc.media.server_ref, "default");
    assert.equal(doc.media.library_ref, null);
    assert.equal(doc.enabled, true);
    assert.equal(doc.description, null);
    assert.equal(doc.status, "unknown");
  });

  test("trims the name and an empty name is rejected", async () => {
    const tenant = newTenant();
    const doc = await createMediaConnection(tenant, { name: "  Contracts  " });
    assert.equal(doc.name, "Contracts");
    await assert.rejects(
      () => createMediaConnection(tenant, { name: "   " }),
      rejectedWith("invalid_request")
    );
  });

  test("a name already used by a media connection in this tenant is rejected, case-insensitively", async () => {
    const tenant = newTenant();
    await createMediaConnection(tenant, { name: "Contracts" });
    await assert.rejects(
      () => createMediaConnection(tenant, { name: "  CONTRACTS  " }),
      rejectedWith("resource_conflict")
    );
  });

  test("a name already used by a database connection in this tenant is also rejected", async () => {
    const tenant = newTenant();
    await seedDatabase(tenant, databaseDoc("c1", "Sales", 1));
    await assert.rejects(() => createMediaConnection(tenant, { name: "sales" }), rejectedWith("resource_conflict"));
  });

  test("the same name is allowed in a different tenant", async () => {
    const a = newTenant();
    const b = newTenant();
    await createMediaConnection(a, { name: "Contracts" });
    const doc = await createMediaConnection(b, { name: "Contracts" });
    assert.equal(doc.name, "Contracts");
  });

  test("server_ref must be a value this deployment understands", async () => {
    const tenant = newTenant();
    await assert.rejects(
      () => createMediaConnection(tenant, { name: "Contracts", server_ref: "some-other-server" }),
      rejectedWith("invalid_request")
    );
    const doc = await createMediaConnection(tenant, { name: "Contracts", server_ref: "default" });
    assert.equal(doc.media.server_ref, "default");
  });

  test("library_ref accepts the safety charset and rejects outside it", async () => {
    const tenant = newTenant();
    const doc = await createMediaConnection(tenant, { name: "Contracts", library_ref: "acme/contracts-2026" });
    assert.equal(doc.media.library_ref, "acme/contracts-2026");

    await assert.rejects(
      () => createMediaConnection(tenant, { name: "Other", library_ref: "../../etc; drop table" }),
      rejectedWith("invalid_request")
    );
    await assert.rejects(
      () => createMediaConnection(tenant, { name: "Other2", library_ref: "x".repeat(201) }),
      rejectedWith("invalid_request")
    );
  });

  test("enabled: false is honored at creation", async () => {
    const tenant = newTenant();
    const doc = await createMediaConnection(tenant, { name: "Contracts", enabled: false });
    assert.equal(doc.enabled, false);
  });
});

// ---------------------------------------------------------------------------
// updateMediaConnection
// ---------------------------------------------------------------------------

describe("updateMediaConnection", () => {
  test("an unknown id is rejected as not found", async () => {
    const tenant = newTenant();
    await assert.rejects(() => updateMediaConnection(tenant, "conn_missing", { enabled: false }), rejectedWith("not_found"));
  });

  test("a database connection's id is not found here either", async () => {
    const tenant = newTenant();
    await seedDatabase(tenant, databaseDoc("c1", "Sales", 1));
    await assert.rejects(() => updateMediaConnection(tenant, "c1", { enabled: false }), rejectedWith("not_found"));
  });

  test("renaming checks uniqueness excluding itself", async () => {
    const tenant = newTenant();
    const doc = await createMediaConnection(tenant, { name: "Contracts" });
    const renamed = await updateMediaConnection(tenant, doc.id, { name: "Contracts" });
    assert.equal(renamed.name, "Contracts");
  });

  test("renaming to another connection's name is rejected", async () => {
    const tenant = newTenant();
    await createMediaConnection(tenant, { name: "HR Policies" });
    const doc = await createMediaConnection(tenant, { name: "Contracts" });
    await assert.rejects(
      () => updateMediaConnection(tenant, doc.id, { name: "hr policies" }),
      rejectedWith("resource_conflict")
    );
  });

  test("updating library_ref preserves alias_id and server_ref (patch replaces media whole)", async () => {
    const tenant = newTenant();
    const doc = await createMediaConnection(tenant, { name: "Contracts", library_ref: "old-ref" });
    const updated = await updateMediaConnection(tenant, doc.id, { library_ref: "new-ref" });
    assert.equal(updated.media.library_ref, "new-ref");
    assert.equal(updated.media.alias_id, doc.id);
    assert.equal(updated.media.server_ref, "default");
  });

  test("enabled toggles independently of other fields", async () => {
    const tenant = newTenant();
    const doc = await createMediaConnection(tenant, { name: "Contracts" });
    const disabled = await updateMediaConnection(tenant, doc.id, { enabled: false });
    assert.equal(disabled.enabled, false);
    assert.equal(disabled.name, "Contracts");
    const reenabled = await updateMediaConnection(tenant, doc.id, { enabled: true });
    assert.equal(reenabled.enabled, true);
  });

  test("description can be set and explicitly cleared", async () => {
    const tenant = newTenant();
    const doc = await createMediaConnection(tenant, { name: "Contracts" });
    const withDescription = await updateMediaConnection(tenant, doc.id, { description: "Supplier contracts." });
    assert.equal(withDescription.description, "Supplier contracts.");
    const cleared = await updateMediaConnection(tenant, doc.id, { description: null });
    assert.equal(cleared.description, null);
  });
});

// ---------------------------------------------------------------------------
// deleteMediaConnection
// ---------------------------------------------------------------------------

describe("deleteMediaConnection", () => {
  test("deleting an unknown id does not throw", async () => {
    const tenant = newTenant();
    await assert.doesNotReject(() => deleteMediaConnection(tenant, "conn_missing"));
  });

  test("removes the record", async () => {
    const tenant = newTenant();
    const doc = await createMediaConnection(tenant, { name: "Contracts" });
    await deleteMediaConnection(tenant, doc.id);
    assert.equal(await findMediaConnection(tenant, doc.id), null);
  });

  test("does not touch a database connection sharing the collection", async () => {
    const tenant = newTenant();
    await seedDatabase(tenant, databaseDoc("c1", "Sales", 1));
    const doc = await createMediaConnection(tenant, { name: "Contracts" });
    await deleteMediaConnection(tenant, doc.id);
    const remaining = await stores().documents.get("connections", tenant, "c1");
    assert.ok(remaining);
  });
});

// ---------------------------------------------------------------------------
// findMediaConnection / requireMediaConnection
// ---------------------------------------------------------------------------

describe("findMediaConnection / requireMediaConnection", () => {
  test("a database connection's id is invisible", async () => {
    const tenant = newTenant();
    await seedDatabase(tenant, databaseDoc("c1", "Sales", 1));
    assert.equal(await findMediaConnection(tenant, "c1"), null);
    await assert.rejects(() => requireMediaConnection(tenant, "c1"), rejectedWith("not_found"));
  });

  test("another tenant's record is invisible", async () => {
    const mine = newTenant();
    const theirs = newTenant();
    const doc = await createMediaConnection(theirs, { name: "Contracts" });
    assert.equal(await findMediaConnection(mine, doc.id), null);
  });
});

// ---------------------------------------------------------------------------
// serializeMediaConnection
// ---------------------------------------------------------------------------

describe("serializeMediaConnection", () => {
  test("never includes alias_id", async () => {
    const tenant = newTenant();
    const doc = await createMediaConnection(tenant, { name: "Contracts", library_ref: "ref-1" });
    const wire = serializeMediaConnection(doc);
    // alias_id equals the connection's own id by design (see
    // createMediaConnection), so this checks the KEY is absent, not the
    // value — the id itself is legitimately part of the wire shape.
    assert.equal("alias_id" in wire.media, false);
    assert.deepEqual(wire.media, { library_ref: "ref-1", server_ref: "default" });
    assert.equal(wire.kind, "media");
    assert.equal(wire.enabled, true);
  });
});

// ---------------------------------------------------------------------------
// Integration: what createMediaConnection writes is what resolveSources sees
// ---------------------------------------------------------------------------

describe("integration with resolveSources", () => {
  const ON = { MEDIA_CONNECTIONS_ENABLED: "true" };
  const OFF = { MEDIA_CONNECTIONS_ENABLED: "false" };

  test("a newly created, enabled connection is offered once the flag is on", async () => {
    const tenant = newTenant();
    await createMediaConnection(tenant, { name: "Contracts", description: "Supplier contracts." });
    const { libraries } = await resolveSources({ tenantId: tenant, userId: null }, { env: ON });
    assert.deepEqual(
      libraries.map((l) => l.name),
      ["Contracts"]
    );
  });

  test("disabling it through updateMediaConnection removes it from resolveSources", async () => {
    const tenant = newTenant();
    const doc = await createMediaConnection(tenant, { name: "Contracts" });
    await updateMediaConnection(tenant, doc.id, { enabled: false });
    const { libraries } = await resolveSources({ tenantId: tenant, userId: null }, { env: ON });
    assert.deepEqual(libraries, []);
  });

  test("it is not offered at all while the deployment flag is off", async () => {
    const tenant = newTenant();
    await createMediaConnection(tenant, { name: "Contracts" });
    const { libraries } = await resolveSources({ tenantId: tenant, userId: null }, { env: OFF });
    assert.deepEqual(libraries, []);
  });

  test("deleting it removes it from resolveSources", async () => {
    const tenant = newTenant();
    const doc = await createMediaConnection(tenant, { name: "Contracts" });
    await deleteMediaConnection(tenant, doc.id);
    const { libraries } = await resolveSources({ tenantId: tenant, userId: null }, { env: ON });
    assert.deepEqual(libraries, []);
  });
});

// ---------------------------------------------------------------------------
// Route-level authorization: an API key can never reach these routes
// ---------------------------------------------------------------------------

async function apiKeyFor(tenantId: string, role: Role): Promise<string> {
  const key = `mcr-test-key-${tenantId}-${role}`;
  const record: ApiKeyRecord = {
    id: await hashApiKey(key),
    key_id: `key_${tenantId}_${role}`,
    key_hint: "test",
    tenant_id: tenantId,
    user_id: "usr_mcr_test",
    role,
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

describe("media connection routes: an API key is never a Developer session", () => {
  test("GET (list) with a full-scope API key is 403, not 200", async () => {
    const tenant = newTenant();
    const key = await apiKeyFor(tenant, "admin");
    const res = await listRoute(request("GET", `/api/v1/companies/${tenant}/media-connections`, key), context({ company_id: tenant }));
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.code, "insufficient_role");
  });

  test("POST (create) with a full-scope API key is 403, and nothing is created", async () => {
    const tenant = newTenant();
    const key = await apiKeyFor(tenant, "admin");
    const res = await createRoute(
      request("POST", `/api/v1/companies/${tenant}/media-connections`, key, { name: "Contracts" }),
      context({ company_id: tenant })
    );
    assert.equal(res.status, 403);
    const { libraries } = await resolveSources(
      { tenantId: tenant, userId: null },
      { env: { MEDIA_CONNECTIONS_ENABLED: "true" } }
    );
    assert.deepEqual(libraries, []);
  });

  test("GET (one), PATCH and DELETE with a full-scope API key are all 403", async () => {
    const tenant = newTenant();
    // Seed directly (bypassing the route, which an API key cannot reach) so
    // there is a real record for the rejected calls to (not) act on.
    const doc = await createMediaConnection(tenant, { name: "Contracts" });
    const key = await apiKeyFor(tenant, "admin");

    const got = await getRoute(
      request("GET", `/api/v1/companies/${tenant}/media-connections/${doc.id}`, key),
      context({ company_id: tenant, connection_id: doc.id })
    );
    assert.equal(got.status, 403);

    const patched = await patchRoute(
      request("PATCH", `/api/v1/companies/${tenant}/media-connections/${doc.id}`, key, { enabled: false }),
      context({ company_id: tenant, connection_id: doc.id })
    );
    assert.equal(patched.status, 403);

    const deleted = await deleteRoute(
      request("DELETE", `/api/v1/companies/${tenant}/media-connections/${doc.id}`, key),
      context({ company_id: tenant, connection_id: doc.id })
    );
    assert.equal(deleted.status, 403);

    // Rejected before reaching the service layer: the record is untouched.
    assert.notEqual(await findMediaConnection(tenant, doc.id), null);
  });

  test("a viewer-role key is rejected at the scope layer before role is even considered", async () => {
    const tenant = newTenant();
    const key = await apiKeyFor(tenant, "viewer");
    const res = await createRoute(
      request("POST", `/api/v1/companies/${tenant}/media-connections`, key, { name: "Contracts" }),
      context({ company_id: tenant })
    );
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.code, "insufficient_scope");
  });
});
