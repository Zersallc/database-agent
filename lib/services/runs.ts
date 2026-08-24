/**
 * Agent runs.
 *
 * A run is the unit of work behind "ask a question": it appends the user's
 * message, drives the agent loop, records every query the agent ran, appends
 * the reply, and stores the trace. One request in, a durable, auditable record
 * out.
 *
 * The run record is written before the agent starts and updated when it
 * finishes, so a client that loses the connection mid-answer can still fetch
 * `GET /v1/runs/{id}` and find out what happened.
 */

import { ApiError, toApiError } from "@/lib/api/errors";
import { newId } from "@/lib/api/ids";
import { runAgent, type AgentEvent, type AgentStep } from "@/lib/agent";
import type { ResponseDetail } from "@/lib/agent/prompt";
import { stores } from "@/lib/providers";
import { getSchema, requireConnection, type ConnectionDoc } from "./connections";
import {
  appendMessage,
  conversationHistory,
  type Attachment,
  type ConversationDoc,
} from "./conversations";
import { resolveModelClient } from "./model-providers";
import { buildAgentContext } from "./playbook";
import { runQuery, toQueryResult } from "./queries";
import { notFound } from "@/lib/api/errors";

export type RunDoc = {
  id: string;
  object: "run";
  conversation_id: string;
  connection_id: string | null;
  status: "queued" | "running" | "succeeded" | "failed";
  request_message_id: string | null;
  response_message_id: string | null;
  content: string | null;
  steps: AgentStep[];
  model: string | null;
  usage: { input_tokens: number; output_tokens: number } | null;
  error: { code: string; message: string } | null;
  created_by: string | null;
  created_at: string;
  completed_at: string | null;
};

export function serializeRun(doc: RunDoc) {
  return {
    id: doc.id,
    object: doc.object,
    conversation_id: doc.conversation_id,
    connection_id: doc.connection_id,
    status: doc.status,
    request_message_id: doc.request_message_id,
    response_message_id: doc.response_message_id,
    content: doc.content,
    steps: doc.steps,
    model: doc.model,
    usage: doc.usage,
    duration_ms: doc.completed_at
      ? new Date(doc.completed_at).getTime() - new Date(doc.created_at).getTime()
      : null,
    error: doc.error,
    created_at: doc.created_at,
    completed_at: doc.completed_at,
  };
}

export async function requireRun(tenantId: string, runId: string): Promise<RunDoc> {
  const doc = await stores().documents.get<RunDoc>("runs", tenantId, runId);
  if (!doc) throw notFound("run", runId);
  return doc;
}

export type CreateRunInput = {
  content: string;
  attachments?: Attachment[];
  connectionId?: string;
  responseDetail: ResponseDetail;
};

/** API-level event, mirroring the `RunEvent` schema in the contract. */
export type RunEvent =
  | { type: "run.created"; run_id: string; run: ReturnType<typeof serializeRun> }
  | { type: "run.step"; run_id: string; step: AgentStep }
  | { type: "run.content_delta"; run_id: string; delta: string }
  | { type: "run.completed"; run_id: string; run: ReturnType<typeof serializeRun> }
  | { type: "run.failed"; run_id: string; run: ReturnType<typeof serializeRun>; error: unknown };

/**
 * Executes a run, yielding events as it goes.
 *
 * Both the streaming and non-streaming endpoints drive this same generator —
 * the difference is only whether the caller forwards the events or drains them
 * and returns the final record. That keeps the two paths from drifting, which
 * is how a streamed answer and a fetched one end up disagreeing.
 */
export async function* executeRun(
  tenantId: string,
  userId: string,
  conversation: ConversationDoc,
  input: CreateRunInput
): AsyncGenerator<RunEvent> {
  const { documents } = stores();
  const now = new Date().toISOString();
  const runId = newId("run");

  const connectionId = input.connectionId ?? conversation.connection_id;
  let connection: ConnectionDoc | null = null;
  if (connectionId) {
    connection = await requireConnection(tenantId, connectionId);
  }

  const requestMessage = await appendMessage(tenantId, conversation, {
    role: "user",
    content: input.content,
    attachments: input.attachments,
  });

  let run: RunDoc = {
    id: runId,
    object: "run",
    conversation_id: conversation.id,
    connection_id: connection?.id ?? null,
    status: "running",
    request_message_id: requestMessage.id,
    response_message_id: null,
    content: null,
    steps: [],
    model: null,
    usage: null,
    error: null,
    created_by: userId,
    created_at: now,
    completed_at: null,
  };
  await documents.put("runs", tenantId, run);
  yield { type: "run.created", run_id: runId, run: serializeRun(run) };

  try {
    const history = (await conversationHistory(tenantId, conversation.id))
      // The question was just appended; the agent receives it separately.
      .filter((message) => message.id !== requestMessage.id)
      .map((message) => ({ role: message.role, content: message.content }));

    const playbookContext = await buildAgentContext(tenantId);

    // Introspection failing should not kill the run: the agent can still say
    // something useful, and it is told the schema is unavailable so it does not
    // invent table names.
    let schema = null;
    if (connection) {
      try {
        schema = (await getSchema(tenantId, connection)).tables;
      } catch {
        schema = [];
      }
    }

    const agentConnection = connection
      ? {
          name: connection.name,
          engine: connection.engine,
          schema,
          // Each query opens its own connector. That costs a connection setup
          // per query; the alternative is holding one open across the whole
          // run, including across model latency, which is worse for a database
          // with a bounded connection pool.
          execute: async (sql: string) => {
            const query = await runQuery(tenantId, connection!, { sql, userId });
            if (query.status === "failed") {
              throw new Error(query.error?.message ?? "The query failed.");
            }
            return { queryId: query.id, result: toQueryResult(query) };
          },
        }
      : null;

    let final: Extract<AgentEvent, { type: "completed" }> | null = null;
    let failure: ApiError | null = null;
    const steps: AgentStep[] = [];

    // Resolved per run rather than cached: rotating a key or switching provider
    // in settings must take effect on the next question, not the next deploy.
    const resolved = await resolveModelClient(tenantId);

    // Fixed to this app's own Postgres schema (Report/Inventory/item_sustainability),
    // not the dynamically-configured `connection` above — a conversation's chosen
    // data source has no bearing on whether the ESG report pipeline is available.
    const reportGenerator: NonNullable<Parameters<typeof runAgent>[0]["reportGenerator"]> = {
      generate: async ({ hospitalName, year, month }) => {
        const { aggregateEsgReport } = await import("./esg-report");
        const { renderEsgReportPdf } = await import("@/lib/reports/esg-pdf");
        const { renderEsgReportExcel } = await import("@/lib/reports/esg-excel");
        const { createReportFile } = await import("./report-files");

        const data = await aggregateEsgReport({ hospitalName, year, month });
        const slug = `${hospitalName.replace(/[^a-z0-9]+/gi, "-")}-${year}-${String(month).padStart(2, "0")}`;

        const [pdfBytes, xlsxBytes] = await Promise.all([
          renderEsgReportPdf(data),
          renderEsgReportExcel(data),
        ]);

        const [pdfDoc, xlsxDoc] = await Promise.all([
          createReportFile(tenantId, {
            name: `esg-report-${slug}.pdf`,
            mimeType: "application/pdf",
            bytes: pdfBytes,
            userId,
          }),
          createReportFile(tenantId, {
            name: `esg-report-${slug}.xlsx`,
            mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            bytes: xlsxBytes,
            userId,
          }),
        ]);

        return {
          itemsRemoved: data.itemsRemoved,
          files: [
            { name: pdfDoc.name, downloadUrl: `/api/v1/reports/${pdfDoc.id}/download` },
            { name: xlsxDoc.name, downloadUrl: `/api/v1/reports/${xlsxDoc.id}/download` },
          ],
        };
      },
    };

    for await (const event of runAgent({
      question: input.content,
      history,
      playbookContext,
      responseDetail: input.responseDetail,
      connection: agentConnection,
      client: resolved?.client ?? null,
      reportGenerator,
    })) {
      if (event.type === "step") {
        steps.push(event.step);
        yield { type: "run.step", run_id: runId, step: event.step };
      } else if (event.type === "delta") {
        yield { type: "run.content_delta", run_id: runId, delta: event.text };
      } else if (event.type === "completed") {
        final = event;
      } else {
        failure = event.error;
      }
    }

    if (failure || !final) {
      throw failure ?? new ApiError("upstream_model_error", "The agent produced no answer.");
    }

    const completedAt = new Date().toISOString();
    const responseMessage = await appendMessage(tenantId, conversation, {
      role: "assistant",
      content: final.content,
      runId,
      usage: final.usage,
      durationMs: new Date(completedAt).getTime() - new Date(run.created_at).getTime(),
    });

    run = {
      ...run,
      status: "succeeded",
      response_message_id: responseMessage.id,
      content: final.content,
      steps: final.steps.length ? final.steps : steps,
      model: final.model,
      usage: final.usage,
      completed_at: completedAt,
    };
    await documents.put("runs", tenantId, run);
    yield { type: "run.completed", run_id: runId, run: serializeRun(run) };
  } catch (error) {
    const apiError = toApiError(error);
    run = {
      ...run,
      status: "failed",
      error: { code: apiError.code, message: apiError.message },
      completed_at: new Date().toISOString(),
    };
    await documents.put("runs", tenantId, run);
    yield {
      type: "run.failed",
      run_id: runId,
      run: serializeRun(run),
      error: apiError.toBody(runId),
    };
  }
}

/** Drains a run and returns the final record. Throws if the run failed. */
export async function runToCompletion(
  tenantId: string,
  userId: string,
  conversation: ConversationDoc,
  input: CreateRunInput
): Promise<RunDoc> {
  let run: RunDoc | null = null;

  for await (const event of executeRun(tenantId, userId, conversation, input)) {
    if (event.type === "run.completed") {
      run = (await stores().documents.get<RunDoc>("runs", tenantId, event.run_id))!;
    } else if (event.type === "run.failed") {
      const failed = await stores().documents.get<RunDoc>("runs", tenantId, event.run_id);
      throw new ApiError(
        (failed?.error?.code as never) ?? "upstream_model_error",
        failed?.error?.message ?? "The run failed.",
        { details: { run_id: event.run_id } }
      );
    }
  }

  if (!run) throw new ApiError("internal_error", "The run produced no result.");
  return run;
}

/**
 * Server-sent events.
 *
 * A run can take a minute — schema read, model turn, query, another model turn.
 * Without streaming the client stares at nothing and proxies start timing out
 * connections that look idle.
 */
export function runToSseStream(
  tenantId: string,
  userId: string,
  conversation: ConversationDoc,
  input: CreateRunInput,
  requestId: string
): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: RunEvent) => {
        controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
      };
      try {
        for await (const event of executeRun(tenantId, userId, conversation, input)) {
          send(event);
        }
      } catch (error) {
        const apiError = toApiError(error);
        controller.enqueue(
          encoder.encode(
            `event: run.failed\ndata: ${JSON.stringify({
              type: "run.failed",
              error: apiError.toBody(requestId),
            })}\n\n`
          )
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 201,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      // Nginx and several CDNs buffer responses by default, which turns a
      // stream into one delivery at the end. This opts out.
      "X-Accel-Buffering": "no",
      "X-Request-Id": requestId,
    },
  });
}
