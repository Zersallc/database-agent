import { defineRoute } from "@/lib/api/handler";
import { requireDeveloperRole } from "@/lib/api/require-developer";
import { listAiFeedbackAssignees } from "@/lib/services/ai-feedback";

export const runtime = "nodejs";

/** Backs the assignee picker in the triage panel — every Developer account. */
export const GET = defineRoute({
  scopes: ["ai_feedback:read"],
  rateLimit: "read",
  handler: async ({ principal }) => {
    await requireDeveloperRole(principal);
    return { body: { data: await listAiFeedbackAssignees() } };
  },
});
