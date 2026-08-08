import { defineRoute } from "@/lib/api/handler";
import { readListParams } from "@/lib/api/pagination";
import * as v from "@/lib/api/validate";
import {
  appendMessage,
  listMessages,
  requireConversation,
  serializeMessage,
} from "@/lib/services/conversations";

export const runtime = "nodejs";

type Params = { conversation_id: string };

const ATTACHMENT = v.object({
  file_id: v.string({ min: 1 }),
  name: v.string({ min: 1, max: 255 }),
  mime_type: v.string({ min: 1, max: 255 }),
  size_bytes: v.optional(v.integer({ min: 0 })),
});

const CREATE = v.object({
  role: v.oneOf(["user", "assistant"] as const),
  content: v.string({ max: 1000000, trim: false }),
  attachments: v.withDefault(v.array(ATTACHMENT, { max: 10 }), []),
});

export const GET = defineRoute<Params>({
  scopes: ["conversations:read"],
  rateLimit: "read",
  handler: async ({ principal, params, url }) => {
    await requireConversation(principal.tenantId, params.conversation_id);
    // Oldest first: a transcript reads top to bottom, unlike a list of
    // conversations where the newest is what you want.
    const listParams = readListParams(url, { order: "asc" });
    const page = await listMessages(principal.tenantId, params.conversation_id, listParams);
    return {
      body: {
        data: page.data.map(serializeMessage),
        has_more: page.has_more,
        next_cursor: page.next_cursor,
      },
    };
  },
});

/**
 * Records a message without invoking the agent.
 *
 * For importing a transcript or writing a note into the thread. Asking a
 * question goes through `POST /runs`, which appends both turns and produces the
 * trace.
 */
export const POST = defineRoute<Params>({
  scopes: ["conversations:write"],
  rateLimit: "write",
  idempotent: true,
  handler: async ({ principal, params, body }) => {
    const input = v.validate(body, CREATE);
    const conversation = await requireConversation(principal.tenantId, params.conversation_id);

    const message = await appendMessage(principal.tenantId, conversation, {
      role: input.role,
      content: input.content,
      attachments: input.attachments.map((attachment) => ({
        file_id: attachment.file_id,
        name: attachment.name,
        mime_type: attachment.mime_type,
        size_bytes: attachment.size_bytes ?? null,
      })),
    });

    return { status: 201, body: serializeMessage(message) };
  },
});
