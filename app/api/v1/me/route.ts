import { defineRoute } from "@/lib/api/handler";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

/**
 * What the calling key is and what it may do.
 *
 * The first call an integrator makes: it confirms the key works, which
 * workspace it points at, and which scopes it holds — three things that
 * otherwise get discovered one 403 at a time. For a browser session,
 * `profile` also carries the display fields the workspace chrome needs
 * (name, email, company) — an API key has no such record and gets `null`.
 */
export const GET = defineRoute({
  rateLimit: "read",
  handler: async ({ principal }) => {
    // `apiKeyId` is only set for a Bearer-token caller — a signed-in browser
    // has a real `userId` pointing at a Prisma row worth looking up.
    const user =
      principal.apiKeyId === null
        ? await prisma.user.findUnique({
            where: { id: principal.userId },
            include: { company: true },
          })
        : null;

    return {
      body: {
        tenant_id: principal.tenantId,
        user_id: principal.userId,
        role: principal.role,
        scopes: principal.scopes,
        api_key_id: principal.apiKeyId,
        profile: user
          ? {
              name: user.name,
              email: user.email,
              company_name: user.company?.name ?? null,
            }
          : null,
      },
    };
  },
});
