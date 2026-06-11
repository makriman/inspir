import type { NextAuthOptions } from "next-auth";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import { after } from "next/server";
import GoogleProvider from "next-auth/providers/google";
import { db } from "@/lib/db/client";
import { accounts, sessions, users, verificationTokens } from "@/lib/db/schema";
import { refreshProfilePhoto } from "./profile-photo";

for (const key of ["NEXTAUTH_URL", "AUTH_URL"] as const) {
  if (process.env[key] !== undefined && !process.env[key]?.trim()) {
    delete process.env[key];
  }
}

const googleClientId = process.env.AUTH_GOOGLE_ID ?? process.env.GOOGLE_CLIENT_ID ?? "";
const googleClientSecret = process.env.AUTH_GOOGLE_SECRET ?? process.env.GOOGLE_CLIENT_SECRET ?? "";

export const authOptions: NextAuthOptions = {
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  providers: [
    GoogleProvider({
      clientId: googleClientId,
      clientSecret: googleClientSecret,
      // Safe only while Google is the sole sign-in provider and email
      // verification is enforced in the signIn callback below. Revisit before
      // adding any provider with weaker or optional email verification.
      allowDangerousEmailAccountLinking: true,
      authorization: {
        params: {
          prompt: "select_account",
          access_type: "offline",
          response_type: "code",
        },
      },
    }),
  ],
  secret: process.env.NEXTAUTH_SECRET?.trim() || process.env.AUTH_SECRET?.trim() || undefined,
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/",
    error: "/",
  },
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider === "google") {
        const googleProfile = profile as { email_verified?: boolean } | undefined;
        return googleProfile?.email_verified !== false;
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user?.id) token.id = user.id;
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.id) {
        session.user.id = String(token.id);
      }
      return session;
    },
    async redirect({ url, baseUrl }) {
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      if (url.startsWith(baseUrl)) return url;
      return `${baseUrl}/chat`;
    },
  },
  events: {
    async signIn({ user, profile }) {
      const googleProfile = profile as { name?: string; picture?: string } | undefined;
      const googleName = googleProfile?.name?.trim() || user.name?.trim();
      const profileImage =
        googleProfile?.picture ?? user.image ?? undefined;

      if (user.id && (googleName || profileImage)) {
        await db
          .update(users)
          .set({
            ...(googleName ? { name: googleName } : {}),
            ...(profileImage ? { image: profileImage } : {}),
            updatedAt: new Date(),
          })
          .where(eq(users.id, user.id));
      }

      after(async () => {
        await refreshProfilePhoto(user.id, profileImage);
      });
    },
  },
};
