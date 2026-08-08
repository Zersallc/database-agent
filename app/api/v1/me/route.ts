import { defineRoute } from "@/lib/api/handler";

export const runtime = "nodejs";

/**
 * What the calling key is and what it may do.
 *
 * The first call an integrator makes: it confirms the key works, which
 * workspace it points at, and which scopes it holds — three things that
 * otherwise get discovered one 403 at a time.
 */
export const GET = defineRoute({
  rateLimit: "read",
  handler: async ({ principal }) => ({
    body: {
      tenant_id: principal.tenantId,
      user_id: principal.userId,
      role: principal.role,
      scopes: principal.scopes,
      api_key_id: principal.apiKeyId,
    },
  }),
});
