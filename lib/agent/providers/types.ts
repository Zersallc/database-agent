/**
 * The model provider interface.
 *
 * The agent loop is the same work regardless of who answers: read the schema,
 * write SQL, run it, read the rows, answer. Only the wire format differs. So the
 * loop talks to `ModelClient` in normalized terms — messages, tool calls, text
 * deltas, a stop reason — and each adapter translates to and from its provider's
 * shapes.
 *
 * Two adapters cover the field today. `anthropic` speaks Claude's Messages API.
 * `openai_compatible` speaks the OpenAI Chat Completions format, which Qwen,
 * DeepSeek, Groq, Mistral, OpenRouter, Together and Ollama all implement — one
 * adapter, most of the ecosystem.
 */

export type ModelProviderKind = "anthropic" | "openai_compatible";

export type ToolCall = {
  /** Provider-assigned ID. Must be echoed on the matching result. */
  id: string;
  name: string;
  input: Record<string, unknown>;
};

/**
 * A turn in normalized form.
 *
 * `raw` on an assistant message carries the provider's own representation.
 * Anthropic needs its content blocks replayed byte-for-byte — thinking blocks
 * carry signatures, and reconstructing them from `content` + `toolCalls` would
 * invalidate the turn. Adapters that do not need it ignore it.
 */
export type ModelMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls: ToolCall[]; raw?: unknown }
  | { role: "tool"; toolCallId: string; toolName: string; content: string; isError: boolean };

export type ToolDefinition = {
  name: string;
  description: string;
  /** JSON Schema for the tool's input, shared verbatim by both wire formats. */
  parameters: Record<string, unknown>;
};

/**
 * Why generation stopped.
 *
 * Normalized because the loop branches on it: `tool_use` means run the tools and
 * go again, `refusal` means stop and say so, and anything else means the answer
 * is complete. Providers spell these differently and some omit cases entirely —
 * an adapter maps whatever it gets onto one of these four.
 */
export type StopReason = "end_turn" | "tool_use" | "refusal" | "max_tokens";

export type ModelUsage = { input_tokens: number; output_tokens: number };

export type ModelTurn = {
  text: string;
  toolCalls: ToolCall[];
  stopReason: StopReason;
  /** What actually answered. May differ from the requested model on fallback. */
  model: string | null;
  usage: ModelUsage | null;
  /** Populated on `refusal` when the provider says why. */
  refusalDetail: string | null;
  raw?: unknown;
};

export type ModelStreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "turn"; turn: ModelTurn };

export type ModelRequest = {
  system: string;
  messages: ModelMessage[];
  /** Empty when no database is attached — the model then has nothing to call. */
  tools: ToolDefinition[];
  maxTokens: number;
  /** Anthropic-only reasoning depth. Adapters without an equivalent ignore it. */
  effort: string;
};

export type ProbeOutcome = {
  ok: boolean;
  latency_ms: number | null;
  detail: string | null;
  /**
   * Whether the configured model appeared in the provider's catalogue. Null when
   * the provider does not offer one, or lists models we cannot match against —
   * an unlisted model is a warning, never a failure.
   */
  model_available: boolean | null;
};

export interface ModelClient {
  readonly kind: ModelProviderKind;
  readonly model: string;
  /**
   * One model turn. Yields text as it arrives and ends with exactly one `turn`
   * event carrying the complete result.
   */
  stream(request: ModelRequest): AsyncIterable<ModelStreamEvent>;
  /** Cheap credential and model check. Must not consume generation tokens. */
  probe(): Promise<ProbeOutcome>;
}

/** Everything an adapter needs to talk to one configured provider. */
export type ModelClientConfig = {
  apiKey: string | null;
  /** Null means the adapter's own default host. */
  baseUrl: string | null;
  model: string;
};

/**
 * A provider rejected the request in a way the caller can act on.
 *
 * Carries the HTTP status so the agent can tell "your key is wrong" from "you
 * are being rate limited" from "that model does not exist" — three problems with
 * three different fixes.
 */
export class ModelProviderError extends Error {
  constructor(
    message: string,
    readonly status: number | undefined,
    options: { cause?: unknown } = {}
  ) {
    super(message, options);
    this.name = "ModelProviderError";
  }
}
