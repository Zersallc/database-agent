/**
 * The contract promises `details.fields`, and the promise is that an integrator
 * whose request 400s can fix every mistake in one round trip. So these tests
 * care as much about *which* issues come back as about the rejection itself.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { ApiError } from "@/lib/api/errors";
import {
  array,
  boolean,
  integer,
  object,
  oneOf,
  optional,
  readJson,
  string,
  unknown,
  validate,
  withDefault,
  type Issue,
} from "@/lib/api/validate";

function failure(fn: () => unknown): ApiError {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof ApiError, `expected ApiError, got ${String(err)}`);
    return err;
  }
  assert.fail("expected a throw");
}

function fieldsOf(err: ApiError): Issue[] {
  return (err.details?.fields ?? []) as Issue[];
}

describe("string", () => {
  test("accepts and trims by default", () => {
    assert.equal(validate("  hello  ", string()), "hello");
  });

  test("trim can be turned off", () => {
    assert.equal(validate("  hello  ", string({ trim: false })), "  hello  ");
  });

  test("rejects non-strings", () => {
    assert.deepEqual(fieldsOf(failure(() => validate(42, string()))), [
      { path: "", issue: "must be a string" },
    ]);
  });

  test("min=1 reports emptiness in plain words", () => {
    assert.equal(fieldsOf(failure(() => validate("", string({ min: 1 }))))[0].issue, "must not be empty");
    // Whitespace-only is empty once trimmed.
    assert.equal(
      fieldsOf(failure(() => validate("   ", string({ min: 1 }))))[0].issue,
      "must not be empty"
    );
  });

  test("min > 1 reports the length", () => {
    assert.equal(
      fieldsOf(failure(() => validate("ab", string({ min: 3 }))))[0].issue,
      "must be at least 3 characters"
    );
  });

  test("max is enforced", () => {
    assert.equal(validate("abcde", string({ max: 5 })), "abcde");
    assert.equal(
      fieldsOf(failure(() => validate("abcdef", string({ max: 5 }))))[0].issue,
      "must be at most 5 characters"
    );
  });

  test("email format accepts ordinary addresses", () => {
    for (const good of ["a@b.co", "first.last+tag@sub.example.com"]) {
      assert.equal(validate(good, string({ format: "email" })), good);
    }
  });

  test("email format rejects obvious typos", () => {
    for (const bad of ["nope", "a@b", "a b@c.com", "@b.co", "a@.co"]) {
      const err = failure(() => validate(bad, string({ format: "email" })));
      assert.equal(fieldsOf(err)[0].issue, "must be a valid email address", `${bad} should fail`);
    }
  });
});

describe("oneOf", () => {
  const role = oneOf(["admin", "member", "viewer"] as const);

  test("accepts a listed value", () => {
    assert.equal(validate("admin", role), "admin");
  });

  test("rejects anything else and lists the options", () => {
    assert.equal(
      fieldsOf(failure(() => validate("owner", role)))[0].issue,
      "must be one of: admin, member, viewer"
    );
    assert.equal(fieldsOf(failure(() => validate(1, role)))[0].issue, "must be one of: admin, member, viewer");
  });
});

describe("integer", () => {
  test("accepts integers", () => {
    assert.equal(validate(5, integer()), 5);
    assert.equal(validate(0, integer()), 0);
    assert.equal(validate(-3, integer()), -3);
  });

  test("rejects non-integers", () => {
    for (const bad of [1.5, "5", NaN, Infinity, true, null]) {
      assert.equal(fieldsOf(failure(() => validate(bad, integer())))[0].issue, "must be an integer");
    }
  });

  test("enforces min and max", () => {
    assert.equal(validate(10, integer({ min: 1, max: 10 })), 10);
    assert.equal(
      fieldsOf(failure(() => validate(0, integer({ min: 1, max: 10 }))))[0].issue,
      "must be between 1 and 10"
    );
    assert.equal(
      fieldsOf(failure(() => validate(11, integer({ min: 1, max: 10 }))))[0].issue,
      "must be between 1 and 10"
    );
  });
});

describe("boolean", () => {
  test("accepts booleans only", () => {
    assert.equal(validate(true, boolean()), true);
    assert.equal(validate(false, boolean()), false);
    assert.equal(fieldsOf(failure(() => validate("true", boolean())))[0].issue, "must be a boolean");
  });
});

describe("array", () => {
  test("validates each element", () => {
    assert.deepEqual(validate(["a", "b"], array(string())), ["a", "b"]);
  });

  test("rejects non-arrays", () => {
    assert.equal(fieldsOf(failure(() => validate("a", array(string()))))[0].issue, "must be an array");
  });

  test("enforces max length", () => {
    assert.equal(
      fieldsOf(failure(() => validate([1, 2, 3], array(integer(), { max: 2 }))))[0].issue,
      "must contain at most 2 items"
    );
  });

  test("element issues are reported with an indexed path", () => {
    const err = failure(() => validate(["ok", 5, 7], array(string())));
    assert.deepEqual(fieldsOf(err), [
      { path: "[1]", issue: "must be a string" },
      { path: "[2]", issue: "must be a string" },
    ]);
  });
});

describe("object", () => {
  const shape = object({
    name: string({ min: 1 }),
    role: oneOf(["admin", "member"] as const),
    age: optional(integer({ min: 0 })),
    active: withDefault(boolean(), true),
  });

  test("parses a valid body", () => {
    assert.deepEqual(validate({ name: "Ada", role: "admin", age: 36, active: false }, shape), {
      name: "Ada",
      role: "admin",
      age: 36,
      active: false,
    });
  });

  test("applies defaults and leaves optionals undefined", () => {
    assert.deepEqual(validate({ name: "Ada", role: "member" }, shape), {
      name: "Ada",
      role: "member",
      age: undefined,
      active: true,
    });
  });

  test("null is treated as absent", () => {
    const parsed = validate({ name: "Ada", role: "member", age: null, active: null }, shape);
    assert.equal(parsed.age, undefined);
    assert.equal(parsed.active, true);
  });

  test("drops unknown keys instead of echoing them back", () => {
    const parsed = validate(
      { name: "Ada", role: "admin", is_admin: true, __proto__: { polluted: true }, extra: "x" },
      shape
    );
    assert.deepEqual(Object.keys(parsed).sort(), ["active", "age", "name", "role"]);
    assert.equal("extra" in parsed, false);
    assert.equal("is_admin" in parsed, false);
  });

  test("missing required fields are reported as required", () => {
    const err = failure(() => validate({}, shape));
    assert.deepEqual(fieldsOf(err), [
      { path: "name", issue: "is required" },
      { path: "role", issue: "is required" },
    ]);
  });

  test("rejects non-objects", () => {
    assert.equal(fieldsOf(failure(() => validate([], shape)))[0].issue, "must be an object");
    assert.equal(fieldsOf(failure(() => validate("x", shape)))[0].issue, "must be an object");
    assert.equal(fieldsOf(failure(() => validate(null, shape)))[0].issue, "must be an object");
  });

  test("nested paths are dotted", () => {
    const nested = object({ owner: object({ email: string({ format: "email" }) }) });
    assert.deepEqual(fieldsOf(failure(() => validate({ owner: { email: "nope" } }, nested))), [
      { path: "owner.email", issue: "must be a valid email address" },
    ]);
  });

  test("paths inside arrays of objects combine both forms", () => {
    const nested = object({ members: array(object({ role: oneOf(["admin"] as const) })) });
    assert.deepEqual(fieldsOf(failure(() => validate({ members: [{ role: "nope" }] }, nested))), [
      { path: "members[0].role", issue: "must be one of: admin" },
    ]);
  });
});

describe("validate collects every issue before throwing", () => {
  const shape = object({
    name: string({ min: 1 }),
    role: oneOf(["admin", "member"] as const),
    age: integer({ min: 0 }),
  });

  test("three mistakes produce three issues, not one", () => {
    const err = failure(() => validate({ name: "", role: "owner", age: "old" }, shape));
    assert.deepEqual(fieldsOf(err), [
      { path: "name", issue: "must not be empty" },
      { path: "role", issue: "must be one of: admin, member" },
      { path: "age", issue: "must be an integer" },
    ]);
  });

  test("the error is a 400 validation_failed", () => {
    const err = failure(() => validate({}, shape));
    assert.equal(err.code, "validation_failed");
    assert.equal(err.status, 400);
  });

  test("the message names the first field and counts the rest", () => {
    const err = failure(() => validate({ name: "", role: "owner", age: "old" }, shape));
    assert.equal(err.message, "name must not be empty (and 2 other problems).");
  });

  test("a single problem is phrased in the singular", () => {
    const err = failure(() => validate({ name: "", role: "admin", age: 1 }, shape));
    assert.equal(err.message, "name must not be empty.");
  });

  test("two problems say 'other problem', singular", () => {
    const err = failure(() => validate({ name: "", role: "owner", age: 1 }, shape));
    assert.equal(err.message, "name must not be empty (and 1 other problem).");
  });

  test("a top-level failure is described as the request body", () => {
    assert.equal(failure(() => validate("nope", shape)).message, "request body must be an object.");
  });
});

describe("unknown", () => {
  test("passes any JSON value through untouched", () => {
    const value = { anything: [1, "two", { three: true }] };
    assert.equal(validate(value, unknown()), value);
    assert.equal(validate(null, unknown()), null);
  });
});

describe("readJson", () => {
  const post = (body: string) => new Request("https://api.example.com/v1/things", { method: "POST", body });

  test("parses a JSON body", async () => {
    assert.deepEqual(await readJson(post('{"a":1}')), { a: 1 });
  });

  test("an empty body is an empty object, not an error", async () => {
    assert.deepEqual(await readJson(post("")), {});
    assert.deepEqual(await readJson(post("   \n ")), {});
  });

  test("malformed JSON becomes a 400, not a 500", async () => {
    try {
      await readJson(post("{not json"));
      assert.fail("expected a throw");
    } catch (err) {
      assert.ok(err instanceof ApiError);
      assert.equal(err.code, "invalid_request");
      assert.equal(err.status, 400);
    }
  });
});
