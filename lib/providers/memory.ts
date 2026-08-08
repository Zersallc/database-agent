/**
 * In-process drivers. These are what make `npm run dev` work with no cloud
 * account, no credentials, and no .env file.
 *
 * They are explicitly not production drivers: state dies with the process and
 * is not shared between instances, so on anything horizontally scaled the rate
 * limiter under-counts and idempotency keys miss. `describeProviders()` warns
 * about this at boot. Configure real drivers before deploying.
 *
 * State hangs off globalThis so Next's dev-server hot reload doesn't wipe the
 * workspace every time a file is saved.
 */

import type {
  BlobMetadata,
  BlobStore,
  Collection,
  Doc,
  DocumentStore,
  KeyValueStore,
  ListQuery,
  SecretStore,
  Where,
} from "./types";

type MemoryState = {
  docs: Map<string, Map<string, Doc>>;
  kv: Map<string, { value: unknown; expiresAt: number }>;
  blobs: Map<string, { body: Uint8Array; metadata: BlobMetadata }>;
  secrets: Map<string, string>;
};

const globalForMemory = globalThis as typeof globalThis & {
  __databaseAgentMemory?: MemoryState;
};

function state(): MemoryState {
  globalForMemory.__databaseAgentMemory ??= {
    docs: new Map(),
    kv: new Map(),
    blobs: new Map(),
    secrets: new Map(),
  };
  return globalForMemory.__databaseAgentMemory;
}

function bucket(collection: Collection, tenantId: string): Map<string, Doc> {
  const key = `${tenantId}/${collection}`;
  const docs = state().docs;
  let existing = docs.get(key);
  if (!existing) {
    existing = new Map();
    docs.set(key, existing);
  }
  return existing;
}

function matches(doc: Doc, where: Where[] = []): boolean {
  return where.every((clause) => doc[clause.field] === clause.equals);
}

function compare(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

export class MemoryDocumentStore implements DocumentStore {
  readonly driver = "memory";

  async get<T extends Doc>(collection: Collection, tenantId: string, id: string): Promise<T | null> {
    return (bucket(collection, tenantId).get(id) as T | undefined) ?? null;
  }

  async list<T extends Doc>(
    collection: Collection,
    tenantId: string,
    query: ListQuery
  ): Promise<T[]> {
    const direction = query.order === "asc" ? 1 : -1;
    const rows = [...bucket(collection, tenantId).values()]
      .filter((doc) => matches(doc, query.where))
      .sort((a, b) => {
        const primary = compare(a[query.orderBy], b[query.orderBy]);
        if (primary !== 0) return primary * direction;
        return compare(a.id, b.id) * direction;
      });

    let start = 0;
    if (query.startAfter) {
      const index = rows.findIndex((doc) => doc.id === query.startAfter!.id);
      // A missing anchor means the row was deleted mid-page. Returning nothing
      // is better than silently restarting the list from the top.
      start = index === -1 ? rows.length : index + 1;
    }

    const end = query.limit === undefined ? undefined : start + query.limit;
    return rows.slice(start, end) as T[];
  }

  async count(collection: Collection, tenantId: string, where?: Where[]): Promise<number> {
    return [...bucket(collection, tenantId).values()].filter((doc) => matches(doc, where)).length;
  }

  async put<T extends Doc>(collection: Collection, tenantId: string, doc: T): Promise<T> {
    bucket(collection, tenantId).set(doc.id, structuredClone(doc));
    return doc;
  }

  async patch<T extends Doc>(
    collection: Collection,
    tenantId: string,
    id: string,
    changes: Partial<T>
  ): Promise<T | null> {
    const store = bucket(collection, tenantId);
    const existing = store.get(id);
    if (!existing) return null;
    const next = { ...existing, ...changes, id } as T;
    store.set(id, structuredClone(next));
    return next;
  }

  async delete(collection: Collection, tenantId: string, id: string): Promise<boolean> {
    return bucket(collection, tenantId).delete(id);
  }

  async deleteWhere(collection: Collection, tenantId: string, where: Where[]): Promise<number> {
    const store = bucket(collection, tenantId);
    let removed = 0;
    for (const [id, doc] of store) {
      if (matches(doc, where)) {
        store.delete(id);
        removed++;
      }
    }
    return removed;
  }

  async healthy(): Promise<boolean> {
    return true;
  }
}

export class MemoryKeyValueStore implements KeyValueStore {
  readonly driver = "memory";

  /** Lazy expiry — entries are dropped on read rather than by a sweeper. */
  private live(key: string) {
    const entry = state().kv.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      state().kv.delete(key);
      return null;
    }
    return entry;
  }

  async get<T>(key: string): Promise<T | null> {
    return (this.live(key)?.value as T | undefined) ?? null;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    state().kv.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async setIfAbsent<T>(key: string, value: T, ttlSeconds: number): Promise<boolean> {
    if (this.live(key)) return false;
    await this.set(key, value, ttlSeconds);
    return true;
  }

  async increment(key: string, ttlSeconds: number): Promise<{ value: number; expiresAt: number }> {
    const existing = this.live(key);
    if (existing) {
      const value = (existing.value as number) + 1;
      state().kv.set(key, { value, expiresAt: existing.expiresAt });
      return { value, expiresAt: existing.expiresAt };
    }
    const expiresAt = Date.now() + ttlSeconds * 1000;
    state().kv.set(key, { value: 1, expiresAt });
    return { value: 1, expiresAt };
  }

  async delete(key: string): Promise<void> {
    state().kv.delete(key);
  }

  async healthy(): Promise<boolean> {
    return true;
  }
}

export class MemoryBlobStore implements BlobStore {
  readonly driver = "memory";

  async put(key: string, body: Uint8Array, contentType: string): Promise<BlobMetadata> {
    const metadata: BlobMetadata = { key, size: body.byteLength, contentType };
    state().blobs.set(key, { body, metadata });
    return metadata;
  }

  async get(key: string) {
    return state().blobs.get(key) ?? null;
  }

  async delete(key: string): Promise<void> {
    state().blobs.delete(key);
  }

  /** No signing without a real object store — the caller streams through the API instead. */
  async signedUrl(): Promise<string | null> {
    return null;
  }

  async healthy(): Promise<boolean> {
    return true;
  }
}

/**
 * Reads secrets from the environment, falling back to process memory for values
 * written at runtime. Handles map to env vars by upper-snake-casing them, so a
 * connection credential handle `conn_01H…` reads `SECRET_CONN_01H…`.
 *
 * Fine for local development and for deployments that inject secrets as env
 * vars. Use the Secret Manager driver when secrets need rotation or an audit
 * trail.
 */
export class EnvSecretStore implements SecretStore {
  readonly driver = "env";

  private envKey(handle: string): string {
    return `SECRET_${handle.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
  }

  async write(handle: string, value: string): Promise<void> {
    state().secrets.set(handle, value);
  }

  async read(handle: string): Promise<string | null> {
    return process.env[this.envKey(handle)] ?? state().secrets.get(handle) ?? null;
  }

  async delete(handle: string): Promise<void> {
    state().secrets.delete(handle);
  }

  async healthy(): Promise<boolean> {
    return true;
  }
}
