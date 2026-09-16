import { defineRoute } from "@/lib/api/handler";
import { requireDeveloperRole } from "@/lib/api/require-developer";
import * as v from "@/lib/api/validate";
import {
  AI_FEEDBACK_CATEGORIES,
  AI_FEEDBACK_PRIORITIES,
  AI_FEEDBACK_STATUSES,
  fetchLiveQueryRows,
  requireAiFeedback,
  serializeAiFeedbackFull,
  updateAiFeedbackTriage,
} from "@/lib/services/ai-feedback";

export const runtime = "nodejs";

type Params = { feedback_id: string };

const UPDATE = v.object({
  status: v.optional(v.oneOf(AI_FEEDBACK_STATUSES)),
  priority: v.optional(v.oneOf(AI_FEEDBACK_PRIORITIES)),
  category: v.optional(v.oneOf(AI_FEEDBACK_CATEGORIES)),
  assigned_to_user_id: v.optional(v.string({ min: 1 })),
  /** Explicit clear sentinel — mirrors `remove_logo: true` on PATCH /companies/{id}. */
  unassign: v.optional(v.boolean()),
  resolution_summary: v.optional(v.string({ max: 2000 })),
  note: v.optional(v.string({ min: 1, max: 4000 })),
  linked_issue_url: v.optional(v.string({ min: 1, max: 2000, format: "url" })),
  unlink_issue: v.optional(v.boolean()),
  duplicate_of: v.optional(v.string({ min: 1 })),
  unmark_duplicate: v.optional(v.boolean()),
  add_related_report_id: v.optional(v.string({ min: 1 })),
  remove_related_report_id: v.optional(v.string({ min: 1 })),
});

export const GET = defineRoute<Params>({
  scopes: ["ai_feedback:read"],
  rateLimit: "read",
  handler: async ({ principal, params }) => {
    await requireDeveloperRole(principal);
    const feedback = await requireAiFeedback(params.feedback_id);
    // Actual result rows are never stored in the cross-tenant partition —
    // fetched live here, tenant-scoped, only after the role check passes.
    const queriesWithRows = await fetchLiveQueryRows(feedback);
    return { body: { ...serializeAiFeedbackFull(feedback), queries_with_rows: queriesWithRows } };
  },
});

export const PATCH = defineRoute<Params>({
  scopes: ["ai_feedback:write"],
  rateLimit: "write",
  handler: async ({ principal, params, body }) => {
    await requireDeveloperRole(principal);
    const input = v.validate(body, UPDATE);
    const feedback = await updateAiFeedbackTriage(principal.userId, params.feedback_id, input);
    return { body: serializeAiFeedbackFull(feedback) };
  },
});
