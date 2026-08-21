import { randomUUID } from "node:crypto";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
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
  ],
  callbacks: {
    async jwt({ token, user }) {
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
