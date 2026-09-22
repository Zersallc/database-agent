import { defineRoute } from "@/lib/api/handler";
import { notFound } from "@/lib/api/errors";
import { requireDeveloperRole } from "@/lib/api/require-developer";
import * as v from "@/lib/api/validate";
import { prisma } from "@/lib/db";
import { createMediaConnection, listMediaConnections, serializeMediaConnection } from "@/lib/services/connections";
import { recordAuditEvent } from "@/lib/services/audit";

export const runtime = "nodejs";

type Params = { company_id: string };

const CREATE = v.object({
  name: v.string({ min: 1, max: 120 }),
  description: v.optional(v.string({ max: 2000 })),
  library_ref: v.optional(v.string({ max: 500 })),
  server_ref: v.optional(v.string({ max: 60 })),
  enabled: v.withDefault(v.boolean(), true),
});

async function requireCompany(companyId: string) {
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) throw notFound("company", companyId);
}

/**
 * Developer-only, like every media connection route — see
 * lib/api/require-developer.ts. `company_id` names the target workspace
 * explicitly, the same way app/api/companies/[id]/connections/route.ts
 * already does for database connections: a Developer manages OTHER
 * companies' connections, not just their own, so `principal.tenantId` (their
 * own company) would be the wrong scope here.
 *
 * Not paginated: `listMediaConnections` has none of its own (a workspace has
 * a handful, matching its own MEDIA_SCAN_LIMIT), so this returns everything
 * in one page rather than pretending to support cursors it would ignore.
 */
export const GET = defineRoute<Params>({
  scopes: ["connections:read"],
  rateLimit: "read",
  handler: async ({ principal, params }) => {
    await requireDeveloperRole(principal);
    await requireCompany(params.company_id);
    const list = await listMediaConnections(params.company_id);
    return { body: { data: list.map(serializeMediaConnection), has_more: false, next_cursor: null } };
  },
});

export const POST = defineRoute<Params>({
  scopes: ["connections:write"],
  rateLimit: "write",
  idempotent: true,
  handler: async ({ principal, params, body }) => {
    await requireDeveloperRole(principal);
    await requireCompany(params.company_id);
    const input = v.validate(body, CREATE);
    const doc = await createMediaConnection(params.company_id, input);

    await recordAuditEvent({
      actor: { id: principal.userId },
      action: "media_connection.created",
      targetType: "media_connection",
      targetId: doc.id,
      companyId: params.company_id,
      metadata: { name: doc.name, enabled: doc.enabled ?? true, library_ref: doc.media.library_ref },
    });

    return {
      status: 201,
      body: serializeMediaConnection(doc),
      headers: { Location: `/api/v1/companies/${params.company_id}/media-connections/${doc.id}` },
    };
  },
});
