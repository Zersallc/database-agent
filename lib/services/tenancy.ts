/**
 * Tenants and bootstrapping.
 *
 * Every resource in this API hangs off a tenant. A signed-in browser resolves
 * to the user's real company (Prisma `Company.id`) — one workspace per
 * company, the same way LMS scopes its data — so connections, the playbook,
 * and conversations are shared within a company and never leak across one.
 *
 * A tenant has a chicken-and-egg problem: you need a tenant to make a request
 * and a request to make a tenant. This resolves it by seeding a workspace on
 * first use — an admin user, a playbook, and the sample connection — so a
 * brand-new company (or a fresh local checkout, via `LOCAL_TENANT_ID`) is
 * immediately usable. Seeding is idempotent per tenant.
 */

import { ROLE_SCOPES, type Principal, type Role } from "@/lib/api/auth";
import { newId } from "@/lib/api/ids";
import { prisma } from "@/lib/db";
import { stores } from "@/lib/providers";

/** Used only when a signed-in user has no company yet, and for open-access dev. */
export const LOCAL_TENANT_ID = "ten_local";

export const DEFAULT_SYSTEM_PROMPT = `You are a database analyst for this workspace.

Answer with the smallest thing that fully answers the question. Show the SQL you
ran. When a result is easier to read as a chart, render one. Say plainly when
the data cannot answer what was asked — do not guess.`;

const SEED_SKILLS = [
  {
    name: "Revenue definitions",
    description: "How revenue, MRR and churn are calculated here",
    enabled: true,
    content: `Revenue means recognized revenue, not bookings.

- MRR: sum of active subscription amounts, normalized to a month.
- Churn: subscriptions that moved to "cancelled" during the period, over
  subscriptions active at the start of it.
- Exclude internal accounts (customers.is_internal = true) from every revenue
  figure unless explicitly asked to include them.`,
  },
  {
    name: "SQL style guide",
    description: "Conventions every generated query should follow",
    enabled: true,
    content: `- Uppercase keywords, snake_case identifiers.
- Always qualify columns when more than one table is in play.
- Prefer CTEs over nested subqueries.
- Add an explicit LIMIT when the question does not imply a full scan.
- Never SELECT *; name the columns.`,
  },
  {
    name: "Schema notes",
    description: "Gotchas in the warehouse the schema does not convey",
    enabled: false,
    content: `- orders.amount is in cents, not dollars.
- customers.region uses ISO codes, but legacy rows before 2024 use free text.
- The events table is partitioned by day; always filter on event_date first.
- users.deleted_at is a soft delete — filter it out unless asked.`,
  },
];

export type TenantDoc = {
  id: string;
  object: "tenant";
  name: string;
  seeded: boolean;
  created_at: string;
};

/** Seeds a workspace once. Concurrent callers converge on the same state. */
export async function ensureTenant(tenantId: string, name: string): Promise<TenantDoc> {
  const { documents } = stores();
  const existing = await documents.get<TenantDoc>("tenants", tenantId, tenantId);
  if (existing?.seeded) return existing;

  const now = new Date().toISOString();
  const tenant: TenantDoc = {
    id: tenantId,
    object: "tenant",
    name,
    seeded: true,
    created_at: now,
  };

  await documents.put("tenants", tenantId, tenant);

  await documents.put("users", tenantId, {
    id: localUserId(),
    object: "user",
    name: process.env.BOOTSTRAP_USER_NAME ?? "Local admin",
    email: process.env.BOOTSTRAP_USER_EMAIL ?? "admin@localhost",
    company: name,
    title: "Admin",
    role: "admin",
    status: "active",
    created_at: now,
  });

  await documents.put("playbooks", tenantId, {
    id: "playbook",
    object: "playbook",
    system_prompt: DEFAULT_SYSTEM_PROMPT,
    updated_at: now,
  });

  for (const skill of SEED_SKILLS) {
    const id = newId("skill");
    await documents.put("skills", tenantId, {
      id,
      object: "skill",
      ...skill,
      created_at: now,
      updated_at: now,
    });
  }

  // The sample connection means a fresh workspace can answer a question before
  // anyone has credentials for a real database.
  await documents.put("connections", tenantId, {
    id: newId("connection"),
    object: "connection",
    name: "Sample dataset",
    engine: "demo",
    status: "connected",
    status_checked_at: now,
    status_detail: "Built-in sample data — not a real database.",
    allow_writes: false,
    max_rows: 1000,
    default_schema: null,
    credential_handle: null,
    created_at: now,
    updated_at: now,
  });

  return tenant;
}

/** The local/dev workspace — open access (no session) and users with no company. */
export async function ensureLocalTenant(): Promise<TenantDoc> {
  return ensureTenant(LOCAL_TENANT_ID, process.env.WORKSPACE_NAME ?? "Local workspace");
}

function localUserId(): string {
  // Deterministic so re-seeding cannot create a second admin.
  return "usr_local_admin";
}

/**
 * The principal used when a request arrives without credentials and open access
 * is enabled. Development only — `openAccessEnabled()` refuses to return true in
 * production, so this can never be reached from a deployed environment.
 */
export async function defaultPrincipal(): Promise<Principal> {
  await ensureLocalTenant();
  return {
    tenantId: LOCAL_TENANT_ID,
    userId: localUserId(),
    role: "admin",
    scopes: ROLE_SCOPES.admin,
    apiKeyId: null,
  };
}

/**
 * The principal used for a request carrying a valid NextAuth session (a
 * browser with a logged-in cookie) instead of an API key.
 *
 * The tenant is the user's real company — every user in the same company
 * shares one workspace (connections, playbook, conversations), and a
 * different company never sees it. A user with no company yet (not fully
 * provisioned) falls back to the local/dev workspace rather than failing.
 */
export async function sessionPrincipal(
  userId: string,
  dbRole: string,
  companyId: string | null
): Promise<Principal> {
  const tenantId = companyId ?? LOCAL_TENANT_ID;
  if (companyId) {
    const company = await prisma.company.findUnique({ where: { id: companyId } });
    await ensureTenant(tenantId, company?.name ?? "Workspace");
  } else {
    await ensureLocalTenant();
  }

  const role: Role = dbRole === "Admin" ? "admin" : "member";
  return {
    tenantId,
    userId,
    role,
    scopes: ROLE_SCOPES[role],
    apiKeyId: null,
  };
}
