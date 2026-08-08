/**
 * Tenants and bootstrapping.
 *
 * Every resource in this API hangs off a tenant, which means a brand-new
 * deployment has a chicken-and-egg problem: you need a tenant to make a request
 * and a request to make a tenant. This resolves it by seeding one local
 * workspace on first use — an admin user, a playbook, and the sample
 * connection — so a fresh checkout is immediately usable.
 *
 * Seeding is idempotent and only ever touches the local workspace. Real tenants
 * are created by the provisioning path, not here.
 */

import { ROLE_SCOPES, type Principal } from "@/lib/api/auth";
import { newId } from "@/lib/api/ids";
import { stores } from "@/lib/providers";

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

/** Seeds the local workspace once. Concurrent callers converge on the same state. */
export async function ensureLocalTenant(): Promise<TenantDoc> {
  const { documents } = stores();
  const existing = await documents.get<TenantDoc>("tenants", LOCAL_TENANT_ID, LOCAL_TENANT_ID);
  if (existing?.seeded) return existing;

  const now = new Date().toISOString();
  const tenant: TenantDoc = {
    id: LOCAL_TENANT_ID,
    object: "tenant",
    name: process.env.WORKSPACE_NAME ?? "Local workspace",
    seeded: true,
    created_at: now,
  };

  await documents.put("tenants", LOCAL_TENANT_ID, tenant);

  await documents.put("users", LOCAL_TENANT_ID, {
    id: localUserId(),
    object: "user",
    name: process.env.BOOTSTRAP_USER_NAME ?? "Local admin",
    email: process.env.BOOTSTRAP_USER_EMAIL ?? "admin@localhost",
    company: process.env.WORKSPACE_NAME ?? "Company",
    title: "Admin",
    role: "admin",
    status: "active",
    created_at: now,
  });

  await documents.put("playbooks", LOCAL_TENANT_ID, {
    id: "playbook",
    object: "playbook",
    system_prompt: DEFAULT_SYSTEM_PROMPT,
    updated_at: now,
  });

  for (const skill of SEED_SKILLS) {
    const id = newId("skill");
    await documents.put("skills", LOCAL_TENANT_ID, {
      id,
      object: "skill",
      ...skill,
      created_at: now,
      updated_at: now,
    });
  }

  // The sample connection means a fresh workspace can answer a question before
  // anyone has credentials for a real database.
  await documents.put("connections", LOCAL_TENANT_ID, {
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
