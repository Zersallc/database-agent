/**
 * Cursor pagination.
 *
 * Cursors are opaque to clients but not encrypted — they carry a sort value, a
 * tiebreaker ID, and the order they were minted with. The order is baked in on
 * purpose: reusing a `desc` cursor with `order=asc` would silently skip or
 * repeat rows, so we reject it instead of quietly returning wrong data.
 *
 * Offset pagination was the alternative and it is worse here: rows are inserted
 * constantly, and `?page=2` would drop or duplicate records every time
 * something lands at the head of the list while a client is paging.
 */

import { ApiError } from "./errors";

export type SortOrder = "asc" | "desc";

export type Cursor = {
  /** The sort value of the last item on the previous page. */
  sort: number | string;
  /** Tiebreaker for items sharing a sort value. */
  id: string;
  order: SortOrder;
};

export type ListParams = {
  limit: number;
  cursor: Cursor | null;
  order: SortOrder;
};

export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;

function encode(value: object): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function encodeCursor(cursor: Cursor): string {
  return encode({ s: cursor.sort, i: cursor.id, o: cursor.order });
}

export function decodeCursor(raw: string, order: SortOrder): Cursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new ApiError("invalid_cursor", "The cursor is malformed. Omit it to start from the first page.");
  }
  const value = parsed as { s?: number | string; i?: string; o?: string };
  if ((typeof value.s !== "number" && typeof value.s !== "string") || typeof value.i !== "string") {
    throw new ApiError("invalid_cursor", "The cursor is malformed. Omit it to start from the first page.");
  }
  if (value.o !== order) {
    throw new ApiError(
      "invalid_cursor",
      `This cursor was created with order='${value.o}' but the request asked for order='${order}'. Keep the order stable while paging, or start again without a cursor.`
    );
  }
  return { sort: value.s, id: value.i, order };
}

export function readListParams(url: URL, defaults: { order?: SortOrder } = {}): ListParams {
  const rawLimit = url.searchParams.get("limit");
  let limit = DEFAULT_LIMIT;
  if (rawLimit !== null) {
    const parsed = Number(rawLimit);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
      throw new ApiError("invalid_request", `'limit' must be an integer between 1 and ${MAX_LIMIT}.`, {
        details: { fields: [{ path: "limit", issue: `must be between 1 and ${MAX_LIMIT}` }] },
      });
    }
    limit = parsed;
  }

  const rawOrder = url.searchParams.get("order") ?? defaults.order ?? "desc";
  if (rawOrder !== "asc" && rawOrder !== "desc") {
    throw new ApiError("invalid_request", "'order' must be 'asc' or 'desc'.", {
      details: { fields: [{ path: "order", issue: "must be one of: asc, desc" }] },
    });
  }

  const rawCursor = url.searchParams.get("cursor");
  return {
    limit,
    order: rawOrder,
    cursor: rawCursor ? decodeCursor(rawCursor, rawOrder) : null,
  };
}

export type Page<T> = {
  data: T[];
  has_more: boolean;
  next_cursor: string | null;
};

/**
 * Sorts, slices, and wraps an in-memory collection. Stores that can paginate at
 * the source (Firestore, SQL) should do that instead and call `buildPage` with
 * the rows they fetched — this helper is for drivers that hand back everything.
 */
export function paginateInMemory<T>(
  items: readonly T[],
  params: ListParams,
  keyOf: (item: T) => { sort: number | string; id: string }
): Page<T> {
  const direction = params.order === "asc" ? 1 : -1;
  const sorted = [...items].sort((a, b) => {
    const left = keyOf(a);
    const right = keyOf(b);
    if (left.sort < right.sort) return -1 * direction;
    if (left.sort > right.sort) return 1 * direction;
    // Stable tiebreak so a cursor can always resume from an exact position.
    return left.id < right.id ? -1 * direction : left.id > right.id ? direction : 0;
  });

  const start = params.cursor
    ? sorted.findIndex((item) => keyOf(item).id === params.cursor!.id) + 1
    : 0;
  // findIndex returning -1 means the cursor's item was deleted between pages.
  // Starting from 0 would silently replay the whole list, so treat it as spent.
  const from = params.cursor && start === 0 ? sorted.length : start;

  return buildPage(sorted.slice(from, from + params.limit + 1), params, keyOf);
}

/**
 * Turns `limit + 1` fetched rows into a page. Fetching one extra row is how we
 * know whether another page exists without running a second count query.
 */
export function buildPage<T>(
  fetched: readonly T[],
  params: ListParams,
  keyOf: (item: T) => { sort: number | string; id: string }
): Page<T> {
  const hasMore = fetched.length > params.limit;
  const data = hasMore ? fetched.slice(0, params.limit) : [...fetched];
  const last = data[data.length - 1];
  return {
    data,
    has_more: hasMore,
    next_cursor: hasMore && last ? encodeCursor({ ...keyOf(last), order: params.order }) : null,
  };
}
