/**
 * Anthropic adapter.
 *
 * Uses the official SDK rather than raw HTTP, because the SDK is where the
 * Messages API's newer surface lives — adaptive thinking, effort, server-side
 * refusal fallback — and hand-rolling those against a moving API is how a client
 * quietly falls behind. It stays an optional dependency: a deployment that only
 * ever talks to Qwen never installs it.
 */

import { optionalModule } from "@/lib/providers/optional-module";
import type {
  ModelClient,
  ModelClientConfig,
  ModelRequest,
  ModelStreamEvent,
  ModelTurn,
  ProbeOutcome,
  StopReason,
  ToolCall,
} from "./types";
import { ModelProviderError } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any -- the SDK is loaded at runtime */

export class AnthropicModelClient implements ModelClient {
  readonly kind = "anthropic" as const;
  readonly model: string;
  private sdk: Promise<any> | null = null;

  constructor(private readonly config: ModelClientConfig) {
    this.model = config.model;
  }

  private client(): Promise<any> {
    this.sdk ??= (async () => {
      const mod = await optionalModule("@anthropic-ai/sdk", "the Anthropic model provider");
      const Anthropic = (mod.default ?? mod.Anthropic) as new (options?: object) => any;
      return new Anthropic({
        // A null key means "fall back to the SDK's own resolution" — the
        // ANTHROPIC_API_KEY env var, or a logged-in CLI profile.
        ...(this.config.apiKey ? { apiKey: this.config.apiKey } : {}),
        ...(this.config.baseUrl ? { baseURL: this.config.baseUrl } : {}),
      });
    })();
    return this.sdk;
  }

  async probe(): Promise<ProbeOutcome> {
    const started = performance.now();
    try {
      const client = await this.client();
      // Retrieving the model validates the credential *and* that this key can
      // reach this model, without generating a single token.
      await client.models.retrieve(this.model);
      return {
        ok: true,
        latency_ms: Math.round(performance.now() - started),
        detail: null,
        model_available: true,
      };
    } catch (error) {
      const status = (error as { status?: number }).status;
      // A 404 means the key works but names a model it cannot use — worth
      // distinguishing from "your key is wrong".
      if (status === 404) {
        return {
          ok: false,
          latency_ms: null,
          detail: `The key is valid but has no access to '${this.model}', or that model does not exist.`,
          model_available: false,
        };
      }
      return {
        ok: false,
        latency_ms: null,
        detail: describe(error),
        model_available: null,
      };
    }
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    const client = await this.client();

    let stream: any;
    try {
      stream = client.beta.messages.stream({
        model: this.model,
        max_tokens: request.maxTokens,
        // Claude's classifiers can decline a request outright. Server-side
        // fallback re-runs it on the recommended model within the same call, so
        // a benign question that trips a classifier still gets answered.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        thinking: { type: "adaptive" },
        output_config: { effort: request.effort },
        // The system prompt is identical across every turn of a conversation and
        // large — it carries the whole schema — so it is the cache breakpoint.
        system: [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }],
        ...(request.tools.length > 0 ? { tools: request.tools.map(toAnthropicTool) } : {}),
        messages: toAnthropicMessages(request.messages),
      });
    } catch (error) {
      throw wrap(error);
    }

    try {
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
          yield { type: "text_delta", text: event.delta.text };
        }
      }

      const message = await stream.finalMessage();
      yield { type: "turn", turn: toTurn(message) };
    } catch (error) {
      throw wrap(error);
    }
  }
}

function toAnthropicTool(tool: { name: string; description: string; parameters: Record<string, unknown> }) {
  return {
    name: tool.name,
    description: tool.description,
    // `strict` makes the API guarantee the input validates against the schema,
    // so the loop never has to defend against a malformed tool call.
    strict: true,
    input_schema: tool.parameters,
  };
}

/**
 * Normalized history to Anthropic's shape.
 *
 * Two things this has to get right. Assistant turns are replayed from `raw` —
 * the original content blocks — because thinking blocks carry signatures the API
 * rejects if they are reconstructed. And consecutive tool results must collapse
 * into a *single* user message: splitting them across messages tells Claude its
 * parallel tool calls were not all answered, and it stops making them.
 */
export function toAnthropicMessages(messages: ModelMessageList): any[] {
  const out: any[] = [];
  let pendingResults: any[] = [];

  const flush = () => {
    if (pendingResults.length === 0) return;
    out.push({ role: "user", content: pendingResults });
    pendingResults = [];
  };

  for (const message of messages) {
    if (message.role === "tool") {
      pendingResults.push({
        type: "tool_result",
        tool_use_id: message.toolCallId,
        content: message.content,
        ...(message.isError ? { is_error: true } : {}),
      });
      continue;
    }

    flush();

    if (message.role === "user") {
      out.push({ role: "user", content: message.content });
      continue;
    }

    if (Array.isArray(message.raw)) {
      out.push({ role: "assistant", content: message.raw });
      continue;
    }

    // No raw blocks — a history loaded from storage rather than produced in this
    // process. Rebuild what we can; there is no thinking block to preserve.
    const blocks: any[] = [];
    if (message.content) blocks.push({ type: "text", text: message.content });
    for (const call of message.toolCalls) {
      blocks.push({ type: "tool_use", id: call.id, name: call.name, input: call.input });
    }
    out.push({ role: "assistant", content: blocks.length > 0 ? blocks : message.content });
  }

  flush();
  return out;
}

type ModelMessageList = ModelRequest["messages"];

function toTurn(message: any): ModelTurn {
  const toolCalls: ToolCall[] = (message.content ?? [])
    .filter((block: any) => block.type === "tool_use")
    .map((block: any) => ({ id: block.id, name: block.name, input: block.input ?? {} }));

  const text = (message.content ?? [])
    .filter((block: any) => block.type === "text")
    .map((block: any) => block.text)
    .join("");

  return {
    text,
    toolCalls,
    stopReason: mapStopReason(message.stop_reason),
    model: message.model ?? null,
    usage: message.usage
      ? {
          input_tokens: message.usage.input_tokens ?? 0,
          output_tokens: message.usage.output_tokens ?? 0,
        }
      : null,
    refusalDetail: message.stop_details?.category ?? null,
    raw: message.content,
  };
}

function mapStopReason(reason: string | null | undefined): StopReason {
  switch (reason) {
    case "tool_use":
      return "tool_use";
    case "refusal":
      return "refusal";
    case "max_tokens":
    case "model_context_window_exceeded":
      return "max_tokens";
    default:
      // `end_turn`, `stop_sequence`, and `pause_turn` all mean "nothing more to
      // do this turn". The loop treats an empty answer as complete rather than
      // spinning, which is the safe reading of an unfamiliar stop reason.
      return "end_turn";
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function wrap(error: unknown): ModelProviderError {
  if (error instanceof ModelProviderError) return error;
  return new ModelProviderError(describe(error), (error as { status?: number }).status, {
    cause: error,
  });
}
