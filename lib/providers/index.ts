/**
 * Provider registry: reads configuration once, picks drivers, hands out
 * singletons.
 *
 * Nothing else in the codebase constructs a driver. Call `stores()` and you get
 * whatever this deployment was configured with — memory on a laptop, Firestore
 * and Cloud Storage on Cloud Run, S3 for a tenant who needs their bytes on AWS.
 *
 * Defaults are memory across the board so the app starts with zero
 * configuration. That is a development affordance, not a deployment story, and
 * `providerWarnings()` says so where an operator will see it.
 */

import { S3BlobStore } from "./aws";
import {
  FirestoreDocumentStore,
  FirestoreKeyValueStore,
  GcsBlobStore,
  SecretManagerSecretStore,
} from "./google";
import {
  EnvSecretStore,
  MemoryBlobStore,
  MemoryDocumentStore,
  MemoryKeyValueStore,
} from "./memory";
import { PostgresDocumentStore, PostgresSecretStore } from "./postgres";
import type { BlobStore, DocumentStore, KeyValueStore, SecretStore } from "./types";

export type Stores = {
  documents: DocumentStore;
  kv: KeyValueStore;
  blobs: BlobStore;
  secrets: SecretStore;
};

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

function required(name: string, driver: string): string {
  const value = env(name);
  if (!value) {
    throw new Error(`${name} must be set when using the '${driver}' driver.`);
  }
  return value;
}

function firestoreConfig() {
  return {
    projectId: env("GOOGLE_CLOUD_PROJECT"),
    databaseId: env("FIRESTORE_DATABASE_ID"),
    rootCollection: env("FIRESTORE_ROOT_COLLECTION"),
  };
}

function buildDocumentStore(): DocumentStore {
  switch (env("METADATA_DRIVER") ?? "memory") {
    case "firestore":
      return new FirestoreDocumentStore(firestoreConfig());
    case "postgres":
      return new PostgresDocumentStore();
    case "memory":
      return new MemoryDocumentStore();
    default:
      throw new Error(
        `Unknown METADATA_DRIVER '${env("METADATA_DRIVER")}'. Supported: memory, firestore, postgres.`
      );
  }
}

function buildKeyValueStore(): KeyValueStore {
  switch (env("KV_DRIVER") ?? "memory") {
    case "firestore":
      return new FirestoreKeyValueStore(firestoreConfig(), env("KV_COLLECTION") ?? "kv");
    case "memory":
      return new MemoryKeyValueStore();
    default:
      throw new Error(`Unknown KV_DRIVER '${env("KV_DRIVER")}'. Supported: memory, firestore.`);
  }
}

function buildBlobStore(): BlobStore {
  switch (env("BLOB_DRIVER") ?? "memory") {
    case "gcs":
      return new GcsBlobStore({
        bucket: required("GCS_BUCKET", "gcs"),
        projectId: env("GOOGLE_CLOUD_PROJECT"),
        prefix: env("GCS_PREFIX"),
      });
    case "s3":
      return new S3BlobStore({
        bucket: required("S3_BUCKET", "s3"),
        region: required("AWS_REGION", "s3"),
        endpoint: env("S3_ENDPOINT"),
        prefix: env("S3_PREFIX"),
      });
    case "memory":
      return new MemoryBlobStore();
    default:
      throw new Error(`Unknown BLOB_DRIVER '${env("BLOB_DRIVER")}'. Supported: memory, gcs, s3.`);
  }
}

function buildSecretStore(): SecretStore {
  switch (env("SECRET_DRIVER") ?? "env") {
    case "gcp-secret-manager":
      return new SecretManagerSecretStore({
        projectId: required("GOOGLE_CLOUD_PROJECT", "gcp-secret-manager"),
        prefix: env("SECRET_MANAGER_PREFIX"),
      });
    case "postgres":
      return new PostgresSecretStore();
    case "env":
      return new EnvSecretStore();
    default:
      throw new Error(
        `Unknown SECRET_DRIVER '${env("SECRET_DRIVER")}'. Supported: env, gcp-secret-manager, postgres.`
      );
  }
}

const globalForStores = globalThis as typeof globalThis & {
  __databaseAgentStores?: Stores;
};

/** The configured providers. Cached across hot reloads so pools are not rebuilt. */
export function stores(): Stores {
  globalForStores.__databaseAgentStores ??= {
    documents: buildDocumentStore(),
    kv: buildKeyValueStore(),
    blobs: buildBlobStore(),
    secrets: buildSecretStore(),
  };
  return globalForStores.__databaseAgentStores;
}

/**
 * Configuration problems an operator should know about. Surfaced by
 * `/v1/health` rather than thrown, because a workspace running on memory
 * drivers still works — it just will not survive a restart.
 */
export function providerWarnings(): string[] {
  const { documents, kv, blobs, secrets } = stores();
  const warnings: string[] = [];

  if (documents.driver === "memory") {
    warnings.push(
      "Metadata is in memory: all workspace data is lost on restart and is not shared between instances. Set METADATA_DRIVER=firestore for production."
    );
  }
  if (kv.driver === "memory" && process.env.NODE_ENV === "production") {
    warnings.push(
      "Rate limits and idempotency keys are in memory: with more than one instance, limits under-count and retries can double-execute. Set KV_DRIVER=firestore."
    );
  }
  if (blobs.driver === "memory") {
    warnings.push(
      "Attachments are in memory and are lost on restart. Set BLOB_DRIVER=gcs (or s3) for production."
    );
  }
  if (secrets.driver === "env" && process.env.NODE_ENV === "production") {
    warnings.push(
      "Database credentials are read from environment variables. Set SECRET_DRIVER=gcp-secret-manager for rotation and an audit trail."
    );
  }
  return warnings;
}

export async function providerHealth() {
  const { documents, kv, blobs, secrets } = stores();
  const [documentsOk, kvOk, blobsOk, secretsOk] = await Promise.all([
    documents.healthy(),
    kv.healthy(),
    blobs.healthy(),
    secrets.healthy(),
  ]);
  return [
    { name: "metadata_store", driver: documents.driver, ok: documentsOk },
    { name: "key_value_store", driver: kv.driver, ok: kvOk },
    { name: "blob_store", driver: blobs.driver, ok: blobsOk },
    { name: "secret_store", driver: secrets.driver, ok: secretsOk },
  ];
}

export type { BlobStore, DocumentStore, KeyValueStore, SecretStore } from "./types";
