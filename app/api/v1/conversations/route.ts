import { defineRoute } from "@/lib/api/handler";
import { readListParams } from "@/lib/api/pagination";
import * as v from "@/lib/api/validate";
import { requireConnection } from "@/lib/services/connections";
import {
  createConversation,
  listConversations,
  serializeConversation,
} from "@/lib/services/conversations";

export const runtime = "nodejs";

const CREATE = v.object({
  title: v.optional(v.string({ max: 200 })),
  connection_id: v.optional(v.string({ min: 1 })),
});

export const GET = defineRoute({
  scopes: ["conversations:read"],
  rateLimit: "read",
  handler: async ({ principal, url }) => {
    const page = await listConversations(principal.tenantId, readListParams(url));
    return {
      body: {
        data: page.data.map(serializeConversation),
        has_more: page.has_more,
        next_cursor: page.next_cursor,
      },
    };
  },
});

export const POST = defineRoute({
  scopes: ["conversations:write"],
  rateLimit: "write",
  idempotent: true,
  handler: async ({ principal, body }) => {
    const input = v.validate(body, CREATE);

    // Validate the connection now rather than at the first question: a
    // conversation pointing at a connection that does not exist fails later,
    // further from the mistake.
    if (input.connection_id) {
      await requireConnection(principal.tenantId, input.connection_id);
    }

    const doc = await createConversation(principal.tenantId, {
      title: input.title,
      connectionId: input.connection_id ?? null,
      userId: principal.userId,
    });

    return {
      status: 201,
      body: serializeConversation(doc),
      headers: { Location: `/api/v1/conversations/${doc.id}` },
    };
  },
});
