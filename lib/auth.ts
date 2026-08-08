import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
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
