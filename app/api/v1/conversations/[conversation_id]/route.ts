import { defineRoute } from "@/lib/api/handler";
import * as v from "@/lib/api/validate";
import { requireConnection } from "@/lib/services/connections";
import {
  deleteConversation,
  requireConversation,
  serializeConversation,
  updateConversation,
} from "@/lib/services/conversations";

export const runtime = "nodejs";

type Params = { conversation_id: string };

const UPDATE = v.object({
  title: v.optional(v.string({ max: 200 })),
  connection_id: v.optional(v.string({ min: 1 })),
});

export const GET = defineRoute<Params>({
  scopes: ["conversations:read"],
  rateLimit: "read",
  handler: async ({ principal, params }) => ({
    body: serializeConversation(
      await requireConversation(principal.tenantId, params.conversation_id)
    ),
  }),
});

export const PATCH = defineRoute<Params>({
  scopes: ["conversations:write"],
  rateLimit: "write",
  handler: async ({ principal, params, body }) => {
    const input = v.validate(body, UPDATE);
    if (input.connection_id) {
      await requireConnection(principal.tenantId, input.connection_id);
    }
    const doc = await updateConversation(principal.tenantId, params.conversation_id, {
      title: input.title,
      connectionId: input.connection_id,
    });
    return { body: serializeConversation(doc) };
  },
});

export const DELETE = defineRoute<Params>({
  scopes: ["conversations:write"],
  rateLimit: "write",
  handler: async ({ principal, params }) => {
    await deleteConversation(principal.tenantId, params.conversation_id);
    return { status: 204 };
  },
});
