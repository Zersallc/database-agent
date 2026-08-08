/**
 * The fingerprint decides whether a retry is a retry or a client bug. Clients
 * serialize objects in whatever key order their language hands them, so if key
 * order leaked into the fingerprint, an honest retry would 409 — which is
 * exactly the failure this mechanism exists to prevent.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { readIdempotencyKey, stableStringify } from "@/lib/api/idempotency";
import { ApiError } from "@/lib/api/errors";

/** What the module's private `fingerprint` derives from a body. */
const print = (value: unknown) => stableStringify(value);

describe("stableStringify — key order is invisible", () => {
  test("two orderings of the same object agree", () => {
    assert.equal(print({ a: 1, b: 2 }), print({ b: 2, a: 1 }));
  });

  test("holds for many keys and every rotation", () => {
    const body = { name: "prod", host: "db.example.com", port: 5432, ssl: true };
    const rotations = [
      { ssl: true, port: 5432, host: "db.example.com", name: "prod" },
      { port: 5432, name: "prod", ssl: true, host: "db.example.com" },
      { host: "db.example.com", ssl: true, name: "prod", port: 5432 },
    ];
    for (const rotated of rotations) {
      assert.equal(print(rotated), print(body));
    }
  });

  test("holds at every level of nesting", () => {
    const a = { outer: { inner: { x: 1, y: 2 }, list: [{ p: 1, q: 2 }] }, top: true };
    const b = { top: true, outer: { list: [{ q: 2, p: 1 }], inner: { y: 2, x: 1 } } };
    assert.equal(print(a), print(b));
  });

  test("a real retry of the same request fingerprints identically", () => {
    // The same body as two different clients would have serialized it.
    const fromGo = { connection_id: "conn_1", name: "analytics", read_only: true };
    const fromPython = { read_only: true, name: "analytics", connection_id: "conn_1" };
    assert.equal(print(fromGo), print(fromPython));
  });
});

describe("stableStringify — real differences still differ", () => {
  test("a changed value changes the output", () => {
    assert.notEqual(print({ a: 1 }), print({ a: 2 }));
  });

  test("an added key changes the output", () => {
    assert.notEqual(print({ a: 1 }), print({ a: 1, b: 2 }));
  });

  test("array order is content, not formatting", () => {
    assert.notEqual(print([1, 2]), print([2, 1]));
    assert.notEqual(print({ ids: ["a", "b"] }), print({ ids: ["b", "a"] }));
  });

  test("a key/value swap is not mistaken for a reorder", () => {
    assert.notEqual(print({ a: "b" }), print({ b: "a" }));
  });

  test("string and number values are distinguishable", () => {
    assert.notEqual(print({ port: 5432 }), print({ port: "5432" }));
  });

  test("keys are quoted, so no delimiter confusion between adjacent keys", () => {
    // Without quoting, {"a:1,b": 2} and {a: 1, b: 2} could collide.
    assert.notEqual(print({ "a:1,b": 2 }), print({ a: 1, b: 2 }));
  });
});

describe("stableStringify — values", () => {
  test("primitives match JSON.stringify", () => {
    assert.equal(print(1), "1");
    assert.equal(print("x"), '"x"');
    assert.equal(print(true), "true");
    assert.equal(print(null), "null");
  });

  test("undefined becomes null rather than breaking the string", () => {
    assert.equal(print(undefined), "null");
  });

  test("undefined properties are omitted, matching JSON over the wire", () => {
    // A client that sent no `age` and one whose serializer dropped `age:
    // undefined` sent the same bytes; they must fingerprint the same.
    assert.equal(print({ a: 1, b: undefined }), print({ a: 1 }));
  });

  test("undefined inside an array stays a positional null", () => {
    assert.equal(print([1, undefined, 3]), "[1,null,3]");
  });

  test("empty structures are stable", () => {
    assert.equal(print({}), "{}");
    assert.equal(print([]), "[]");
  });

  test("output is deterministic across repeated calls", () => {
    const body = { z: 1, a: { n: [3, 2, 1] }, m: "x" };
    assert.equal(print(body), print(body));
    assert.equal(print(body), print(structuredClone(body)));
  });

  test("an object is never confused with an array of its values", () => {
    assert.notEqual(print({ 0: "a", 1: "b" }), print(["a", "b"]));
  });
});

describe("readIdempotencyKey", () => {
  const withHeaders = (headers: Record<string, string>) =>
    new Request("https://api.example.com/v1/connections", { method: "POST", headers });

  function failure(fn: () => unknown): ApiError {
    try {
      fn();
    } catch (err) {
      assert.ok(err instanceof ApiError, `expected ApiError, got ${String(err)}`);
      return err;
    }
    assert.fail("expected a throw");
  }

  test("reads and trims the key", () => {
    assert.equal(readIdempotencyKey(withHeaders({ "Idempotency-Key": "  abc  " })), "abc");
  });

  test("the header name is case-insensitive, as HTTP requires", () => {
    assert.equal(readIdempotencyKey(withHeaders({ "idempotency-key": "abc" })), "abc");
  });

  test("a missing key is rejected with its own code", () => {
    const err = failure(() => readIdempotencyKey(withHeaders({})));
    assert.equal(err.code, "missing_idempotency_key");
    assert.equal(err.status, 400);
  });

  test("a whitespace-only key counts as missing", () => {
    assert.equal(
      failure(() => readIdempotencyKey(withHeaders({ "Idempotency-Key": "   " }))).code,
      "missing_idempotency_key"
    );
  });

  test("an over-long key is rejected", () => {
    const err = failure(() =>
      readIdempotencyKey(withHeaders({ "Idempotency-Key": "k".repeat(256) }))
    );
    assert.equal(err.code, "invalid_request");
  });

  test("a key at the length limit is accepted", () => {
    const key = "k".repeat(255);
    assert.equal(readIdempotencyKey(withHeaders({ "Idempotency-Key": key })), key);
  });
});
