import { and, eq } from "drizzle-orm";
import type { Adapter, AdapterAccount, AdapterSession, AdapterUser, VerificationToken } from "next-auth/adapters";
import { db } from "@/lib/db/client";
import { accounts, sessions, users, verificationTokens, type User } from "@/lib/db/schema";
import { assertWritesAllowed } from "@/lib/migration/write-freeze";

export function D1AuthAdapter(): Adapter {
  return {
    async createUser(data: Omit<AdapterUser, "id">) {
      assertWritesAllowed("auth");
      const [user] = await db.insert(users).values({ ...data, id: crypto.randomUUID() }).returning();
      return toAdapterUser(user);
    },

    async getUser(id) {
      const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
      return user ? toAdapterUser(user) : null;
    },

    async getUserByEmail(email) {
      const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
      return user ? toAdapterUser(user) : null;
    },

    async getUserByAccount({ provider, providerAccountId }: Pick<AdapterAccount, "provider" | "providerAccountId">) {
      const [result] = await db
        .select({ user: users })
        .from(accounts)
        .innerJoin(users, eq(accounts.userId, users.id))
        .where(and(eq(accounts.provider, provider), eq(accounts.providerAccountId, providerAccountId)))
        .limit(1);
      return result?.user ? toAdapterUser(result.user) : null;
    },

    async updateUser(data: Partial<AdapterUser> & Pick<AdapterUser, "id">) {
      assertWritesAllowed("auth");
      const [user] = await db.update(users).set(data).where(eq(users.id, data.id)).returning();
      if (!user) throw new Error("User not found.");
      return toAdapterUser(user);
    },

    async deleteUser(id) {
      assertWritesAllowed("auth");
      const [user] = await db.delete(users).where(eq(users.id, id)).returning();
      return user ? toAdapterUser(user) : null;
    },

    async linkAccount(data: AdapterAccount) {
      assertWritesAllowed("auth");
      await db.insert(accounts).values(data).onConflictDoNothing();
      return data as AdapterAccount;
    },

    async unlinkAccount({ provider, providerAccountId }: Pick<AdapterAccount, "provider" | "providerAccountId">) {
      assertWritesAllowed("auth");
      const [account] = await db
        .delete(accounts)
        .where(and(eq(accounts.provider, provider), eq(accounts.providerAccountId, providerAccountId)))
        .returning();
      return account ? (account as AdapterAccount) : undefined;
    },

    async createSession(data: AdapterSession) {
      assertWritesAllowed("auth");
      const [session] = await db.insert(sessions).values(data).returning();
      return toAdapterSession(session);
    },

    async getSessionAndUser(sessionToken) {
      const [result] = await db
        .select({ session: sessions, user: users })
        .from(sessions)
        .innerJoin(users, eq(sessions.userId, users.id))
        .where(eq(sessions.sessionToken, sessionToken))
        .limit(1);
      return result ? { session: toAdapterSession(result.session), user: toAdapterUser(result.user) } : null;
    },

    async updateSession(data: Partial<AdapterSession> & Pick<AdapterSession, "sessionToken">) {
      assertWritesAllowed("auth");
      const [session] = await db
        .update(sessions)
        .set(data)
        .where(eq(sessions.sessionToken, data.sessionToken))
        .returning();
      return session ? toAdapterSession(session) : null;
    },

    async deleteSession(sessionToken) {
      assertWritesAllowed("auth");
      const [session] = await db.delete(sessions).where(eq(sessions.sessionToken, sessionToken)).returning();
      return session ? toAdapterSession(session) : null;
    },

    async createVerificationToken(data: VerificationToken) {
      assertWritesAllowed("auth");
      const [token] = await db.insert(verificationTokens).values(data).returning();
      return toVerificationToken(token);
    },

    async useVerificationToken({ identifier, token }: { identifier: string; token: string }) {
      assertWritesAllowed("auth");
      const [verificationToken] = await db
        .delete(verificationTokens)
        .where(and(eq(verificationTokens.identifier, identifier), eq(verificationTokens.token, token)))
        .returning();
      return verificationToken ? toVerificationToken(verificationToken) : null;
    },
  };
}

function toAdapterUser(user: User): AdapterUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified,
    image: user.image,
  };
}

function toAdapterSession(session: typeof sessions.$inferSelect): AdapterSession {
  return {
    sessionToken: session.sessionToken,
    userId: session.userId,
    expires: session.expires,
  };
}

function toVerificationToken(token: typeof verificationTokens.$inferSelect): VerificationToken {
  return {
    identifier: token.identifier,
    token: token.token,
    expires: token.expires,
  };
}
