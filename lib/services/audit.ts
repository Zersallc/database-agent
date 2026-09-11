/**
 * Traceability log for admin actions — companies, users, connections, data
 * access. Append-only: nothing here is ever updated or deleted by the app.
 *
 * Writing an event must never break the action it's recording, so failures
 * are swallowed (and reported) rather than thrown.
 */

import { prisma } from "@/lib/db";

export type AuditActor = { id: string; email?: string | null } | null | undefined;

export type AuditAction =
  | "company.created"
  | "company.updated"
  | "company.deleted"
  | "user.created"
  | "user.updated"
  | "user.deleted"
  | "connection.created"
  | "connection.deleted"
  | "data_access.updated";

export async function recordAuditEvent(params: {
  actor: AuditActor;
  action: AuditAction;
  targetType: string;
  targetId?: string | null;
  companyId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  try {
    await prisma.auditEvent.create({
      data: {
        actorId: params.actor?.id ?? null,
        actorEmail: params.actor?.email ?? null,
        action: params.action,
        targetType: params.targetType,
        targetId: params.targetId ?? null,
        companyId: params.companyId ?? null,
        metadata: params.metadata as never,
      },
    });
  } catch (error) {
    console.error("[audit] failed to record event", params.action, error);
  }
}

export type AuditEventView = {
  id: string;
  actor_email: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  company_id: string | null;
  metadata: unknown;
  created_at: string;
};

export async function listAuditEvents(params: {
  companyId?: string;
  limit?: number;
}): Promise<AuditEventView[]> {
  const events = await prisma.auditEvent.findMany({
    where: params.companyId ? { companyId: params.companyId } : undefined,
    orderBy: { createdAt: "desc" },
    take: Math.min(params.limit ?? 50, 200),
  });

  return events.map((e) => ({
    id: e.id,
    actor_email: e.actorEmail,
    action: e.action,
    target_type: e.targetType,
    target_id: e.targetId,
    company_id: e.companyId,
    metadata: e.metadata,
    created_at: e.createdAt.toISOString(),
  }));
}

/** Shallow diff of two plain objects, keyed by field, `{ from, to }` per changed key. */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(after) as (keyof T)[]) {
    if (after[key] !== undefined && after[key] !== before[key]) {
      changes[key as string] = { from: before[key], to: after[key] };
    }
  }
  return changes;
}
