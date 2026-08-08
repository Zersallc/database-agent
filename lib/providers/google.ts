/**
 * Google Cloud drivers — the primary production target.
 *
 * Firestore for metadata and coordination, Cloud Storage for attachments,
 * Secret Manager for credentials. Every client is created lazily on first use
 * and reused, because these SDKs hold connection pools you do not want to
 * rebuild per request.
 *
 * Authentication is Application Default Credentials throughout: on Cloud Run
 * that is the service account attached to the revision, and locally it is
 * `gcloud auth application-default login`. No key files, no secrets in env.
 *
 * Firestore layout: tenants/{tenant_id}/{collection}/{doc_id}. Tenant isolation
 * is structural — a query rooted at the wrong tenant document cannot reach
 * another tenant's data even if application code gets the filter wrong.
 */

import { optionalModule } from "./optional-module";
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

/* eslint-disable @typescript-eslint/no-explicit-any -- optional SDKs are untyped here by design */

export type FirestoreConfig = {
  projectId?: string;
  /** Firestore named database. Omit for the project's default database. */
  databaseId?: string;
  /** Prefix for every collection path, so several environments can share a project. */
  rootCollection?: string;
};

async function firestoreClient(config: FirestoreConfig): Promise<any> {
  const mod = await optionalModule("@google-cloud/firestore", "the Firestore driver");
  const Firestore = mod.Firestore as new (options: object) => any;
  return new Firestore({
    ...(config.projectId ? { projectId: config.projectId } : {}),
    ...(config.databaseId ? { databaseId: config.databaseId } : {}),
    ignoreUndefinedProperties: true,
  });
}

export class FirestoreDocumentStore implements DocumentStore {
  readonly driver = "firestore";
  private client: Promise<any> | null = null;
  private readonly root: string;

  constructor(private readonly config: FirestoreConfig = {}) {
    this.root = config.rootCollection ?? "tenants";
  }

  private db(): Promise<any> {
    this.client ??= firestoreClient(this.config);
    return this.client;
  }

  private async collectionRef(collection: Collection, tenantId: string): Promise<any> {
    const db = await this.db();
    return db.collection(this.root).doc(tenantId).collection(collection);
  }

  async get<T extends Doc>(collection: Collection, tenantId: string, id: string): Promise<T | null> {
    const ref = await this.collectionRef(collection, tenantId);
    const snapshot = await ref.doc(id).get();
    return snapshot.exists ? (snapshot.data() as T) : null;
  }

  async list<T extends Doc>(
    collection: Collection,
    tenantId: string,
    query: ListQuery
  ): Promise<T[]> {
    let ref = await this.collectionRef(collection, tenantId);
    for (const clause of query.where ?? []) {
      ref = ref.where(clause.field, "==", clause.equals);
    }
    // Ordering by `id` as a secondary key gives cursors a stable anchor when
    // several documents share the same sort value.
    ref = ref.orderBy(query.orderBy, query.order).orderBy("id", query.order);
    if (query.startAfter) {
      ref = ref.startAfter(query.startAfter.sort, query.startAfter.id);
    }
    if (query.limit !== undefined) {
      ref = ref.limit(query.limit);
    }
    const snapshot = await ref.get();
    return snapshot.docs.map((doc: any) => doc.data() as T);
  }

  async count(collection: Collection, tenantId: string, where?: Where[]): Promise<number> {
    let ref = await this.collectionRef(collection, tenantId);
    for (const clause of where ?? []) {
      ref = ref.where(clause.field, "==", clause.equals);
    }
    const snapshot = await ref.count().get();
    return snapshot.data().count as number;
  }

  async put<T extends Doc>(collection: Collection, tenantId: string, doc: T): Promise<T> {
    const ref = await this.collectionRef(collection, tenantId);
    await ref.doc(doc.id).set(doc);
    return doc;
  }

  async patch<T extends Doc>(
    collection: Collection,
    tenantId: string,
    id: string,
    changes: Partial<T>
  ): Promise<T | null> {
    const ref = await this.collectionRef(collection, tenantId);
    const docRef = ref.doc(id);
    const snapshot = await docRef.get();
    if (!snapshot.exists) return null;
    await docRef.set({ ...changes, id }, { merge: true });
    const updated = await docRef.get();
    return updated.data() as T;
  }

  async delete(collection: Collection, tenantId: string, id: string): Promise<boolean> {
    const ref = await this.collectionRef(collection, tenantId);
    const docRef = ref.doc(id);
    const snapshot = await docRef.get();
    if (!snapshot.exists) return false;
    await docRef.delete();
    return true;
  }

  async deleteWhere(collection: Collection, tenantId: string, where: Where[]): Promise<number> {
    let ref = await this.collectionRef(collection, tenantId);
    for (const clause of where) {
      ref = ref.where(clause.field, "==", clause.equals);
    }
    const db = await this.db();
    let removed = 0;
    // Firestore caps a batch at 500 writes, so drain in chunks.
    for (;;) {
      const snapshot = await ref.limit(400).get();
      if (snapshot.empty) break;
      const batch = db.batch();
      snapshot.docs.forEach((doc: any) => batch.delete(doc.ref));
      await batch.commit();
      removed += snapshot.size;
      if (snapshot.size < 400) break;
    }
    return removed;
  }

  async healthy(): Promise<boolean> {
    try {
      const db = await this.db();
      await db.collection(this.root).limit(1).get();
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Rate-limit counters and idempotency records in Firestore.
 *
 * Firestore is not the fastest home for hot counters — Memorystore/Redis is
 * better once traffic justifies it — but it needs no extra infrastructure and
 * its transactions give the atomic increment the rate limiter requires. Swap in
 * a Redis driver by implementing `KeyValueStore`; nothing above changes.
 */
export class FirestoreKeyValueStore implements KeyValueStore {
  readonly driver = "firestore-kv";
  private client: Promise<any> | null = null;

  constructor(
    private readonly config: FirestoreConfig = {},
    private readonly collectionName = "kv"
  ) {}

  private db(): Promise<any> {
    this.client ??= firestoreClient(this.config);
    return this.client;
  }

  private async ref(key: string): Promise<any> {
    const db = await this.db();
    // Firestore document IDs cannot contain '/', and our keys are path-like.
    return db.collection(this.collectionName).doc(encodeURIComponent(key));
  }

  async get<T>(key: string): Promise<T | null> {
    const snapshot = await (await this.ref(key)).get();
    if (!snapshot.exists) return null;
    const data = snapshot.data();
    if (data.expiresAt <= Date.now()) return null;
    return data.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    await (await this.ref(key)).set({ value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async setIfAbsent<T>(key: string, value: T, ttlSeconds: number): Promise<boolean> {
    const db = await this.db();
    const ref = await this.ref(key);
    return db.runTransaction(async (tx: any) => {
      const snapshot = await tx.get(ref);
      if (snapshot.exists && snapshot.data().expiresAt > Date.now()) return false;
      tx.set(ref, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
      return true;
    });
  }

  async increment(key: string, ttlSeconds: number): Promise<{ value: number; expiresAt: number }> {
    const db = await this.db();
    const ref = await this.ref(key);
    return db.runTransaction(async (tx: any) => {
      const snapshot = await tx.get(ref);
      const now = Date.now();
      if (snapshot.exists && snapshot.data().expiresAt > now) {
        const next = { value: (snapshot.data().value as number) + 1, expiresAt: snapshot.data().expiresAt };
        tx.set(ref, next);
        return next;
      }
      const fresh = { value: 1, expiresAt: now + ttlSeconds * 1000 };
      tx.set(ref, fresh);
      return fresh;
    });
  }

  async delete(key: string): Promise<void> {
    await (await this.ref(key)).delete();
  }

  async healthy(): Promise<boolean> {
    try {
      const db = await this.db();
      await db.collection(this.collectionName).limit(1).get();
      return true;
    } catch {
      return false;
    }
  }
}

export type GcsConfig = {
  bucket: string;
  projectId?: string;
  /** Key prefix, so one bucket can serve several environments. */
  prefix?: string;
};

export class GcsBlobStore implements BlobStore {
  readonly driver = "gcs";
  private client: Promise<any> | null = null;

  constructor(private readonly config: GcsConfig) {}

  private async bucket(): Promise<any> {
    this.client ??= (async () => {
      const mod = await optionalModule("@google-cloud/storage", "the Cloud Storage driver");
      const Storage = mod.Storage as new (options: object) => any;
      const storage = new Storage(this.config.projectId ? { projectId: this.config.projectId } : {});
      return storage.bucket(this.config.bucket);
    })();
    return this.client;
  }

  private path(key: string): string {
    return this.config.prefix ? `${this.config.prefix.replace(/\/$/, "")}/${key}` : key;
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<BlobMetadata> {
    const bucket = await this.bucket();
    await bucket.file(this.path(key)).save(Buffer.from(body), {
      contentType,
      resumable: false,
    });
    return { key, size: body.byteLength, contentType };
  }

  async get(key: string) {
    const bucket = await this.bucket();
    const file = bucket.file(this.path(key));
    const [exists] = await file.exists();
    if (!exists) return null;
    const [buffer] = await file.download();
    const [metadata] = await file.getMetadata();
    return {
      body: new Uint8Array(buffer),
      metadata: {
        key,
        size: Number(metadata.size ?? buffer.length),
        contentType: String(metadata.contentType ?? "application/octet-stream"),
      },
    };
  }

  async delete(key: string): Promise<void> {
    const bucket = await this.bucket();
    await bucket.file(this.path(key)).delete({ ignoreNotFound: true });
  }

  async signedUrl(key: string, expiresInSeconds: number): Promise<string | null> {
    try {
      const bucket = await this.bucket();
      const [url] = await bucket.file(this.path(key)).getSignedUrl({
        version: "v4",
        action: "read",
        expires: Date.now() + expiresInSeconds * 1000,
      });
      return url as string;
    } catch {
      // Signing needs a service account with a private key or the IAM
      // signBlob permission. Without it we fall back to streaming bytes
      // through the API, which works but costs egress twice.
      return null;
    }
  }

  async healthy(): Promise<boolean> {
    try {
      const bucket = await this.bucket();
      const [exists] = await bucket.exists();
      return Boolean(exists);
    } catch {
      return false;
    }
  }
}

export type SecretManagerConfig = {
  projectId: string;
  /** Prepended to every secret name, e.g. "dbagent-prod". */
  prefix?: string;
};

export class SecretManagerSecretStore implements SecretStore {
  readonly driver = "gcp-secret-manager";
  private client: Promise<any> | null = null;

  constructor(private readonly config: SecretManagerConfig) {}

  private async api(): Promise<any> {
    this.client ??= (async () => {
      const mod = await optionalModule("@google-cloud/secret-manager", "the Secret Manager driver");
      const Client = mod.SecretManagerServiceClient as new () => any;
      return new Client();
    })();
    return this.client;
  }

  /** Secret Manager names allow [A-Za-z0-9_-] only. */
  private name(handle: string): string {
    const prefixed = this.config.prefix ? `${this.config.prefix}-${handle}` : handle;
    return prefixed.replace(/[^A-Za-z0-9_-]/g, "-");
  }

  async write(handle: string, value: string): Promise<void> {
    const client = await this.api();
    const parent = `projects/${this.config.projectId}`;
    const secretId = this.name(handle);
    try {
      await client.createSecret({
        parent,
        secretId,
        secret: { replication: { automatic: {} } },
      });
    } catch (error) {
      // ALREADY_EXISTS (6) is the normal path on credential rotation: keep the
      // secret and add a new version to it.
      if ((error as { code?: number }).code !== 6) throw error;
    }
    await client.addSecretVersion({
      parent: `${parent}/secrets/${secretId}`,
      payload: { data: Buffer.from(value, "utf8") },
    });
  }

  async read(handle: string): Promise<string | null> {
    try {
      const client = await this.api();
      const [version] = await client.accessSecretVersion({
        name: `projects/${this.config.projectId}/secrets/${this.name(handle)}/versions/latest`,
      });
      return Buffer.from(version.payload.data).toString("utf8");
    } catch (error) {
      if ((error as { code?: number }).code === 5) return null; // NOT_FOUND
      throw error;
    }
  }

  async delete(handle: string): Promise<void> {
    try {
      const client = await this.api();
      await client.deleteSecret({
        name: `projects/${this.config.projectId}/secrets/${this.name(handle)}`,
      });
    } catch (error) {
      if ((error as { code?: number }).code !== 5) throw error;
    }
  }

  async healthy(): Promise<boolean> {
    try {
      const client = await this.api();
      await client.listSecrets({ parent: `projects/${this.config.projectId}`, pageSize: 1 });
      return true;
    } catch {
      return false;
    }
  }
}
