/**
 * Model provider registry.
 *
 * Two wire formats, many providers. Everything else in the codebase asks for a
 * `ModelClient` and never learns which one it got.
 */

import { AnthropicModelClient } from "./anthropic";
import { OpenAiCompatibleModelClient } from "./openai-compatible";
import { kindFor, resolveBaseUrl } from "./presets";
import type { ModelClient, ModelClientConfig, ModelProviderKind } from "./types";
import { ModelProviderError } from "./types";

export function createModelClient(
  providerId: string,
  config: ModelClientConfig
): ModelClient {
  const kind: ModelProviderKind = kindFor(providerId);

  switch (kind) {
    case "anthropic":
      return new AnthropicModelClient(config);
    case "openai_compatible":
      return new OpenAiCompatibleModelClient({
        ...config,
        baseUrl: resolveBaseUrl(providerId, config.baseUrl),
      });
    default:
      throw new ModelProviderError(`No adapter for provider '${providerId}'.`, undefined);
  }
}

export {
  PROVIDER_IDS,
  PROVIDER_PRESETS,
  findPreset,
  kindFor,
  resolveBaseUrl,
  type ProviderPreset,
} from "./presets";
export { ModelProviderError } from "./types";
export type {
  ModelClient,
  ModelClientConfig,
  ModelMessage,
  ModelProviderKind,
  ModelRequest,
  ModelStreamEvent,
  ModelTurn,
  ModelUsage,
  ProbeOutcome,
  StopReason,
  ToolCall,
  ToolDefinition,
} from "./types";
