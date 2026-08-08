/**
 * Tenant membership.
 *
 * `role` is a permission level and `title` is a job description. They are
 * deliberately separate: a CEO who should not be able to drop a connection is a
 * viewer with the title "CEO", and conflating the two is how a org chart ends up
 * deciding database access.
 */

import { ApiError, notFound } from "@/lib/api/errors";
import { newId } from "@/lib/api/ids";
import { buildPage, type ListParams, type Page } from "@/lib/api/pagination";
import type { Role } from "@/lib/api/auth";
import { stores } from "@/lib/providers";

export type UserDoc = {
  id: string;
  object: "user";
  name: string;
  email: string;
  company: string;
  title: string;
  role: Role;
  status: "active" | "pending";
  created_at: string;
};

export function serializeUser(doc: UserDoc) {
  return {
    id: doc.id,
    object: doc.object,
    name: doc.name,
    email: doc.email,
    company: doc.company,
    title: doc.title,
    role: doc.role,
    status: doc.status,
    created_at: doc.created_at,
  };
}

export async function listUsers(tenantId: string, params: ListParams): Promise<Page<UserDoc>> {
  const docs = await stores().documents.list<UserDoc>("users", tenantId, {
    orderBy: "created_at",
    order: params.order,
    startAfter: params.cursor ? { sort: params.cursor.sort, id: params.cursor.id } : undefined,
    limit: params.limit + 1,
  });
  return buildPage(docs, params, (doc) => ({ sort: doc.created_at, id: doc.id }));
}

export async function requireUser(tenantId: string, userId: string): Promise<UserDoc> {
  const doc = await stores().documents.get<UserDoc>("users", tenantId, userId);
  if (!doc) throw notFound("user", userId);
  return doc;
}

export async function createUser(
  tenantId: string,
  input: { name: string; email: string; company?: string; title?: string; role: Role }
): Promise<UserDoc> {
  const existing = await stores().documents.list<UserDoc>("users", tenantId, {
    where: [{ field: "email", equals: input.email.toLowerCase() }],
    orderBy: "created_at",
    order: "asc",
    limit: 1,
  });
  if (existing.length > 0) {
    throw new ApiError(
      "resource_conflict",
      `${input.email} is already a member of this workspace.`,
      { details: { user_id: existing[0].id } }
    );
  }

  const doc: UserDoc = {
    id: newId("user"),
    object: "user",
    name: input.name,
    email: input.email.toLowerCase(),
    company: input.company ?? "",
    title: input.title ?? "",
    role: input.role,
    // Invited, not yet signed in. Becomes active on first authentication.
    status: "pending",
    created_at: new Date().toISOString(),
  };
  return stores().documents.put("users", tenantId, doc);
}

export async function updateUser(
  tenantId: string,
  userId: string,
  input: { name?: string; company?: string; title?: string; role?: Role; status?: "active" | "pending" }
): Promise<UserDoc> {
  const existing = await requireUser(tenantId, userId);

  // Demoting the last admin locks everyone out of user management, with no way
  // back in short of operator intervention.
  if (input.role && input.role !== "admin" && existing.role === "admin") {
    await assertNotLastAdmin(tenantId, userId);
  }

  const changes: Partial<UserDoc> = {};
  if (input.name !== undefined) changes.name = input.name;
  if (input.company !== undefined) changes.company = input.company;
  if (input.title !== undefined) changes.title = input.title;
  if (input.role !== undefined) changes.role = input.role;
  if (input.status !== undefined) changes.status = input.status;

  const updated = await stores().documents.patch<UserDoc>("users", tenantId, userId, changes);
  return updated ?? existing;
}

export async function deleteUser(tenantId: string, userId: string): Promise<void> {
  const existing = await stores().documents.get<UserDoc>("users", tenantId, userId);
  if (!existing) return;
  if (existing.role === "admin") await assertNotLastAdmin(tenantId, userId);
  await stores().documents.delete("users", tenantId, userId);
}

async function assertNotLastAdmin(tenantId: string, userId: string): Promise<void> {
  const admins = await stores().documents.list<UserDoc>("users", tenantId, {
    where: [{ field: "role", equals: "admin" }],
    orderBy: "created_at",
    order: "asc",
  });
  const others = admins.filter((admin) => admin.id !== userId);
  if (others.length === 0) {
    throw new ApiError(
      "last_admin_required",
      "This is the only admin in the workspace. Promote another member to admin first — a workspace with no admin cannot be administered back into shape."
    );
  }
}
