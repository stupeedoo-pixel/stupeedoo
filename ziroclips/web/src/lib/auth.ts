import "server-only";
import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "./db";
import { env } from "./env";

/**
 * Auth.js v5: email/password (bcrypt) + Google OAuth (enabled when
 * AUTH_GOOGLE_ID/SECRET are set). JWT sessions so Credentials works; the
 * Prisma adapter stores OAuth account links.
 *
 * ROADMAP: magic links via the Resend/Nodemailer provider (VerificationToken
 * table already exists).
 */
const credentialsSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

const providers: NextAuthConfig["providers"] = [
  Credentials({
    credentials: { email: {}, password: {} },
    async authorize(raw) {
      const parsed = credentialsSchema.safeParse(raw);
      if (!parsed.success) return null;
      const user = await db.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
      if (!user?.passwordHash) return null;
      const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
      return ok ? { id: user.id, email: user.email, name: user.name, image: user.image } : null;
    },
  }),
];
if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
  providers.push(Google({ allowDangerousEmailAccountLinking: true }));
}

export const googleEnabled = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db),
  session: { strategy: "jwt" },
  trustHost: true,
  pages: { signIn: "/login" },
  providers,
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) token.uid = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.uid && session.user) session.user.id = token.uid as string;
      return session;
    },
  },
  events: {
    // OAuth sign-ups: apply the same single-user/first-user promotion as /register.
    async createUser({ user }) {
      if (user.id) await promoteIfFirstUser(user.id);
    },
  },
});

/** In single-user mode the very first account owns the instance. */
export async function promoteIfFirstUser(userId: string) {
  if (!env().SINGLE_USER_MODE) return;
  const count = await db.user.count();
  if (count === 1) await db.user.update({ where: { id: userId }, data: { role: "ADMIN", plan: "UNLIMITED" } });
}
