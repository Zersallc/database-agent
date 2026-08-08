/**
 * The two failure modes worth guarding are the silent ones: a cursor reused
 * with a flipped order (which skips or repeats rows) and a cursor whose anchor
 * row was deleted (which would otherwise replay the list from the top).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { ApiError } from "@/lib/api/errors";
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  buildPage,
  decodeCursor,
  encodeCursor,
  paginateInMemory,
  readListParams,
  type Cursor,
  type ListParams,
} from "@/lib/api/pagination";

type Row = { id: string; created: number };

const keyOf = (row: Row) => ({ sort: row.created, id: row.id });

const rows: Row[] = [
  { id: "a", created: 3 },
  { id: "b", created: 1 },
  { id: "c", created: 2 },
];

function params(overrides: Partial<ListParams> = {}): ListParams {
  return { limit: 25, cursor: null, order: "desc", ...overrides };
}

function apiErrorFrom(fn: () => unknown): ApiError {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof ApiError, `expected ApiError, got ${String(err)}`);
    return err;
  }
  assert.fail("expected a throw");
}

describe("cursor encode / decode", () => {
  test("round-trips a numeric sort value", () => {
    const cursor: Cursor = { sort: 1700000000, id: "conv_123", order: "desc" };
    assert.deepEqual(decodeCursor(encodeCursor(cursor), "desc"), cursor);
  });

  test("round-trips a string sort value", () => {
    const cursor: Cursor = { sort: "2026-08-08T00:00:00Z", id: "conv_123", order: "asc" };
    assert.deepEqual(decodeCursor(encodeCursor(cursor), "asc"), cursor);
  });

  test("encodes to a URL-safe string", () => {
    const encoded = encodeCursor({ sort: "a/b+c?d", id: "x", order: "desc" });
    assert.equal(encoded, encodeURIComponent(encoded));
  });

  test("is opaque but not secret — the sort value survives the trip", () => {
    const decoded = decodeCursor(encodeCursor({ sort: 42, id: "x", order: "desc" }), "desc");
    assert.equal(decoded.sort, 42);
    assert.equal(decoded.id, "x");
  });
});

describe("decodeCursor — rejections", () => {
  test("a cursor minted as desc cannot be replayed as asc", () => {
    const encoded = encodeCursor({ sort: 5, id: "x", order: "desc" });
    const err = apiErrorFrom(() => decodeCursor(encoded, "asc"));
    assert.equal(err.code, "invalid_cursor");
    assert.equal(err.status, 400);
    assert.match(err.message, /order='desc'/);
    assert.match(err.message, /order='asc'/);
  });

  test("and the reverse", () => {
    const encoded = encodeCursor({ sort: 5, id: "x", order: "asc" });
    assert.equal(apiErrorFrom(() => decodeCursor(encoded, "desc")).code, "invalid_cursor");
  });

  test("garbage is rejected, not misread", () => {
    assert.equal(apiErrorFrom(() => decodeCursor("not-a-cursor", "desc")).code, "invalid_cursor");
    assert.equal(apiErrorFrom(() => decodeCursor("", "desc")).code, "invalid_cursor");
  });

  test("well-formed base64 of the wrong shape is rejected", () => {
    const missingId = Buffer.from(JSON.stringify({ s: 1, o: "desc" })).toString("base64url");
    assert.equal(apiErrorFrom(() => decodeCursor(missingId, "desc")).code, "invalid_cursor");

    const missingSort = Buffer.from(JSON.stringify({ i: "x", o: "desc" })).toString("base64url");
    assert.equal(apiErrorFrom(() => decodeCursor(missingSort, "desc")).code, "invalid_cursor");

    const wrongTypes = Buffer.from(JSON.stringify({ s: {}, i: 5, o: "desc" })).toString("base64url");
    assert.equal(apiErrorFrom(() => decodeCursor(wrongTypes, "desc")).code, "invalid_cursor");
  });

  test("a cursor with no order at all is rejected", () => {
    const noOrder = Buffer.from(JSON.stringify({ s: 1, i: "x" })).toString("base64url");
    assert.equal(apiErrorFrom(() => decodeCursor(noOrder, "desc")).code, "invalid_cursor");
  });
});

describe("readListParams", () => {
  const at = (query: string) => new URL(`https://api.example.com/v1/things${query}`);

  test("defaults to desc and the default limit", () => {
    assert.deepEqual(readListParams(at("")), {
      limit: DEFAULT_LIMIT,
      order: "desc",
      cursor: null,
    });
  });

  test("a caller-supplied default order applies only when unspecified", () => {
    assert.equal(readListParams(at(""), { order: "asc" }).order, "asc");
    assert.equal(readListParams(at("?order=desc"), { order: "asc" }).order, "desc");
  });

  test("accepts a limit inside the range", () => {
    assert.equal(readListParams(at("?limit=1")).limit, 1);
    assert.equal(readListParams(at(`?limit=${MAX_LIMIT}`)).limit, MAX_LIMIT);
  });

  test("rejects a limit outside the range or of the wrong kind", () => {
    for (const bad of ["0", "-1", String(MAX_LIMIT + 1), "abc", "1.5", ""]) {
      const err = apiErrorFrom(() => readListParams(at(`?limit=${bad}`)));
      assert.equal(err.code, "invalid_request", `limit=${bad} should be rejected`);
    }
  });

  test("rejects an unknown order", () => {
    assert.equal(apiErrorFrom(() => readListParams(at("?order=sideways"))).code, "invalid_request");
  });

  test("decodes a cursor against the effective order", () => {
    const encoded = encodeCursor({ sort: 9, id: "x", order: "asc" });
    const parsed = readListParams(at(`?order=asc&cursor=${encoded}`));
    assert.deepEqual(parsed.cursor, { sort: 9, id: "x", order: "asc" });
  });

  test("a cursor whose order contradicts the request is rejected here too", () => {
    const encoded = encodeCursor({ sort: 9, id: "x", order: "asc" });
    const err = apiErrorFrom(() => readListParams(at(`?order=desc&cursor=${encoded}`)));
    assert.equal(err.code, "invalid_cursor");
  });
});

describe("buildPage", () => {
  test("exactly `limit` rows means this is the last page", () => {
    const page = buildPage(rows.slice(0, 2), params({ limit: 2 }), keyOf);
    assert.equal(page.has_more, false);
    assert.equal(page.next_cursor, null);
    assert.equal(page.data.length, 2);
  });

  test("the extra row signals another page and is not returned", () => {
    const page = buildPage(rows, params({ limit: 2 }), keyOf);
    assert.equal(page.has_more, true);
    assert.deepEqual(
      page.data.map((r) => r.id),
      ["a", "b"]
    );
    assert.ok(page.next_cursor);
  });

  test("the cursor points at the last returned row, not the peeked one", () => {
    const page = buildPage(rows, params({ limit: 2 }), keyOf);
    const decoded = decodeCursor(page.next_cursor!, "desc");
    assert.equal(decoded.id, "b");
    assert.equal(decoded.sort, 1);
  });

  test("an empty result is a valid terminal page", () => {
    const page = buildPage([], params({ limit: 10 }), keyOf);
    assert.deepEqual(page.data, []);
    assert.equal(page.has_more, false);
    assert.equal(page.next_cursor, null);
  });

  test("the cursor carries the order it was minted with", () => {
    const page = buildPage(rows, params({ limit: 2, order: "asc" }), keyOf);
    assert.equal(decodeCursor(page.next_cursor!, "asc").order, "asc");
  });
});

describe("paginateInMemory — ordering", () => {
  test("sorts descending by default", () => {
    const page = paginateInMemory(rows, params({ limit: 10 }), keyOf);
    assert.deepEqual(
      page.data.map((r) => r.id),
      ["a", "c", "b"]
    );
  });

  test("sorts ascending when asked", () => {
    const page = paginateInMemory(rows, params({ limit: 10, order: "asc" }), keyOf);
    assert.deepEqual(
      page.data.map((r) => r.id),
      ["b", "c", "a"]
    );
  });

  test("breaks ties on id so a cursor can resume exactly", () => {
    const tied: Row[] = [
      { id: "a", created: 5 },
      { id: "b", created: 5 },
    ];
    assert.deepEqual(
      paginateInMemory(tied, params({ limit: 10, order: "asc" }), keyOf).data.map((r) => r.id),
      ["a", "b"]
    );
    assert.deepEqual(
      paginateInMemory(tied, params({ limit: 10, order: "desc" }), keyOf).data.map((r) => r.id),
      ["b", "a"]
    );
  });

  test("does not mutate the caller's array", () => {
    const original = [...rows];
    paginateInMemory(rows, params({ limit: 10 }), keyOf);
    assert.deepEqual(rows, original);
  });
});

describe("paginateInMemory — paging through", () => {
  test("walks the whole list exactly once with no repeats or gaps", () => {
    const seen: string[] = [];
    let cursor: Cursor | null = null;

    for (let guard = 0; guard < 10; guard++) {
      const page = paginateInMemory(rows, params({ limit: 2, cursor }), keyOf);
      seen.push(...page.data.map((r) => r.id));
      if (!page.has_more) break;
      cursor = decodeCursor(page.next_cursor!, "desc");
    }

    assert.deepEqual(seen, ["a", "c", "b"]);
  });

  test("the second page starts after the cursor's row", () => {
    const first = paginateInMemory(rows, params({ limit: 2 }), keyOf);
    const cursor = decodeCursor(first.next_cursor!, "desc");
    const second = paginateInMemory(rows, params({ limit: 2, cursor }), keyOf);

    assert.deepEqual(
      second.data.map((r) => r.id),
      ["b"]
    );
    assert.equal(second.has_more, false);
  });
});

describe("paginateInMemory — the anchor row was deleted", () => {
  test("does not replay the list from the top", () => {
    const cursor: Cursor = { sort: 2, id: "gone", order: "desc" };
    const page = paginateInMemory(rows, params({ limit: 10, cursor }), keyOf);

    // The dangerous outcome is `rows` all over again. Treat the cursor as spent.
    assert.deepEqual(page.data, []);
    assert.equal(page.has_more, false);
    assert.equal(page.next_cursor, null);
  });

  test("holds even when the deleted anchor sorted first", () => {
    const remaining = rows.filter((r) => r.id !== "a");
    const cursor: Cursor = { sort: 3, id: "a", order: "desc" };
    const page = paginateInMemory(remaining, params({ limit: 10, cursor }), keyOf);
    assert.deepEqual(page.data, []);
  });

  test("an empty collection with a cursor is still empty", () => {
    const cursor: Cursor = { sort: 1, id: "x", order: "desc" };
    const page = paginateInMemory([], params({ limit: 10, cursor }), keyOf);
    assert.deepEqual(page.data, []);
    assert.equal(page.next_cursor, null);
  });

  test("no cursor still starts from the top", () => {
    const page = paginateInMemory(rows, params({ limit: 10 }), keyOf);
    assert.equal(page.data.length, 3);
  });
});
