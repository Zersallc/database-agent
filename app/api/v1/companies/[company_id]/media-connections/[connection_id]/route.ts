import { defineRoute } from "@/lib/api/handler";
import { notFound } from "@/lib/api/errors";
import { requireDeveloperRole } from "@/lib/api/require-developer";
import * as v from "@/lib/api/validate";
import { prisma } from "@/lib/db";
import {
  deleteMediaConnection,
  findMediaConnection,
  requireMediaConnection,
  serializeMediaConnection,
  updateMediaConnection,
} from "@/lib/services/connections";
import { recordAuditEvent } from "@/lib/services/audit";

export const runtime = "nodejs";

type Params = { company_id: string; connection_id: string };

const UPDATE = v.object({
  name: v.optional(v.string({ min: 1, max: 120 })),
  description: v.optional(v.string({ max: 2000 })),
  library_ref: v.optional(v.string({ max: 500 })),
  enabled: v.optional(v.boolean()),
});

async function requireCompany(companyId: string) {
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) throw notFound("company", companyId);
}

export const GET = defineRoute<Params>({
  scopes: ["connections:read"],
  rateLimit: "read",
  handler: async ({ principal, params }) => {
    await requireDeveloperRole(principal);
    await requireCompany(params.company_id);
    const doc = await requireMediaConnection(params.company_id, params.connection_id);
    return { body: serializeMediaConnection(doc) };
  },
});

/** Enable/disable is not a separate action: it is `enabled` in this same body, like every other field. */
export const PATCH = defineRoute<Params>({
  scopes: ["connections:write"],
  rateLimit: "write",
  handler: async ({ principal, params, body }) => {
    await requireDeveloperRole(principal);
    await requireCompany(params.company_id);
    const input = v.validate(body, UPDATE);
    const doc = await updateMediaConnection(params.company_id, params.connection_id, input);

    await recordAuditEvent({
      actor: { id: principal.userId },
      action: "media_connection.updated",
      targetType: "media_connection",
      targetId: doc.id,
      companyId: params.company_id,
      metadata: { name: doc.name, enabled: doc.enabled ?? true, library_ref: doc.media.library_ref },
    });

    return { body: serializeMediaConnection(doc) };
  },
});

/**
 * Deleting an absent connection returns 204 rather than 404, matching
 * /v1/connections/{connection_id} — delete is idempotent by nature. The
 * lookup here is only to get a name for the audit entry before it is gone;
 * it does not gate the delete itself.
 */
export const DELETE = defineRoute<Params>({
  scopes: ["connections:write"],
  rateLimit: "write",
  handler: async ({ principal, params }) => {
    await requireDeveloperRole(principal);
    await requireCompany(params.company_id);

    const existing = await findMediaConnection(params.company_id, params.connection_id);
    await deleteMediaConnection(params.company_id, params.connection_id);

    if (existing) {
      await recordAuditEvent({
        actor: { id: principal.userId },
        action: "media_connection.deleted",
        targetType: "media_connection",
        targetId: params.connection_id,
        companyId: params.company_id,
        metadata: { name: existing.name },
      });
    }

    return { status: 204 };
  },
});
