/**
 * Provider interfaces.
 *
 * The backend targets Google Cloud, but this is not a single-customer product —
 * different tenants land in different places, and a customer who runs on AWS or
 * refuses to move their warehouse is a customer either way. So nothing above
 * this layer knows what "storage" actually is. Everything talks to these three
 * interfaces, and the concrete driver is chosen from configuration at boot.
 *
 * The default drivers are in-memory, which is what lets `npm run dev` work with
 * no credentials and no environment file. They are not for production and say
 * so loudly at startup.
 */

import type { SortOrder } from "@/lib/api/pagination";

// ---------------------------------------------------------------------------
// Document store — the metadata plane (connections, conversations, runs, …)
// ---------------------------------------------------------------------------

export const COLLECTIONS = [
  "tenants",
  "users",
  "api_keys",
  "connections",
  "model_providers",
  "conversations",
  "messages",
  "runs",
  "queries",
  "playbooks",
  "skills",
  "files",
  "reports",
  "report_settings",
] as const;

export type Collection = (typeof COLLECTIONS)[number];

export type Doc = { id: string } & Record<string, unknown>;

export type Where = { field: string; equals: unknown };

export type ListQuery = {
  where?: Where[];
  /** Field to sort on. Must be a top-level field with a comparable value. */
  orderBy: string;
  order: SortOrder;
  /** Resume position: the sort value and ID of the last item on the previous page. */
  startAfter?: { sort: number | string; id: string };
  /**
   * Pass `pageSize + 1` so the caller can tell whether another page exists
   * without a second round trip. See `buildPage`.
   */
  limit?: number;
};

export interface DocumentStore {
  readonly driver: string;
  get<T extends Doc>(collection: Collection, tenantId: string, id: string): Promise<T | null>;
  list<T extends Doc>(collection: Collection, tenantId: string, query: ListQuery): Promise<T[]>;
  count(collection: Collection, tenantId: string, where?: Where[]): Promise<number>;
  put<T extends Doc>(collection: Collection, tenantId: string, doc: T): Promise<T>;
  patch<T extends Doc>(
    collection: Collection,
    tenantId: string,
    id: string,
    changes: Partial<T>
  ): Promise<T | null>;
  delete(collection: Collection, tenantId: string, id: string): Promise<boolean>;
  /** Deletes every document matching `where`. Used for cascades. */
  deleteWhere(collection: Collection, tenantId: string, where: Where[]): Promise<number>;
  healthy(): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Key-value store — the coordination plane (rate limits, idempotency)
// ---------------------------------------------------------------------------

/**
 * Small, expiring, contended values.
 *
 * This is separate from the document store because the semantics differ: these
 * writes need atomicity (`increment`, `setIfAbsent`) and TTL, and they are hot
 * enough that you want them in Memorystore or Redis rather than Firestore.
 */
export interface KeyValueStore {
  readonly driver: string;
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  /** Returns false when the key already exists. The basis of idempotency locking. */
  setIfAbsent<T>(key: string, value: T, ttlSeconds: number): Promise<boolean>;
  /** Atomically increments a counter, creating it with the given TTL. */
  increment(key: string, ttlSeconds: number): Promise<{ value: number; expiresAt: number }>;
  delete(key: string): Promise<void>;
  healthy(): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Blob store — attachments and exported result sets
// ---------------------------------------------------------------------------

export type BlobMetadata = {
  key: string;
  size: number;
  contentType: string;
};

export interface BlobStore {
  readonly driver: string;
  put(key: string, body: Uint8Array, contentType: string): Promise<BlobMetadata>;
  get(key: string): Promise<{ body: Uint8Array; metadata: BlobMetadata } | null>;
  delete(key: string): Promise<void>;
  /**
   * A time-limited URL for direct download, so bytes never round-trip through
   * this service. Drivers that cannot sign return null and the caller falls
   * back to streaming through the API.
   */
  signedUrl(key: string, expiresInSeconds: number): Promise<string | null>;
  healthy(): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Secret store — database credentials and model provider keys
// ---------------------------------------------------------------------------

/**
 * Credentials are written here and referenced by handle everywhere else. No
 * credential is ever stored in the document store, returned by an endpoint, or
 * written to a log — the only way out of this interface is `read`, and only the
 * connector calls it.
 */
export interface SecretStore {
  readonly driver: string;
  write(handle: string, value: string): Promise<void>;
  read(handle: string): Promise<string | null>;
  delete(handle: string): Promise<void>;
  healthy(): Promise<boolean>;
}
