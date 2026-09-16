/**
 * Workspace API keys.
 *
 * The raw key exists twice: once in the creation response, and once more each
 * time a caller sends it as a bearer token. It is never stored and never
 * returned again — only its SHA-256 hash (the lookup key `lib/api/auth.ts`
 * hashes every incoming token against, so a leaked database dump does not
 * yield working credentials) and a four-character hint survive.
 *
 * Records live under `SYSTEM_PARTITION`, one workspace's keys mixed in with
 * every other workspace's `api_keys` document — the only fast lookup this
 * needs is "does this hash belong to anyone", which cannot be scoped to a
 * tenant before the tenant is known. `tenant_id` on each record is what
 * scopes list/revoke back down to one workspace afterward, the same
 * cross-tenant-lookup shape `lib/api/auth.ts` already documents.
 */

import { randomBytes } from "crypto";
import { ApiError, notFound } from "@/lib/api/errors";
import {
  hashApiKey,
  ROLE_SCOPES,
  SCOPES,
  SYSTEM_PARTITION,
  type ApiKeyRecord,
  type Role,
  type Scope,
} from "@/lib/api/auth";
import { newId } from "@/lib/api/ids";
import { buildPage, type ListParams, type Page } from "@/lib/api/pagination";
import { hintFor } from "@/lib/crypto";
import { stores } from "@/lib/providers";

const KEY_PREFIX = "sk_live_";

export function generateRawKey(): string {
  // 32 bytes of entropy, base64url so the key is header- and URL-safe with no
  // padding to strip. Prefixed for the same reason `newId` prefixes an ID: a
  // key is recognizable in a log line or a leaked snippet without a lookup.
  return KEY_PREFIX + randomBytes(32).toString("base64url");
}

export type CreateApiKeyInput = {
  name?: string;
  role: Role;
  /** Defaults to every scope the role carries. Must not exceed it. */
  scopes?: Scope[];
};

export function resolveScopes(role: Role, requested: Scope[] | undefined): Scope[] {
  const allowed = new Set(ROLE_SCOPES[role]);
  if (!requested) return ROLE_SCOPES[role];

  const excess = requested.filter((scope) => !allowed.has(scope));
  if (excess.length > 0) {
    throw new ApiError(
      "invalid_request",
      `Scope(s) ${excess.join(", ")} exceed what the '${role}' role is allowed. ` +
        `Omit 'scopes' to grant everything the role normally has, or choose a subset of it.`,
      { details: { fields: [{ path: "scopes", issue: `must be a subset of: ${ROLE_SCOPES[role].join(", ")}` }] } }
    );
  }
  // De-duplicated and ordered the same way every time, so two keys created
  // with the same input compare equal rather than differing by list order.
  return SCOPES.filter((scope) => requested.includes(scope));
}

export function serializeApiKey(doc: ApiKeyRecord) {
  return {
    id: doc.key_id,
    object: "api_key" as const,
    name: doc.name ?? null,
    role: doc.role,
    scopes: doc.scopes ?? ROLE_SCOPES[doc.role],
    key_hint: doc.key_hint,
    revoked: doc.revoked ?? false,
    created_at: doc.created_at,
    last_used_at: doc.last_used_at ?? null,
  };
}

/**
 * Creates a key and returns the raw value alongside the stored record. The
 * raw value is the caller's only chance to see it — the route handler must
 * put it in this one response and nowhere it would be logged.
 */
export async function createApiKey(
  tenantId: string,
  userId: string,
  input: CreateApiKeyInput
): Promise<{ doc: ApiKeyRecord; rawKey: string }> {
  const rawKey = generateRawKey();
  const doc: ApiKeyRecord = {
    id: await hashApiKey(rawKey),
    key_id: newId("apiKey"),
    key_hint: hintFor(rawKey),
    tenant_id: tenantId,
    user_id: userId,
    role: input.role,
    scopes: resolveScopes(input.role, input.scopes),
    name: input.name,
    created_at: new Date().toISOString(),
  };
  await stores().documents.put("api_keys", SYSTEM_PARTITION, doc);
  return { doc, rawKey };
}

export async function listApiKeys(tenantId: string, params: ListParams): Promise<Page<ApiKeyRecord>> {
  const docs = await stores().documents.list<ApiKeyRecord & { id: string }>("api_keys", SYSTEM_PARTITION, {
    where: [{ field: "tenant_id", equals: tenantId }],
    orderBy: "created_at",
    order: params.order,
    startAfter: params.cursor ? { sort: params.cursor.sort, id: params.cursor.id } : undefined,
    limit: params.limit + 1,
  });
  // Cursor keyed on the STORAGE id (the hash), not `key_id` — `startAfter`
  // resumes from whatever the store used to place the row, and for this
  // collection that is `id`. The hash never appears in the serialized body.
  return buildPage(docs, params, (doc) => ({ sort: doc.created_at, id: doc.id }));
}

async function findByKeyId(tenantId: string, keyId: string): Promise<(ApiKeyRecord & { id: string }) | null> {
  const rows = await stores().documents.list<ApiKeyRecord & { id: string }>("api_keys", SYSTEM_PARTITION, {
    where: [
      { field: "tenant_id", equals: tenantId },
      { field: "key_id", equals: keyId },
    ],
    orderBy: "created_at",
    order: "asc",
    limit: 1,
  });
  return rows[0] ?? null;
}

export async function requireApiKey(tenantId: string, keyId: string): Promise<ApiKeyRecord> {
  const doc = await findByKeyId(tenantId, keyId);
  if (!doc) throw notFound("api_key", keyId);
  return doc;
}

/**
 * Revokes rather than deletes: `lib/api/auth.ts` already checks `revoked` on
 * every lookup, so this takes effect on the very next request with no cache
 * to invalidate, and the record survives as an audit trail of a credential
 * that once existed — the same reasoning a soft-deleted user or a disabled
 * connection would get, applied to the resource with the highest blast
 * radius if it leaked.
 */
export async function revokeApiKey(tenantId: string, keyId: string): Promise<void> {
  const doc = await requireApiKey(tenantId, keyId);
  await stores().documents.patch<ApiKeyRecord>("api_keys", SYSTEM_PARTITION, doc.id, { revoked: true });
}
