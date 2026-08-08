"use client";

/**
 * Browser client for `/api/v1/model-providers`.
 *
 * This is the first part of the workspace that talks to the real API rather
 * than `localStorage`, and it has to be: an API key belongs to the workspace and
 * is used by the server, so keeping it in a browser would make it useless to the
 * agent and exposed to any script on the page.
 *
 * The key travels one way. It goes out on create and on rotation, and nothing
 * here ever reads one back — the server has no endpoint that returns one.
 */

export type ModelProviderStatus = "unknown" | "ready" | "error";

export type ModelProvider = {
  id: string;
  object: "model_provider";
  name: string;
  provider: string;
  kind: "anthropic" | "openai_compatible";
  model: string;
  base_url: string | null;
  is_default: boolean;
  status: ModelProviderStatus;
  status_checked_at: string | null;
  status_detail: string | null;
  has_key: boolean;
  key_hint: string | null;
  created_at: string;
  updated_at: string;
};

export type ModelProviderPreset = {
  id: string;
  label: string;
  kind: "anthropic" | "openai_compatible";
  base_url: string | null;
  suggested_model: string;
  docs_url: string;
  requires_base_url: boolean;
  key_optional: boolean;
  note: string | null;
};

export type ModelProviderTestResult = {
  model_provider_id: string;
  status: ModelProviderStatus;
  checked_at: string;
  latency_ms: number | null;
  detail: string | null;
  model_available: boolean | null;
};

/**
 * An API error, surfaced with the server's own message.
 *
 * The message is written for someone debugging — "the provider rejected the API
 * key (401)" — so showing it beats replacing it with a generic failure string.
 */
export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly requestId: string | null
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = init.method ?? "GET";
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      // Required on creates so a double-submit cannot configure the provider
      // twice. Harmless on the other verbs.
      ...(method === "POST" ? { "Idempotency-Key": crypto.randomUUID() } : {}),
      ...init.headers,
    },
  });

  if (response.status === 204) return undefined as T;

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiRequestError(
      body?.message ?? `The request failed with status ${response.status}.`,
      body?.code ?? "unknown_error",
      body?.request_id ?? null
    );
  }

  return body as T;
}

export async function fetchModelProviders(): Promise<{
  providers: ModelProvider[];
  presets: ModelProviderPreset[];
}> {
  const body = await request<{ data: ModelProvider[]; presets: ModelProviderPreset[] }>(
    "/model-providers"
  );
  return { providers: body.data, presets: body.presets };
}

export function createModelProvider(input: {
  provider: string;
  model: string;
  name?: string;
  base_url?: string;
  api_key?: string;
  is_default?: boolean;
}): Promise<ModelProvider> {
  return request<ModelProvider>("/model-providers", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateModelProvider(
  id: string,
  input: { name?: string; model?: string; base_url?: string; api_key?: string; is_default?: boolean }
): Promise<ModelProvider> {
  return request<ModelProvider>(`/model-providers/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteModelProvider(id: string): Promise<void> {
  return request<void>(`/model-providers/${id}`, { method: "DELETE" });
}

export function testModelProvider(id: string): Promise<ModelProviderTestResult> {
  return request<ModelProviderTestResult>(`/model-providers/${id}/test`, { method: "POST" });
}
