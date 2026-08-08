/**
 * Known providers.
 *
 * A preset is convenience, not capability: it fills in the base URL and
 * suggests a model so adding a provider is a key and a click rather than a
 * lookup. `custom` covers anything OpenAI-compatible that is not listed, so an
 * unlisted provider is never a blocker.
 *
 * Model names are **suggestions**, not guarantees. Providers rename and retire
 * models on their own schedule, so `model` is required on create and the
 * suggestion only prefills the form. If a suggestion here is stale, the user
 * types the right one and nothing in the codebase has to change.
 */

import type { ModelProviderKind } from "./types";

export type ProviderPreset = {
  id: string;
  label: string;
  kind: ModelProviderKind;
  /** Null means the adapter's built-in default host. */
  baseUrl: string | null;
  suggestedModel: string;
  /** Where to get a key and see the current model list. */
  docsUrl: string;
  /** True when the user must supply the base URL themselves. */
  requiresBaseUrl: boolean;
  /** True for providers that run locally and need no credential. */
  keyOptional: boolean;
  note?: string;
};

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    kind: "anthropic",
    baseUrl: null,
    suggestedModel: "claude-opus-5",
    docsUrl: "https://platform.claude.com/docs/en/about-claude/models/overview",
    requiresBaseUrl: false,
    keyOptional: false,
    note: "Supports adaptive thinking and effort levels; the other providers ignore those.",
  },
  {
    id: "qwen",
    label: "Qwen (Alibaba DashScope)",
    kind: "openai_compatible",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    suggestedModel: "qwen-max",
    docsUrl: "https://www.alibabacloud.com/help/en/model-studio/",
    requiresBaseUrl: false,
    keyOptional: false,
    note: "Defaults to the international endpoint. For mainland China, change the base URL to https://dashscope.aliyuncs.com/compatible-mode/v1.",
  },
  {
    id: "openai",
    label: "OpenAI",
    kind: "openai_compatible",
    baseUrl: "https://api.openai.com/v1",
    suggestedModel: "gpt-4o",
    docsUrl: "https://platform.openai.com/docs/models",
    requiresBaseUrl: false,
    keyOptional: false,
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    kind: "openai_compatible",
    baseUrl: "https://api.deepseek.com/v1",
    suggestedModel: "deepseek-chat",
    docsUrl: "https://api-docs.deepseek.com/",
    requiresBaseUrl: false,
    keyOptional: false,
  },
  {
    id: "groq",
    label: "Groq",
    kind: "openai_compatible",
    baseUrl: "https://api.groq.com/openai/v1",
    suggestedModel: "llama-3.3-70b-versatile",
    docsUrl: "https://console.groq.com/docs/models",
    requiresBaseUrl: false,
    keyOptional: false,
  },
  {
    id: "mistral",
    label: "Mistral",
    kind: "openai_compatible",
    baseUrl: "https://api.mistral.ai/v1",
    suggestedModel: "mistral-large-latest",
    docsUrl: "https://docs.mistral.ai/getting-started/models/models_overview/",
    requiresBaseUrl: false,
    keyOptional: false,
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    kind: "openai_compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    suggestedModel: "qwen/qwen-2.5-72b-instruct",
    docsUrl: "https://openrouter.ai/models",
    requiresBaseUrl: false,
    keyOptional: false,
    note: "A single key that fronts many providers — useful for comparing models without collecting keys for each.",
  },
  {
    id: "together",
    label: "Together AI",
    kind: "openai_compatible",
    baseUrl: "https://api.together.xyz/v1",
    suggestedModel: "Qwen/Qwen2.5-72B-Instruct-Turbo",
    docsUrl: "https://docs.together.ai/docs/serverless-models",
    requiresBaseUrl: false,
    keyOptional: false,
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    kind: "openai_compatible",
    baseUrl: "http://localhost:11434/v1",
    suggestedModel: "qwen2.5:14b",
    docsUrl: "https://ollama.com/library",
    requiresBaseUrl: false,
    keyOptional: true,
    note: "Runs on your machine, so it needs no key. The model must support tool calling or the agent cannot run SQL.",
  },
  {
    id: "custom",
    label: "Custom (OpenAI-compatible)",
    kind: "openai_compatible",
    baseUrl: null,
    suggestedModel: "",
    docsUrl: "",
    requiresBaseUrl: true,
    keyOptional: false,
    note: "Any endpoint implementing POST /chat/completions with tool calling.",
  },
];

export const PROVIDER_IDS = PROVIDER_PRESETS.map((preset) => preset.id);

export function findPreset(id: string): ProviderPreset | null {
  return PROVIDER_PRESETS.find((preset) => preset.id === id) ?? null;
}

export function kindFor(providerId: string): ModelProviderKind {
  return findPreset(providerId)?.kind ?? "openai_compatible";
}

/**
 * The base URL a provider will actually use.
 *
 * An explicitly configured URL always wins — that is how someone points the
 * `qwen` preset at the mainland endpoint, or `openai` at a proxy — and the
 * preset default fills in otherwise.
 */
export function resolveBaseUrl(providerId: string, configured: string | null): string | null {
  if (configured?.trim()) return configured.trim().replace(/\/+$/, "");
  return findPreset(providerId)?.baseUrl ?? null;
}
