/**
 * The one security-sensitive decision in API key issuance that lives outside
 * the store: whether a key's granted scopes can exceed what its role would
 * normally carry. Everything else in `lib/services/api-keys.ts` is a
 * `documents` store round trip and belongs to integration testing; this is
 * the pure, no-database logic worth guarding directly — the same reasoning
 * `tests/sql-guard.test.ts` and `tests/pagination.test.ts` apply to their own
 * modules.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { ROLE_SCOPES, SCOPES } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/errors";
import { generateRawKey, resolveScopes } from "@/lib/services/api-keys";

function apiErrorFrom(fn: () => unknown): ApiError {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof ApiError, `expected ApiError, got ${String(err)}`);
    return err;
  }
  assert.fail("expected a throw");
}

describe("resolveScopes", () => {
  test("omitted scopes default to everything the role carries", () => {
    assert.deepEqual(resolveScopes("member", undefined), ROLE_SCOPES.member);
    assert.deepEqual(resolveScopes("viewer", undefined), ROLE_SCOPES.viewer);
  });

  test("a requested subset of the role's scopes is kept", () => {
    assert.deepEqual(resolveScopes("member", ["connections:read"]), ["connections:read"]);
  });

  test("a scope the role does not carry is rejected, not silently dropped", () => {
    // 'models:write' is deliberately admin-only (ROLE_SCOPES.member excludes
    // it) -- a key minted for a member must not be able to reach further than
    // the member who requested it could reach in the workspace UI.
    const err = apiErrorFrom(() => resolveScopes("member", ["models:write"]));
    assert.equal(err.code, "invalid_request");
    assert.match(err.message, /models:write/);
    assert.match(err.message, /member/);
  });

  test("one bad scope among good ones is still rejected, naming only the bad one", () => {
    const err = apiErrorFrom(() => resolveScopes("viewer", ["connections:read", "connections:write"]));
    assert.match(err.message, /connections:write/);
    assert.doesNotMatch(err.message, /connections:read,/);
  });

  test("an admin key may be granted any scope in the system", () => {
    assert.deepEqual(resolveScopes("admin", [...SCOPES]), SCOPES.filter(() => true));
  });

  test("duplicate requested scopes collapse to one, and order does not depend on input order", () => {
    const a = resolveScopes("admin", ["runs:write", "connections:read"]);
    const b = resolveScopes("admin", ["connections:read", "runs:write", "connections:read"]);
    assert.deepEqual(a, b);
  });
});

describe("generateRawKey", () => {
  test("is prefixed for recognizability in a log line", () => {
    assert.match(generateRawKey(), /^sk_live_/);
  });

  test("carries enough entropy that two keys never collide in practice", () => {
    const keys = new Set(Array.from({ length: 1000 }, () => generateRawKey()));
    assert.equal(keys.size, 1000);
  });

  test("contains no characters that would need escaping in an Authorization header", () => {
    // base64url by construction, but asserted directly: a key containing '+',
    // '/' or '=' would still work today and break the day someone puts it in
    // a URL instead of a header.
    assert.match(generateRawKey(), /^[A-Za-z0-9_-]+$/);
  });
});
