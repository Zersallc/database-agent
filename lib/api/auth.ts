/**
 * Authentication and tenancy.
 *
 * Every request resolves to a Principal — a tenant, a user, a role, and a set
 * of scopes. Handlers never see a raw key, and services never take a tenant ID
 * from the request body: it comes from the credential, so a caller cannot ask
 * for another workspace's data by editing a payload.
 *
 * Keys are stored hashed. A leaked database dump does not yield working
 * credentials, and there is no endpoint anywhere that returns a key after
 * creation.
 */

import { ApiError } from "./errors";
import { stores } from "@/lib/providers";

export const SCOPES = [
  "connections:read",
  "connections:write",
  "models:read",
  "models:write",
  "queries:read",
  "queries:execute",
  "conversations:read",
  "conversations:write",
  "runs:read",
  "runs:write",
  "playbook:read",
  "playbook:write",
  "users:read",
  "users:write",
  "files:read",
  "files:write",
] as const;

export type Scope = (typeof SCOPES)[number];

export type Role = "admin" | "member" | "viewer";

const READ_SCOPES: Scope[] = [
  "connections:read",
  "models:read",
  "queries:read",
  "conversations:read",
  "runs:read",
  "playbook:read",
  "users:read",
  "files:read",
];

/**
 * What each role may do. A viewer can read the workspace and follow along, but
 * cannot run anything — an agent run executes SQL, so it is a write.
 */
export const ROLE_SCOPES: Record<Role, Scope[]> = {
  admin: [...SCOPES],
  member: [
    ...READ_SCOPES,
    "connections:write",
    // Not `models:write`. Choosing the model provider sets what every question
    // in the workspace costs and where its data goes — an admin decision, and
    // the one place a member's write access deliberately stops.
    "queries:execute",
    "conversations:write",
    "runs:write",
    "playbook:write",
    "files:write",
  ],
  viewer: READ_SCOPES,
};

export type Principal = {
  tenantId: string;
  userId: string;
  role: Role;
  scopes: Scope[];
  apiKeyId: string | null;
};

/** Stored key record. Lives under the system partition, keyed by hash. */
export type ApiKeyRecord = {
  id: string;
  tenant_id: string;
  user_id: string;
  role: Role;
  scopes?: Scope[];
  revoked?: boolean;
  name?: string;
  created_at: string;
  last_used_at?: string;
};

/** Partition holding cross-tenant lookup records. Never addressable by a caller. */
export const SYSTEM_PARTITION = "_system";

export async function hashApiKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return Buffer.from(digest).toString("hex");
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const [scheme, ...rest] = header.split(" ");
  if (scheme.toLowerCase() !== "bearer") return null;
  const token = rest.join(" ").trim();
  return token || null;
}

/**
 * Whether an unauthenticated request is allowed to act as the local workspace.
 *
 * On by default in development so the app runs with no setup, and forced off in
 * production regardless of configuration — an accidental `API_AUTH_MODE` in a
 * deployed environment must not open the workspace to the internet.
 */
export function openAccessEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return (process.env.API_AUTH_MODE ?? "open") !== "required";
}

export async function authenticate(request: Request): Promise<Principal> {
  const token = bearerToken(request);

  if (!token) {
    // The browser workspace authenticates with a NextAuth session cookie, not
    // a bearer token — check for one before falling back to open access /
    // rejecting outright, so a signed-in browser and an API-key client both
    // resolve to a real Principal through the same gate.
    const { auth } = await import("@/lib/auth");
    const session = await auth();
    if (session?.user?.id) {
      const { sessionPrincipal } = await import("@/lib/services/tenancy");
      return sessionPrincipal(session.user.id, session.user.role, session.user.companyId);
    }

    if (openAccessEnabled()) {
      const { defaultPrincipal } = await import("@/lib/services/tenancy");
      return defaultPrincipal();
    }
    throw new ApiError(
      "unauthorized",
      "Missing credentials. Send an API key as 'Authorization: Bearer <key>', or sign in to the workspace."
    );
  }

  const record = await stores().documents.get<ApiKeyRecord & { id: string }>(
    "api_keys",
    SYSTEM_PARTITION,
    await hashApiKey(token)
  );

  // Same error for unknown and revoked: distinguishing them tells an attacker
  // which guesses were once real keys.
  if (!record || record.revoked) {
    throw new ApiError("invalid_api_key", "The API key is invalid or has been revoked.");
  }

  return {
    tenantId: record.tenant_id,
    userId: record.user_id,
    role: record.role,
    scopes: record.scopes ?? ROLE_SCOPES[record.role],
    apiKeyId: record.id,
  };
}

export function hasScope(principal: Principal, scope: Scope): boolean {
  return principal.scopes.includes(scope);
}

export function requireScope(principal: Principal, scope: Scope): void {
  if (hasScope(principal, scope)) return;
  throw new ApiError(
    "insufficient_scope",
    `This endpoint requires the '${scope}' scope, which this key does not have.`,
    { details: { required_scope: scope, granted_scopes: principal.scopes } }
  );
}

export function requireAdmin(principal: Principal): void {
  if (principal.role === "admin") return;
  throw new ApiError(
    "insufficient_role",
    "This action requires the 'admin' role in this workspace.",
    { details: { required_role: "admin", role: principal.role } }
  );
}
