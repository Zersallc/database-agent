import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/handler";
import * as v from "@/lib/api/validate";
import { requireConversation } from "@/lib/services/conversations";
import { runToCompletion, runToSseStream, serializeRun } from "@/lib/services/runs";

export const runtime = "nodejs";

// An agent run can take minutes: schema read, model turn, query, model turn.
// The platform default would cut it off mid-answer.
export const maxDuration = 300;

type Params = { conversation_id: string };

const ATTACHMENT = v.object({
  file_id: v.string({ min: 1 }),
  name: v.string({ min: 1, max: 255 }),
  mime_type: v.string({ min: 1, max: 255 }),
  size_bytes: v.optional(v.integer({ min: 0 })),
});

const CREATE = v.object({
  content: v.string({ max: 100000, trim: false }),
  attachments: v.withDefault(v.array(ATTACHMENT, { max: 10 }), []),
  connection_id: v.optional(v.string({ min: 1 })),
  response_detail: v.withDefault(
    v.oneOf(["concise", "balanced", "detailed"] as const),
    "balanced"
  ),
  stream: v.withDefault(v.boolean(), false),
});

/**
 * Ask the agent a question.
 *
 * With `stream: true` the response is `text/event-stream`; otherwise it is the
 * completed run. Both paths drive the same generator, so a streamed answer and
 * a fetched one can never disagree.
 */
export const POST = defineRoute<Params>({
  scopes: ["runs:write"],
  rateLimit: "run",
  idempotent: true,
  handler: async ({ principal, params, body, requestId }) => {
    const input = v.validate(body, CREATE);

    if (!input.content.trim() && input.attachments.length === 0) {
      throw new ApiError(
        "validation_failed",
        "A run needs either a question or at least one attachment.",
        { details: { fields: [{ path: "content", issue: "must not be empty without attachments" }] } }
      );
    }

    const conversation = await requireConversation(principal.tenantId, params.conversation_id);

    const runInput = {
      content: input.content,
      attachments: input.attachments.map((attachment) => ({
        file_id: attachment.file_id,
        name: attachment.name,
        mime_type: attachment.mime_type,
        size_bytes: attachment.size_bytes ?? null,
      })),
      connectionId: input.connection_id,
      responseDetail: input.response_detail,
    };

    if (input.stream) {
      return runToSseStream(
        principal.tenantId,
        principal.userId,
        conversation,
        runInput,
        requestId
      );
    }

    const run = await runToCompletion(
      principal.tenantId,
      principal.userId,
      conversation,
      runInput
    );
    return { status: 201, body: serializeRun(run) };
  },
});
