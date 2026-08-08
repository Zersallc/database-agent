/**
 * OpenAI Chat Completions adapter.
 *
 * One adapter, most of the ecosystem: Qwen (DashScope), OpenAI, DeepSeek, Groq,
 * Mistral, OpenRouter, Together and Ollama all expose this format, so adding any
 * of them is a base URL and a key rather than new code.
 *
 * Raw `fetch` rather than the `openai` package, deliberately. The package would
 * become a hard dependency for someone who only ever talks to Qwen, and it
 * layers OpenAI-specific behavior over what is, at these endpoints, a plain
 * documented HTTP contract. Streaming SSE and accumulating fragmented tool-call
 * arguments is the whole of the work, and it is better owned here than debugged
 * through a wrapper built for a different provider.
 */

import type {
  ModelClient,
  ModelClientConfig,
  ModelMessage,
  ModelRequest,
  ModelStreamEvent,
  ModelTurn,
  ProbeOutcome,
  StopReason,
  ToolCall,
  ToolDefinition,
} from "./types";
import { ModelProviderError } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any -- provider JSON is untyped by nature */

/** Generous: an agent turn on a slow local model legitimately takes minutes. */
const REQUEST_TIMEOUT_MS = Number(process.env.MODEL_REQUEST_TIMEOUT_MS ?? 300000);

export class OpenAiCompatibleModelClient implements ModelClient {
  readonly kind = "openai_compatible" as const;
  readonly model: string;
  private readonly baseUrl: string;

  constructor(private readonly config: ModelClientConfig) {
    if (!config.baseUrl) {
      throw new ModelProviderError(
        "This provider needs a base URL, for example https://api.openai.com/v1.",
        undefined
      );
    }
    this.model = config.model;
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      // Local runtimes like Ollama accept anything here, so a missing key is
      // only a problem for providers that actually check it.
      ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
    };
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: { ...this.headers(), ...(init.headers as Record<string, string>) },
        signal: controller.signal,
      });
    } catch (cause) {
      if ((cause as Error).name === "AbortError") {
        throw new ModelProviderError(
          `The provider did not respond within ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s.`,
          undefined,
          { cause }
        );
      }
      throw new ModelProviderError(
        `Could not reach ${this.baseUrl}: ${(cause as Error).message}`,
        undefined,
        { cause }
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async probe(): Promise<ProbeOutcome> {
    const started = performance.now();

    const listing = await this.request("/models", { method: "GET" }).catch((error) => error);
    if (listing instanceof Error) {
      return { ok: false, latency_ms: null, detail: listing.message, model_available: null };
    }

    if (listing.ok) {
      const body = (await listing.json().catch(() => null)) as any;
      const ids: string[] = Array.isArray(body?.data)
        ? body.data.map((entry: any) => String(entry?.id ?? "")).filter(Boolean)
        : [];
      const available = ids.length > 0 ? ids.includes(this.model) : null;
      return {
        ok: true,
        latency_ms: Math.round(performance.now() - started),
        // An unlisted model is a warning, not a failure: several providers
        // return a partial catalogue, and refusing to save a working config
        // over that would be worse than letting the first run report it.
        detail: available === false ? `'${this.model}' was not in the provider's model list.` : null,
        model_available: available,
      };
    }

    if (listing.status === 401 || listing.status === 403) {
      return {
        ok: false,
        latency_ms: null,
        detail: "The provider rejected the API key.",
        model_available: null,
      };
    }

    // No catalogue endpoint. Fall back to the smallest possible completion,
    // which proves the credential even where /models does not exist.
    return this.probeByCompletion(started);
  }

  private async probeByCompletion(started: number): Promise<ProbeOutcome> {
    const response = await this.request("/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }],
      }),
    }).catch((error) => error);

    if (response instanceof Error) {
      return { ok: false, latency_ms: null, detail: response.message, model_available: null };
    }
    if (response.ok) {
      return {
        ok: true,
        latency_ms: Math.round(performance.now() - started),
        detail: null,
        model_available: true,
      };
    }
    return {
      ok: false,
      latency_ms: null,
      detail: await errorDetail(response),
      model_available: response.status === 404 ? false : null,
    };
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    const response = await this.request("/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model: this.model,
        max_tokens: request.maxTokens,
        stream: true,
        // Providers that support it report token usage on the final chunk.
        // The ones that do not simply ignore the field.
        stream_options: { include_usage: true },
        messages: toOpenAiMessages(request.system, request.messages),
        ...(request.tools.length > 0
          ? { tools: request.tools.map(toOpenAiTool), tool_choice: "auto" }
          : {}),
      }),
    });

    if (!response.ok || !response.body) {
      throw new ModelProviderError(await errorDetail(response), response.status);
    }

    const accumulator = new StreamAccumulator();

    for await (const payload of readServerSentEvents(response.body)) {
      let chunk: any;
      try {
        chunk = JSON.parse(payload);
      } catch {
        // A malformed chunk is not worth failing the whole turn over; the
        // remaining chunks still carry the answer.
        continue;
      }

      // Some providers deliver errors mid-stream with a 200 status.
      if (chunk.error) {
        throw new ModelProviderError(
          String(chunk.error.message ?? "The provider reported an error mid-stream."),
          undefined
        );
      }

      const text = accumulator.consume(chunk);
      if (text) yield { type: "text_delta", text };
    }

    yield { type: "turn", turn: accumulator.finish(this.model) };
  }
}

/**
 * Reassembles one streamed completion.
 *
 * Tool calls are the fiddly part: `function.arguments` arrives as JSON split
 * across arbitrarily many chunks, keyed only by an array index, so it has to be
 * concatenated per index and parsed once at the end.
 */
class StreamAccumulator {
  private text = "";
  private finishReason: string | null = null;
  private usage: { input_tokens: number; output_tokens: number } | null = null;
  private model: string | null = null;
  private readonly calls = new Map<number, { id: string; name: string; args: string }>();

  /** Folds one chunk in and returns any new text to emit. */
  consume(chunk: any): string {
    if (chunk.model) this.model = chunk.model;

    if (chunk.usage) {
      this.usage = {
        input_tokens: chunk.usage.prompt_tokens ?? 0,
        output_tokens: chunk.usage.completion_tokens ?? 0,
      };
    }

    const choice = chunk.choices?.[0];
    if (!choice) return "";
    if (choice.finish_reason) this.finishReason = choice.finish_reason;

    for (const call of choice.delta?.tool_calls ?? []) {
      const index = call.index ?? 0;
      const existing = this.calls.get(index) ?? { id: "", name: "", args: "" };
      this.calls.set(index, {
        id: call.id ?? existing.id,
        name: call.function?.name ?? existing.name,
        args: existing.args + (call.function?.arguments ?? ""),
      });
    }

    const delta = choice.delta?.content;
    if (typeof delta === "string" && delta) {
      this.text += delta;
      return delta;
    }
    return "";
  }

  finish(requestedModel: string): ModelTurn {
    const toolCalls: ToolCall[] = [];

    for (const [index, call] of [...this.calls.entries()].sort(([a], [b]) => a - b)) {
      let input: Record<string, unknown> = {};
      try {
        input = call.args ? JSON.parse(call.args) : {};
      } catch {
        // Truncated or invalid arguments. Passing an empty object through lets
        // the tool reject it with a message the model can act on, which beats
        // failing the whole run over one malformed call.
        input = {};
      }
      toolCalls.push({
        // Not every provider assigns an ID. The result has to reference
        // *something*, so synthesize a stable one from the index.
        id: call.id || `call_${index}`,
        name: call.name,
        input,
      });
    }

    return {
      text: this.text,
      toolCalls,
      stopReason: mapFinishReason(this.finishReason, toolCalls.length > 0),
      model: this.model ?? requestedModel,
      usage: this.usage,
      refusalDetail: this.finishReason === "content_filter" ? "content_filter" : null,
    };
  }
}

/**
 * Server-sent events from a byte stream.
 *
 * Chunk boundaries fall wherever the network puts them, so events are buffered
 * until a blank-line terminator rather than assumed to arrive whole.
 */
export async function* readServerSentEvents(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const raw = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        const data = raw
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("");

        if (data === "[DONE]") return;
        if (data) yield data;

        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export function toOpenAiTool(tool: ToolDefinition) {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

/**
 * Normalized history to the Chat Completions shape.
 *
 * Flatter than Anthropic's: the system prompt is a message rather than a
 * top-level field, and each tool result is its own `role: "tool"` message
 * instead of being grouped into a user turn.
 */
export function toOpenAiMessages(system: string, messages: ModelMessage[]): any[] {
  const out: any[] = [{ role: "system", content: system }];

  for (const message of messages) {
    if (message.role === "user") {
      out.push({ role: "user", content: message.content });
      continue;
    }

    if (message.role === "tool") {
      out.push({
        role: "tool",
        tool_call_id: message.toolCallId,
        // There is no `is_error` field here, so failures have to read as
        // failures in the text itself. The caller writes them that way.
        content: message.content,
      });
      continue;
    }

    const assistant: any = { role: "assistant" };
    if (message.content) assistant.content = message.content;
    if (message.toolCalls.length > 0) {
      assistant.tool_calls = message.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: JSON.stringify(call.input) },
      }));
    }
    // Several implementations reject an assistant message with neither field.
    if (!assistant.content && !assistant.tool_calls) assistant.content = "";
    out.push(assistant);
  }

  return out;
}

export function mapFinishReason(reason: string | null, sawToolCalls: boolean): StopReason {
  switch (reason) {
    case "tool_calls":
    case "function_call":
      return "tool_use";
    case "length":
      return "max_tokens";
    case "content_filter":
      return "refusal";
    default:
      // Some providers omit `finish_reason` on the chunk that carries tool
      // calls. Trusting the calls we actually received is more reliable than
      // trusting the field, and getting this wrong strands the run.
      return sawToolCalls ? "tool_use" : "end_turn";
  }
}

async function errorDetail(response: Response): Promise<string> {
  const body = await response.text().catch(() => "");
  let message = body.slice(0, 500);

  try {
    const parsed = JSON.parse(body);
    message = String(parsed?.error?.message ?? parsed?.message ?? message);
  } catch {
    // Not JSON — the raw body is the best detail available.
  }

  if (response.status === 401 || response.status === 403) {
    return `The provider rejected the API key (${response.status}). ${message}`.trim();
  }
  if (response.status === 404) {
    return `The provider returned 404 — check the base URL and the model name. ${message}`.trim();
  }
  return `The provider returned ${response.status}. ${message}`.trim();
}
