import { defineRoute } from "@/lib/api/handler";
import { readListParams } from "@/lib/api/pagination";
import { requireDeveloperRole } from "@/lib/api/require-developer";
import * as v from "@/lib/api/validate";
import {
  AI_FEEDBACK_CATEGORIES,
  createAiFeedback,
  listAiFeedback,
  serializeAiFeedbackSummary,
} from "@/lib/services/ai-feedback";

export const runtime = "nodejs";

const CREATE = v.object({
  run_id: v.string({ min: 1, max: 80 }),
  description: v.string({ min: 1, max: 4000 }),
  category: v.optional(v.oneOf(AI_FEEDBACK_CATEGORIES)),
  additional_context: v.optional(v.string({ max: 4000 })),
});

/**
 * Developer-only, cross-tenant list — every company's reports in one place.
 * `requireDeveloperRole` runs before any document lookup, the same
 * don't-leak-existence discipline `notFound()` already applies to normal
 * tenant scoping.
 */
export const GET = defineRoute({
  scopes: ["ai_feedback:read"],
  rateLimit: "read",
  handler: async ({ principal, url }) => {
    await requireDeveloperRole(principal);
    const params = readListParams(url, { order: "desc" });
    const page = await listAiFeedback(params, {
      status: url.searchParams.get("status"),
      priority: url.searchParams.get("priority"),
      category: url.searchParams.get("category"),
      tenant_id: url.searchParams.get("tenant_id"),
      assigned_to_user_id: url.searchParams.get("assigned_to_user_id"),
      q: url.searchParams.get("q"),
    });
    return {
      body: {
        data: page.data.map(serializeAiFeedbackSummary),
        has_more: page.has_more,
        next_cursor: page.next_cursor,
      },
    };
  },
});

/**
 * Any workspace principal may submit feedback about their own tenant's run —
 * everything else (request/response text, model, SQL, result metadata) is
 * re-derived server-side from the run, not trusted from the client.
 */
export const POST = defineRoute({
  scopes: ["ai_feedback:write"],
  rateLimit: "write",
  idempotent: true,
  handler: async ({ principal, body }) => {
    const input = v.validate(body, CREATE);
    const doc = await createAiFeedback(principal.tenantId, principal.userId, input);
    return {
      status: 201,
      body: { id: doc.id, status: doc.status, created_at: doc.created_at },
      headers: { Location: `/api/v1/ai-feedback/${doc.id}` },
    };
  },
});
