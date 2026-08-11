/**
 * Model providers.
 *
 * The same shape as database connections, for the same reason: a credential the
 * workspace owns, stored in the secret store, referenced by handle, and never
 * returned by any endpoint. What comes back is a four-character hint — enough to
 * recognize which key is installed, useless to anyone who steals the response.
 *
 * One provider per workspace is the default; the rest are kept so switching
 * between them for comparison is a click rather than a re-entry of every key.
 */

import { ApiError, notFound } from "@/lib/api/errors";
import { newId } from "@/lib/api/ids";
import { buildPage, type ListParams, type Page } from "@/lib/api/pagination";
import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import {
  createModelClient,
  findPreset,
  kindFor,
  resolveBaseUrl,
  type ModelClient,
  type ModelProviderKind,
} from "@/lib/agent/providers";
import { stores } from "@/lib/providers";

export type ModelProviderStatus = "unknown" | "ready" | "error";

export type ModelProviderDoc = {
  id: string;
  object: "model_provider";
  name: string;
  /** Preset ID: anthropic, qwen, openai, deepseek, custom, … */
  provider: string;
  kind: ModelProviderKind;
  model: string;
  base_url: string | null;
  is_default: boolean;
  status: ModelProviderStatus;
  status_checked_at: string | null;
  status_detail: string | null;
  /** Last four characters of the stored key. Display only. */
  key_hint: string | null;
  /** Points at the secret store. Never leaves this module. */
  credential_handle: string | null;
  created_at: string;
  updated_at: string;
};

/** The wire shape. The key itself is structurally absent, not filtered out. */
export function serializeModelProvider(doc: ModelProviderDoc) {
  return {
    id: doc.id,
    object: doc.object,
    name: doc.name,
    provider: doc.provider,
    kind: doc.kind,
    model: doc.model,
    base_url: doc.base_url,
    is_default: doc.is_default,
    status: doc.status,
    status_checked_at: doc.status_checked_at,
    status_detail: doc.status_detail,
    has_key: Boolean(doc.credential_handle),
    key_hint: doc.key_hint,
    created_at: doc.created_at,
    updated_at: doc.updated_at,
  };
}

function credentialHandle(providerId: string): string {
  return `model-provider-key-${providerId}`;
}

/**
 * Enough of a key to recognize, not enough to use.
 *
 * Four characters of a 100+ character secret is not a meaningful disclosure, and
 * without it the settings page cannot tell "a key is saved" from "the right key
 * is saved" — which is exactly the question someone rotating a key is asking.
 */
function hintFor(key: string): string {
  return key.length <= 4 ? "••••" : `••••${key.slice(-4)}`;
}

export async function listModelProviders(
  tenantId: string,
  params: ListParams
): Promise<Page<ModelProviderDoc>> {
  const docs = await stores().documents.list<ModelProviderDoc>("model_providers", tenantId, {
    orderBy: "created_at",
    order: params.order,
    startAfter: params.cursor ? { sort: params.cursor.sort, id: params.cursor.id } : undefined,
    limit: params.limit + 1,
  });
  return buildPage(docs, params, (doc) => ({ sort: doc.created_at, id: doc.id }));
}

export async function findModelProvider(
  tenantId: string,
  providerId: string
): Promise<ModelProviderDoc | null> {
  return stores().documents.get<ModelProviderDoc>("model_providers", tenantId, providerId);
}

export async function requireModelProvider(
  tenantId: string,
  providerId: string
): Promise<ModelProviderDoc> {
  const doc = await findModelProvider(tenantId, providerId);
  if (!doc) throw notFound("model provider", providerId);
  return doc;
}

export type CreateModelProviderInput = {
  name?: string;
  provider: string;
  model: string;
  base_url?: string;
  api_key?: string;
  is_default?: boolean;
};

function validateAgainstPreset(providerId: string, baseUrl: string | null, apiKey?: string) {
  const preset = findPreset(providerId);
  if (!preset) {
    throw new ApiError("invalid_request", `Unknown provider '${providerId}'.`, {
      details: { fields: [{ path: "provider", issue: "unknown provider" }] },
    });
  }
  if (preset.requiresBaseUrl && !resolveBaseUrl(providerId, baseUrl)) {
    throw new ApiError("validation_failed", "This provider needs a base URL.", {
      details: { fields: [{ path: "base_url", issue: "is required for this provider" }] },
    });
  }
  if (!preset.keyOptional && apiKey !== undefined && !apiKey.trim()) {
    throw new ApiError("validation_failed", "This provider needs an API key.", {
      details: { fields: [{ path: "api_key", issue: "must not be empty" }] },
    });
  }
  return preset;
}

export async function createModelProvider(
  tenantId: string,
  input: CreateModelProviderInput
): Promise<ModelProviderDoc> {
  const baseUrl = input.base_url?.trim() || null;
  const preset = validateAgainstPreset(input.provider, baseUrl, input.api_key);

  if (!preset.keyOptional && !input.api_key?.trim()) {
    throw new ApiError("validation_failed", `${preset.label} needs an API key.`, {
      details: { fields: [{ path: "api_key", issue: "is required for this provider" }] },
    });
  }

  const id = newId("modelProvider");
  const now = new Date().toISOString();
  const key = input.api_key?.trim();

  if (key) {
    await stores().secrets.write(credentialHandle(id), key);
  }

  // The first provider added is the default — otherwise a workspace could
  // finish setup with a key saved and still no provider selected.
  const existing = await stores().documents.count("model_providers", tenantId);
  const isDefault = input.is_default ?? existing === 0;

  const doc: ModelProviderDoc = {
    id,
    object: "model_provider",
    name: input.name?.trim() || `${preset.label} · ${input.model}`,
    provider: input.provider,
    kind: preset.kind,
    model: input.model,
    base_url: baseUrl,
    is_default: isDefault,
    status: "unknown",
    status_checked_at: null,
    status_detail: null,
    key_hint: key ? hintFor(key) : null,
    credential_handle: key ? credentialHandle(id) : null,
    created_at: now,
    updated_at: now,
  };

  await stores().documents.put("model_providers", tenantId, doc);
  if (isDefault) await clearOtherDefaults(tenantId, id);
  return doc;
}

export type UpdateModelProviderInput = {
  name?: string;
  model?: string;
  base_url?: string;
  api_key?: string;
  is_default?: boolean;
};

export async function updateModelProvider(
  tenantId: string,
  providerId: string,
  input: UpdateModelProviderInput
): Promise<ModelProviderDoc> {
  const existing = await requireModelProvider(tenantId, providerId);
  const changes: Partial<ModelProviderDoc> = { updated_at: new Date().toISOString() };

  if (input.name !== undefined) changes.name = input.name;
  if (input.model !== undefined) changes.model = input.model;
  if (input.base_url !== undefined) changes.base_url = input.base_url.trim() || null;

  if (input.api_key !== undefined) {
    const key = input.api_key.trim();
    if (!key) {
      throw new ApiError("validation_failed", "The API key cannot be blank.", {
        details: { fields: [{ path: "api_key", issue: "must not be empty" }] },
      });
    }
    const handle = credentialHandle(providerId);
    await stores().secrets.write(handle, key);
    changes.credential_handle = handle;
    changes.key_hint = hintFor(key);
    // The recorded status describes the previous key, so it is now meaningless.
    changes.status = "unknown";
    changes.status_checked_at = null;
    changes.status_detail = null;
  }

  if (input.is_default) changes.is_default = true;

  const updated = await stores().documents.patch<ModelProviderDoc>(
    "model_providers",
    tenantId,
    providerId,
    changes
  );
  if (input.is_default) await clearOtherDefaults(tenantId, providerId);
  return updated ?? existing;
}

export async function deleteModelProvider(tenantId: string, providerId: string): Promise<void> {
  const existing = await findModelProvider(tenantId, providerId);
  if (!existing) return;

  if (existing.credential_handle) {
    await stores().secrets.delete(existing.credential_handle);
  }
  await stores().documents.delete("model_providers", tenantId, providerId);

  // Deleting the default would otherwise leave the workspace with providers
  // configured and none selected, which reads as "the agent stopped working".
  if (existing.is_default) {
    const [next] = await stores().documents.list<ModelProviderDoc>("model_providers", tenantId, {
      orderBy: "created_at",
      order: "asc",
      limit: 1,
    });
    if (next) {
      await stores().documents.patch<ModelProviderDoc>("model_providers", tenantId, next.id, {
        is_default: true,
      });
    }
  }
}

async function clearOtherDefaults(tenantId: string, keepId: string): Promise<void> {
  const all = await stores().documents.list<ModelProviderDoc>("model_providers", tenantId, {
    orderBy: "created_at",
    order: "asc",
  });
  for (const doc of all) {
    if (doc.id !== keepId && doc.is_default) {
      await stores().documents.patch<ModelProviderDoc>("model_providers", tenantId, doc.id, {
        is_default: false,
      });
    }
  }
}

/** Reads the stored key. The only path out of the secret store for a provider. */
async function readKey(doc: ModelProviderDoc): Promise<string | null> {
  if (!doc.credential_handle) return null;
  return stores().secrets.read(doc.credential_handle);
}

export async function buildClient(doc: ModelProviderDoc): Promise<ModelClient> {
  return createModelClient(doc.provider, {
    apiKey: await readKey(doc),
    baseUrl: doc.base_url,
    model: doc.model,
  });
}

export async function testModelProvider(tenantId: string, doc: ModelProviderDoc) {
  const client = await buildClient(doc);
  const probe = await client.probe();
  const checkedAt = new Date().toISOString();
  const status: ModelProviderStatus = probe.ok ? "ready" : "error";

  await stores().documents.patch<ModelProviderDoc>("model_providers", tenantId, doc.id, {
    status,
    status_checked_at: checkedAt,
    status_detail: probe.detail,
    updated_at: checkedAt,
  });

  return {
    model_provider_id: doc.id,
    status,
    checked_at: checkedAt,
    latency_ms: probe.latency_ms,
    detail: probe.detail,
    model_available: probe.model_available,
  };
}

/**
 * A client built from a user's own AI provider key (User.aiApiKeyEnc in
 * Postgres — see lib/crypto.ts), rather than a workspace-level provider.
 *
 * Assumes Anthropic: the per-user key field doesn't carry a provider
 * selector today, and that's the only provider anyone has asked for it to
 * hold so far. Revisit if a second provider needs a personal key too.
 */
async function personalModelClient(userId: string): Promise<{
  client: ModelClient;
  source: "personal";
  label: string;
} | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { aiApiKeyEnc: true },
  });
  if (!user?.aiApiKeyEnc) return null;

  const apiKey = decryptSecret(user.aiApiKeyEnc);
  const preset = findPreset("anthropic");
  if (!preset) return null;

  return {
    client: createModelClient("anthropic", { apiKey, baseUrl: null, model: preset.suggestedModel }),
    source: "personal",
    label: `Personal Anthropic key (${preset.suggestedModel})`,
  };
}

/**
 * The client the agent should use for this request.
 *
 * Order: the signed-in user's own key (if they have one set), then the
 * workspace's default provider, then any configured provider, then the
 * environment. The environment fallback is what keeps a deployment that only
 * ever set `ANTHROPIC_API_KEY` working untouched — configuring a provider in
 * the UI is an upgrade, not a migration.
 *
 * Null means nothing is configured, and the agent answers with the setup notice.
 */
export async function resolveModelClient(tenantId: string, userId?: string): Promise<{
  client: ModelClient;
  source: "personal" | "workspace" | "environment";
  label: string;
} | null> {
  if (userId) {
    const personal = await personalModelClient(userId);
    if (personal) return personal;
  }

  const configured = await stores().documents.list<ModelProviderDoc>(
    "model_providers",
    tenantId,
    { orderBy: "created_at", order: "asc" }
  );

  const chosen = configured.find((doc) => doc.is_default) ?? configured[0];
  if (chosen) {
    return {
      client: await buildClient(chosen),
      source: "workspace",
      label: `${chosen.name} (${chosen.model})`,
    };
  }

  return environmentClient();
}

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

/**
 * A provider assembled from environment variables.
 *
 * `MODEL_PROVIDER` selects the preset, so a deployment can point at Qwen without
 * touching the database — useful for CI and for containers that are configured
 * entirely through env.
 */
export function environmentClient(): {
  client: ModelClient;
  source: "environment";
  label: string;
} | null {
  const providerId = env("MODEL_PROVIDER") ?? "anthropic";
  const apiKey =
    env("MODEL_API_KEY") ??
    (providerId === "anthropic"
      ? env("ANTHROPIC_API_KEY") ?? env("ANTHROPIC_AUTH_TOKEN")
      : undefined);
  const baseUrl = env("MODEL_BASE_URL") ?? null;
  const model = env("AGENT_MODEL") ?? findPreset(providerId)?.suggestedModel ?? "";

  const preset = findPreset(providerId);
  if (!preset) return null;
  if (!apiKey && !preset.keyOptional) return null;
  if (!model) return null;
  if (preset.requiresBaseUrl && !resolveBaseUrl(providerId, baseUrl)) return null;

  return {
    client: createModelClient(providerId, { apiKey: apiKey ?? null, baseUrl, model }),
    source: "environment",
    label: `${preset.label} (${model}) from environment`,
  };
}

/** Whether the workspace can answer a question at all. Used by `/v1/health`. */
export async function describeModelConfiguration(tenantId: string): Promise<{
  configured: boolean;
  detail: string;
}> {
  const resolved = await resolveModelClient(tenantId);
  if (!resolved) {
    return {
      configured: false,
      detail:
        "No model provider configured — runs return the setup notice. Add one under Settings, or set MODEL_PROVIDER and MODEL_API_KEY.",
    };
  }
  return { configured: true, detail: resolved.label };
}

export { kindFor };
