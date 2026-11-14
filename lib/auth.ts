import { randomUUID } from "node:crypto";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Cognito from "next-auth/providers/cognito";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

const autoLinkSchema = z.object({
  email: z.email(),
  company: z.string().min(1),
});

// Static bcrypt hash of an unguessable value, compared against when no user is
// found so authorize() always pays the same bcrypt cost — prevents timing-based
// account enumeration (nonexistent/inactive accounts would otherwise short-circuit
// before bcrypt.compare and respond measurably faster).
const DUMMY_HASH = "$2b$12$UmH.7yBq9wZcEfCcIX2UM.WP0nfMI64foN5wzesDXJXHUBdTapStK";

// One login for all Sys.Lab products: the Sys.Lab Platform login (AWS Cognito,
// auth.systemslab.app). Switched on by AUTH_COGNITO_ID + AUTH_COGNITO_ISSUER;
// without them the app signs people in exactly as before. AUTH_COGNITO_SECRET is
// optional: with it the app also proves itself to the login service, without it
// the exchange is protected by PKCE alone (the same way a browser app does it).
const sysLabLogin = Boolean(process.env.AUTH_COGNITO_ID && process.env.AUTH_COGNITO_ISSUER);

/**
 * The Sys.Lab login only proves WHO someone is. What they may do here still
 * comes from this app's own user list: the person must already be a user with
 * the same email, and be active. Nobody is created.
 *
 * The email must be confirmed in the login service. An unconfirmed (just
 * changed) email is refused — otherwise someone could type another person's
 * address into their own Sys.Lab profile and be let into that person's account.
 */
async function userForSysLabLogin(profile: unknown) {
  const p = (profile ?? {}) as { email?: unknown; email_verified?: unknown };
  const email = typeof p.email === "string" ? p.email.trim().toLowerCase() : "";
  const confirmed = p.email_verified === true || p.email_verified === "true";
  if (!email || !confirmed) return null;
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
  });
  if (!user || !user.isActive) return null;
  return user;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt", maxAge: 60 * 60 * 8 },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: {},
        password: {},
      },
      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;

        const user = await prisma.user.findUnique({ where: { email } });
        const valid = await bcrypt.compare(password, user?.password ?? DUMMY_HASH);
        if (!user || !user.isActive || !valid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          companyId: user.companyId,
        };
      },
    }),

    /**
     * A shareable link, not a password: knowing the email and the exact
     * company name is enough to get in. There is deliberately no separate
     * secret — the company name plays that role, the same way an invite link
     * with the right query string does elsewhere in the SysLab suite.
     *
     * A recognized email joins that company (reassigning it if the account
     * belonged to a different one — the link is the source of truth for
     * where the recipient should land). An unrecognized email provisions a
     * new, read-only Viewer account, so sharing the link is enough to give
     * someone a look at the workspace without an admin creating them first.
     */
    Credentials({
      id: "auto-link",
      name: "Auto sign-in link",
      credentials: { email: {}, company: {} },
      async authorize(credentials) {
        const parsed = autoLinkSchema.safeParse(credentials);
        if (!parsed.success) return null;
        const email = parsed.data.email.trim().toLowerCase();
        const companyName = parsed.data.company.trim();

        const company = await prisma.company.findFirst({
          where: { name: { equals: companyName, mode: "insensitive" }, isActive: true },
        });
        if (!company) return null;

        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) {
          if (!existing.isActive) return null;
          const user =
            existing.companyId === company.id
              ? existing
              : await prisma.user.update({
                  where: { id: existing.id },
                  data: { companyId: company.id },
                });
          return { id: user.id, email: user.email, name: user.name, role: user.role, companyId: user.companyId };
        }

        // The password is random and never handed out — this account is only
        // ever reached through a link carrying its email, never a password.
        const created = await prisma.user.create({
          data: {
            email,
            name: email.split("@")[0],
            password: await bcrypt.hash(randomUUID(), 12),
            role: "Viewer",
            companyId: company.id,
            isActive: true,
          },
        });
        return {
          id: created.id,
          email: created.email,
          name: created.name,
          role: created.role,
          companyId: created.companyId,
        };
      },
    }),

    ...(sysLabLogin
      ? [
          Cognito({
            clientId: process.env.AUTH_COGNITO_ID,
            issuer: process.env.AUTH_COGNITO_ISSUER,
            authorization: { params: { scope: "openid email profile" } },
            ...(process.env.AUTH_COGNITO_SECRET
              ? { clientSecret: process.env.AUTH_COGNITO_SECRET }
              : { client: { token_endpoint_auth_method: "none" as const } }),
          }),
        ]
      : []),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider !== "cognito") return true;
      const local = await userForSysLabLogin(profile);
      if (!local) return "/login?error=NoAccess";
      // From here on "user" is this app's user, not the login service's.
      Object.assign(user, {
        id: local.id,
        email: local.email,
        name: local.name,
        role: local.role,
        companyId: local.companyId,
      });
      return true;
    },
    async jwt({ token, user, account, profile }) {
      if (account?.provider === "cognito") {
        const local = await userForSysLabLogin(profile);
        token.id = local?.id;
        token.role = local?.role;
        token.companyId = local?.companyId ?? null;
        if (local) {
          token.email = local.email;
          token.name = local.name;
        }
        return token;
      }

      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.companyId = user.companyId ?? null;
        return token;
      }

      // Re-check on every request so a deactivated/deleted account loses
      // access immediately instead of staying valid for the token's lifetime.
      if (token.id) {
        const current = await prisma.user.findUnique({ where: { id: token.id } });
        if (!current || !current.isActive) {
          token.id = undefined;
        } else {
          token.role = current.role;
          token.companyId = current.companyId ?? null;
        }
      }

      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id ?? "";
      session.user.role = token.role ?? "User";
      session.user.companyId = token.companyId ?? null;
      return session;
    },
  },
});
