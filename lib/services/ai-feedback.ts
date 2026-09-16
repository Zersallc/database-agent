/**
 * AI Feedback — user-submitted reports about a specific AI response,
 * triaged by Developers across every company.
 *
 * Every existing collection in `DocumentStore` is scoped to one tenant, but
 * this resource is deliberately cross-tenant: a model/prompt/SQL-generation
 * bug is an engineering concern that cuts across companies, not a
 * per-company resource. Rather than changing the store interface, every
 * `AiFeedbackDoc` is stored under one fixed pseudo-tenant partition — the
 * same trick `SYSTEM_PARTITION` (lib/api/auth.ts) already uses for the
 * cross-tenant `api_keys` hash lookup. Kept as its own constant rather than
 * reusing `SYSTEM_PARTITION` because that partition is documented as opaque
 * lookup records "never addressable by a caller" — a different sensitivity
 * class than human-authored report content Developers actively browse.
 *
 * The reporting tenant's real `tenant_id` is still recorded on every
 * document (derived from the caller's Principal, never trusted from the
 * request body) — that is what keeps a live query-row fetch tenant-scoped,
 * and what a per-tenant filter in the list endpoint matches against.
 */

import { prisma } from "@/lib/db";
import { ApiError, notFound } from "@/lib/api/errors";
import { newId } from "@/lib/api/ids";
import { buildPage, paginateInMemory, type ListParams, type Page } from "@/lib/api/pagination";
import { stores } from "@/lib/providers";
import type { Where } from "@/lib/providers/types";
import { diffFields } from "./audit";
import type { MessageDoc } from "./conversations";
import { findQuery, type QueryDoc } from "./queries";
import { requireRun, type RunDoc } from "./runs";

/** Partition holding every company's AI Feedback. Never addressable by a caller. */
export const AI_FEEDBACK_PARTITION = "_ai_feedback";

export const AI_FEEDBACK_STATUSES = ["open", "in_progress", "resolved", "wont_fix", "duplicate"] as const;
export type AiFeedbackStatus = (typeof AI_FEEDBACK_STATUSES)[number];

export const AI_FEEDBACK_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type AiFeedbackPriority = (typeof AI_FEEDBACK_PRIORITIES)[number];

export const AI_FEEDBACK_CATEGORIES = [
  "incorrect_data",
  "wrong_sql",
  "slow_performance",
  "error_or_crash",
  "unclear_response",
  "other",
] as const;
export type AiFeedbackCategory = (typeof AI_FEEDBACK_CATEGORIES)[number];

export type AiFeedbackActor = { user_id: string; email: string | null };

export type AiFeedbackHistoryEntry = {
  id: string;
  at: string;
  actor: AiFeedbackActor;
  type:
    | "created"
    | "status_changed"
    | "priority_changed"
    | "category_changed"
    | "assigned"
    | "unassigned"
    | "note_added"
    | "resolved"
    | "reopened"
    | "issue_linked"
    | "duplicate_linked"
    | "related_linked";
  changes?: Record<string, { from: unknown; to: unknown }>;
  note?: string;
};

export type AiFeedbackDoc = {
  id: string;
  object: "ai_feedback";

  // Reporter-submitted
  description: string;
  category: AiFeedbackCategory | null;
  additional_context: string | null;

  // Provenance — server-derived, never trusted from the client
  tenant_id: string;
  tenant_name: string | null;
  reported_by: AiFeedbackActor;
  conversation_id: string;
  run_id: string;
  response_message_id: string | null;
  request_message_id: string | null;

  // Debugging snapshot, captured once at creation time
  snapshot: {
    request_content: string | null;
    response_content: string | null;
    response_thinking: string | null;
    model: string | null;
    usage: { input_tokens: number; output_tokens: number } | null;
    duration_ms: number | null;
    run_status: RunDoc["status"];
    run_error: { code: string; message: string } | null;
    steps: RunDoc["steps"];
    queries: {
      query_id: string;
      sql: string;
      status: "succeeded" | "failed";
      row_count: number;
      truncated: boolean;
      duration_ms: number;
      error: { code: string; message: string } | null;
      // Deliberately no `rows` here — see fetchLiveQueryRows below.
    }[];
    attachments: { file_id: string; name: string; mime_type: string; size_bytes: number | null }[];
  };
  snapshot_taken_at: string;

  // Triage state — Developer-only, via PATCH
  status: AiFeedbackStatus;
  priority: AiFeedbackPriority | null;
  assigned_to: AiFeedbackActor | null;
  /** Denormalized copy of assigned_to.user_id for exact-match filtering — the
   *  document store only supports top-level JSON path equality (see
   *  lib/providers/postgres.ts), not a nested one. */
  assigned_to_user_id: string | null;
  resolution: { summary: string; resolved_at: string; resolved_by: AiFeedbackActor } | null;

  // Reserved for Phase 2 — present from day one so the shape never needs a
  // breaking migration; unused by this phase's code.
  linked_issue_url: string | null;
  duplicate_of: string | null;
  related_report_ids: string[];

  // Audit trail — inline, not the shared Prisma AuditEvent table. That table
  // is rendered to any Admin filtered only by companyId with no targetType
  // filter (see AuditLogSection.tsx / app/api/audit-events); writing
  // triage notes there under the reporting tenant's companyId would leak
  // internal AI-quality discussion into that customer's own activity feed.
  history: AiFeedbackHistoryEntry[];

  created_at: string;
  updated_at: string;
};

export function serializeAiFeedbackSummary(doc: AiFeedbackDoc) {
  return {
    id: doc.id,
    object: doc.object,
    status: doc.status,
    priority: doc.priority,
    category: doc.category,
    description: doc.description,
    tenant_id: doc.tenant_id,
    tenant_name: doc.tenant_name,
    reported_by: doc.reported_by,
    assigned_to: doc.assigned_to,
    created_at: doc.created_at,
    updated_at: doc.updated_at,
  };
}

export function serializeAiFeedbackFull(doc: AiFeedbackDoc) {
  return doc;
}

async function lookupActor(userId: string): Promise<AiFeedbackActor> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  return { user_id: userId, email: user?.email ?? null };
}

async function lookupTenantName(tenantId: string): Promise<string | null> {
  const company = await prisma.company.findUnique({ where: { id: tenantId }, select: { name: true } });
  return company?.name ?? null;
}

export type CreateAiFeedbackInput = {
  run_id: string;
  description: string;
  category?: AiFeedbackCategory;
  additional_context?: string;
};

/**
 * Pure transform from a tenant-scoped run (plus the messages/queries it
 * produced) to the immutable debugging snapshot. Deliberately has no `rows`
 * field on any query entry — the single highest-risk field this feature
 * could leak — so this is also the shape the regression test in
 * tests/ai-feedback.test.ts guards directly.
 */
export function buildAiFeedbackSnapshot(
  run: RunDoc,
  requestMessage: MessageDoc | null,
  queries: QueryDoc[]
): AiFeedbackDoc["snapshot"] {
  return {
    request_content: requestMessage?.content ?? null,
    response_content: run.content,
    response_thinking: run.thinking,
    model: run.model,
    usage: run.usage,
    duration_ms: run.completed_at
      ? new Date(run.completed_at).getTime() - new Date(run.created_at).getTime()
      : null,
    run_status: run.status,
    run_error: run.error,
    steps: run.steps,
    queries: queries.map((q) => ({
      query_id: q.id,
      sql: q.sql,
      status: q.status,
      row_count: q.row_count,
      truncated: q.truncated,
      duration_ms: q.duration_ms,
      error: q.error,
    })),
    attachments: requestMessage?.attachments ?? [],
  };
}

/**
 * Everything beyond `run_id`/`description`/`category`/`additional_context`
 * is re-derived here from the tenant-scoped `RunDoc` — nothing about the
 * request/response/SQL is ever trusted from the client, which is the
 * concrete mitigation against a fabricated report.
 */
export async function createAiFeedback(
  tenantId: string,
  userId: string,
  input: CreateAiFeedbackInput
): Promise<AiFeedbackDoc> {
  const run = await requireRun(tenantId, input.run_id);
  const { documents } = stores();

  const [requestMessage, tenantName, reportedBy] = await Promise.all([
    run.request_message_id
      ? documents.get<MessageDoc>("messages", tenantId, run.request_message_id)
      : Promise.resolve(null),
    lookupTenantName(tenantId),
    lookupActor(userId),
  ]);

  const queryIds = [...new Set(run.steps.map((step) => step.query_id).filter((id): id is string => id !== null))];
  const queries = (await Promise.all(queryIds.map((queryId) => findQuery(tenantId, queryId)))).filter(
    (q): q is QueryDoc => q !== null
  );

  const now = new Date().toISOString();
  const doc: AiFeedbackDoc = {
    id: newId("feedback"),
    object: "ai_feedback",

    description: input.description,
    category: input.category ?? null,
    additional_context: input.additional_context ?? null,

    tenant_id: tenantId,
    tenant_name: tenantName,
    reported_by: reportedBy,
    conversation_id: run.conversation_id,
    run_id: run.id,
    response_message_id: run.response_message_id,
    request_message_id: run.request_message_id,

    snapshot: buildAiFeedbackSnapshot(run, requestMessage, queries),
    snapshot_taken_at: now,

    status: "open",
    priority: null,
    assigned_to: null,
    assigned_to_user_id: null,
    resolution: null,

    linked_issue_url: null,
    duplicate_of: null,
    related_report_ids: [],

    history: [{ id: crypto.randomUUID(), at: now, actor: reportedBy, type: "created" }],

    created_at: now,
    updated_at: now,
  };

  await documents.put("ai_feedback", AI_FEEDBACK_PARTITION, doc);
  return doc;
}

export async function findAiFeedback(feedbackId: string): Promise<AiFeedbackDoc | null> {
  return stores().documents.get<AiFeedbackDoc>("ai_feedback", AI_FEEDBACK_PARTITION, feedbackId);
}

export async function requireAiFeedback(feedbackId: string): Promise<AiFeedbackDoc> {
  const doc = await findAiFeedback(feedbackId);
  if (!doc) throw notFound("ai_feedback", feedbackId);
  return doc;
}

export type AiFeedbackFilters = {
  status?: string | null;
  priority?: string | null;
  category?: string | null;
  tenant_id?: string | null;
  assigned_to_user_id?: string | null;
  q?: string | null;
};

/**
 * The document store has no substring primitive — lib/providers/postgres.ts
 * does exact JSONB path-equality only, and MemoryDocumentStore matches it on
 * purpose. `q` is therefore a deliberate, bounded exception: fetch the
 * exact-filtered set capped at SEARCH_FETCH_CAP rows, substring-match in
 * memory, then paginate the result. A logged warning when the cap is hit is
 * the signal to build a real search index (see the AI Feedback plan's
 * Phase 3) rather than a silent truncation.
 */
const SEARCH_FETCH_CAP = 5000;

/** Pure substring match over the fields worth searching. No I/O — the part of `listAiFeedback` a fixture array can exercise directly. */
export function filterAiFeedbackBySearch(candidates: readonly AiFeedbackDoc[], q: string): AiFeedbackDoc[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [...candidates];
  return candidates.filter((doc) =>
    [doc.description, doc.additional_context, doc.tenant_name, doc.reported_by.email]
      .filter((value): value is string => typeof value === "string")
      .some((value) => value.toLowerCase().includes(needle))
  );
}

export async function listAiFeedback(params: ListParams, filters: AiFeedbackFilters): Promise<Page<AiFeedbackDoc>> {
  const where: Where[] = [];
  if (filters.status) where.push({ field: "status", equals: filters.status });
  if (filters.priority) where.push({ field: "priority", equals: filters.priority });
  if (filters.category) where.push({ field: "category", equals: filters.category });
  if (filters.tenant_id) where.push({ field: "tenant_id", equals: filters.tenant_id });
  if (filters.assigned_to_user_id) {
    where.push({ field: "assigned_to_user_id", equals: filters.assigned_to_user_id });
  }

  const q = filters.q?.trim().toLowerCase();
  const { documents } = stores();

  if (!q) {
    const docs = await documents.list<AiFeedbackDoc>("ai_feedback", AI_FEEDBACK_PARTITION, {
      where,
      orderBy: "created_at",
      order: params.order,
      startAfter: params.cursor ? { sort: params.cursor.sort, id: params.cursor.id } : undefined,
      limit: params.limit + 1,
    });
    return buildPage(docs, params, (doc) => ({ sort: doc.created_at, id: doc.id }));
  }

  const candidates = await documents.list<AiFeedbackDoc>("ai_feedback", AI_FEEDBACK_PARTITION, {
    where,
    orderBy: "created_at",
    order: params.order,
    limit: SEARCH_FETCH_CAP + 1,
  });
  if (candidates.length > SEARCH_FETCH_CAP) {
    console.warn(
      `[ai-feedback] search fetch hit its ${SEARCH_FETCH_CAP}-row cap — results may be incomplete for this query.`
    );
  }
  const matched = filterAiFeedbackBySearch(candidates.slice(0, SEARCH_FETCH_CAP), q);
  return paginateInMemory(matched, params, (doc) => ({ sort: doc.created_at, id: doc.id }));
}

export type AiFeedbackLiveQuery = {
  query_id: string;
  columns: { name: string; data_type: string | null }[];
  rows: unknown[][];
};

/**
 * Actual result rows are never copied into the cross-tenant partition — the
 * highest-risk field group, since a query result is likely to carry a
 * customer's own data. Rows are fetched here, live and tenant-scoped (using
 * the feedback's own stored `tenant_id`), only at detail-view time and only
 * after the caller has already passed requireDeveloperRole().
 */
export async function fetchLiveQueryRows(feedback: AiFeedbackDoc): Promise<AiFeedbackLiveQuery[]> {
  const results = await Promise.all(
    feedback.snapshot.queries.map(async (q) => {
      const query = await findQuery(feedback.tenant_id, q.query_id);
      return query ? { query_id: q.query_id, columns: query.columns, rows: query.rows } : null;
    })
  );
  return results.filter((r): r is AiFeedbackLiveQuery => r !== null);
}

export type UpdateAiFeedbackInput = {
  status?: AiFeedbackStatus;
  priority?: AiFeedbackPriority;
  category?: AiFeedbackCategory;
  assigned_to_user_id?: string;
  unassign?: boolean;
  resolution_summary?: string;
  note?: string;
  linked_issue_url?: string;
  unlink_issue?: boolean;
  duplicate_of?: string;
  unmark_duplicate?: boolean;
  add_related_report_id?: string;
  remove_related_report_id?: string;
};

/**
 * Pure diff → history-entry logic for the scalar triage fields (status,
 * priority, category) — one entry per changed field, via `diffFields()`.
 * No I/O, so a fixture `AiFeedbackDoc` exercises this directly.
 */
export function scalarHistoryEntries(
  existing: AiFeedbackDoc,
  input: Pick<UpdateAiFeedbackInput, "status" | "priority" | "category">,
  actor: AiFeedbackActor,
  now: string
): AiFeedbackHistoryEntry[] {
  const scalarChanges = diffFields(existing, {
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.priority !== undefined ? { priority: input.priority } : {}),
    ...(input.category !== undefined ? { category: input.category } : {}),
  });
  return Object.entries(scalarChanges).map(([field, change]) => ({
    id: crypto.randomUUID(),
    at: now,
    actor,
    type: (field === "status"
      ? change.to === "resolved"
        ? "resolved"
        : change.from === "resolved"
          ? "reopened"
          : "status_changed"
      : field === "priority"
        ? "priority_changed"
        : "category_changed") as AiFeedbackHistoryEntry["type"],
    changes: { [field]: change },
  }));
}

export type AiFeedbackLinkFields = Pick<AiFeedbackDoc, "linked_issue_url" | "duplicate_of" | "related_report_ids">;

/**
 * Pure diff logic for the Phase 2 "linking" fields (issue URL, duplicate-of,
 * related reports). Each has an explicit clear/remove sentinel — like
 * assignment, "omitted" means "leave untouched," not "clear," so a plain
 * diffFields() pass over the raw input can't tell those apart. Referential
 * integrity (does duplicate_of / add_related_report_id point at a real
 * report? is it self-referential?) is checked in updateAiFeedbackTriage
 * before this runs; this function only computes the resulting fields and
 * history entries, so a fixture AiFeedbackDoc exercises it directly.
 */
export function linkHistoryEntries(
  existing: AiFeedbackDoc,
  input: Pick<
    UpdateAiFeedbackInput,
    "linked_issue_url" | "unlink_issue" | "duplicate_of" | "unmark_duplicate" | "add_related_report_id" | "remove_related_report_id"
  >,
  actor: AiFeedbackActor,
  now: string
): { history: AiFeedbackHistoryEntry[]; fields: AiFeedbackLinkFields } {
  const history: AiFeedbackHistoryEntry[] = [];

  let linkedIssueUrl = existing.linked_issue_url;
  if (input.unlink_issue && existing.linked_issue_url !== null) {
    history.push({
      id: crypto.randomUUID(),
      at: now,
      actor,
      type: "issue_linked",
      changes: { linked_issue_url: { from: existing.linked_issue_url, to: null } },
    });
    linkedIssueUrl = null;
  } else if (input.linked_issue_url !== undefined && input.linked_issue_url !== existing.linked_issue_url) {
    history.push({
      id: crypto.randomUUID(),
      at: now,
      actor,
      type: "issue_linked",
      changes: { linked_issue_url: { from: existing.linked_issue_url, to: input.linked_issue_url } },
    });
    linkedIssueUrl = input.linked_issue_url;
  }

  let duplicateOf = existing.duplicate_of;
  if (input.unmark_duplicate && existing.duplicate_of !== null) {
    history.push({
      id: crypto.randomUUID(),
      at: now,
      actor,
      type: "duplicate_linked",
      changes: { duplicate_of: { from: existing.duplicate_of, to: null } },
    });
    duplicateOf = null;
  } else if (input.duplicate_of !== undefined && input.duplicate_of !== existing.duplicate_of) {
    history.push({
      id: crypto.randomUUID(),
      at: now,
      actor,
      type: "duplicate_linked",
      changes: { duplicate_of: { from: existing.duplicate_of, to: input.duplicate_of } },
    });
    duplicateOf = input.duplicate_of;
  }

  let relatedReportIds = existing.related_report_ids;
  if (input.add_related_report_id !== undefined && !existing.related_report_ids.includes(input.add_related_report_id)) {
    relatedReportIds = [...existing.related_report_ids, input.add_related_report_id];
    history.push({
      id: crypto.randomUUID(),
      at: now,
      actor,
      type: "related_linked",
      changes: { related_report_ids: { from: existing.related_report_ids, to: relatedReportIds } },
    });
  } else if (
    input.remove_related_report_id !== undefined &&
    existing.related_report_ids.includes(input.remove_related_report_id)
  ) {
    relatedReportIds = existing.related_report_ids.filter((id) => id !== input.remove_related_report_id);
    history.push({
      id: crypto.randomUUID(),
      at: now,
      actor,
      type: "related_linked",
      changes: { related_report_ids: { from: existing.related_report_ids, to: relatedReportIds } },
    });
  }

  return {
    history,
    fields: { linked_issue_url: linkedIssueUrl, duplicate_of: duplicateOf, related_report_ids: relatedReportIds },
  };
}

export async function updateAiFeedbackTriage(
  actorUserId: string,
  feedbackId: string,
  input: UpdateAiFeedbackInput
): Promise<AiFeedbackDoc> {
  const existing = await requireAiFeedback(feedbackId);

  if (input.assigned_to_user_id !== undefined && input.unassign) {
    throw new ApiError("invalid_request", "'assigned_to_user_id' and 'unassign' cannot both be set.");
  }
  if (input.status === "resolved" && !input.resolution_summary) {
    throw new ApiError(
      "unprocessable",
      "Setting status to 'resolved' requires 'resolution_summary' in the same request."
    );
  }
  if (input.linked_issue_url !== undefined && input.unlink_issue) {
    throw new ApiError("invalid_request", "'linked_issue_url' and 'unlink_issue' cannot both be set.");
  }
  if (input.duplicate_of !== undefined && input.unmark_duplicate) {
    throw new ApiError("invalid_request", "'duplicate_of' and 'unmark_duplicate' cannot both be set.");
  }
  if (input.duplicate_of !== undefined && input.duplicate_of === feedbackId) {
    throw new ApiError("invalid_request", "A report cannot be marked as a duplicate of itself.");
  }
  if (input.add_related_report_id !== undefined && input.add_related_report_id === feedbackId) {
    throw new ApiError("invalid_request", "A report cannot be related to itself.");
  }
  // Referential integrity — mirrors createAiFeedback's requireRun(): a
  // report can only be linked to another report that actually exists.
  if (input.duplicate_of !== undefined) {
    await requireAiFeedback(input.duplicate_of);
  }
  if (input.add_related_report_id !== undefined) {
    await requireAiFeedback(input.add_related_report_id);
  }

  const actor = await lookupActor(actorUserId);
  const now = new Date().toISOString();
  const history: AiFeedbackHistoryEntry[] = scalarHistoryEntries(existing, input, actor, now);
  const links = linkHistoryEntries(existing, input, actor, now);
  history.push(...links.history);

  let assignedTo = existing.assigned_to;
  let assignedToUserId = existing.assigned_to_user_id;
  if (input.unassign && existing.assigned_to !== null) {
    history.push({
      id: crypto.randomUUID(),
      at: now,
      actor,
      type: "unassigned",
      changes: { assigned_to: { from: existing.assigned_to, to: null } },
    });
    assignedTo = null;
    assignedToUserId = null;
  } else if (input.assigned_to_user_id !== undefined && input.assigned_to_user_id !== existing.assigned_to?.user_id) {
    const assignee = await lookupActor(input.assigned_to_user_id);
    history.push({
      id: crypto.randomUUID(),
      at: now,
      actor,
      type: "assigned",
      changes: { assigned_to: { from: existing.assigned_to, to: assignee } },
    });
    assignedTo = assignee;
    assignedToUserId = assignee.user_id;
  }

  let resolution = existing.resolution;
  if (input.resolution_summary !== undefined) {
    resolution = { summary: input.resolution_summary, resolved_at: now, resolved_by: actor };
  }

  if (input.note !== undefined) {
    history.push({ id: crypto.randomUUID(), at: now, actor, type: "note_added", note: input.note });
  }

  if (history.length === 0) return existing;

  const changes: Partial<AiFeedbackDoc> = {
    updated_at: now,
    history: [...existing.history, ...history],
    assigned_to: assignedTo,
    assigned_to_user_id: assignedToUserId,
    resolution,
    ...links.fields,
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.priority !== undefined ? { priority: input.priority } : {}),
    ...(input.category !== undefined ? { category: input.category } : {}),
  };

  const updated = await stores().documents.patch<AiFeedbackDoc>(
    "ai_feedback",
    AI_FEEDBACK_PARTITION,
    feedbackId,
    changes
  );
  return updated ?? existing;
}

export type AiFeedbackAssignee = { user_id: string; email: string; name: string | null };

/** Backs the assignee picker — every Developer, so triage never depends on a free-text/typo-prone field. */
export async function listAiFeedbackAssignees(): Promise<AiFeedbackAssignee[]> {
  const developers = await prisma.user.findMany({
    where: { role: "Developer" },
    select: { id: true, email: true, name: true },
    orderBy: { email: "asc" },
  });
  return developers.map((d) => ({ user_id: d.id, email: d.email, name: d.name }));
}
