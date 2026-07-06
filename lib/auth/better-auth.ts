import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { after } from "next/server";
import { db } from "@/lib/db/client";
import { accounts, sessions, users, verificationTokens } from "@/lib/db/schema";
import { readRuntimeEnv } from "@/lib/runtime/cloudflare";
import { refreshProfilePhoto } from "./profile-photo";

const localOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:8787",
  "http://127.0.0.1:8787",
];

const authDbSchema = {
  users,
  accounts,
  sessions,
  verificationTokens,
};

export function createAuth() {
  const baseURL = authBaseURL();
  const googleClientId = readRuntimeEnv("AUTH_GOOGLE_ID") ?? readRuntimeEnv("GOOGLE_CLIENT_ID") ?? "";
  const googleClientSecret = readRuntimeEnv("AUTH_GOOGLE_SECRET") ?? readRuntimeEnv("GOOGLE_CLIENT_SECRET") ?? "";

  return betterAuth({
    appName: "inspir",
    baseURL,
    secret: authSecret(),
    trustedOrigins: trustedOrigins(baseURL),
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: authDbSchema,
      transaction: false,
    }),
    socialProviders: {
      google: {
        clientId: googleClientId,
        clientSecret: googleClientSecret,
        accessType: "offline",
        prompt: "select_account",
        overrideUserInfoOnSignIn: true,
        mapProfileToUser(profile) {
          return {
            name: profile.name,
            image: profile.picture,
            emailVerified: profile.email_verified === true,
          };
        },
      },
    },
    user: {
      modelName: "users",
    },
    session: {
      modelName: "sessions",
      expiresIn: 60 * 60 * 24 * 30,
      // Session reads refresh by default through requireSession(); this one-day updateAge keeps D1 writes bounded.
      updateAge: 60 * 60 * 24,
      fields: {
        token: "sessionToken",
        expiresAt: "expires",
        userId: "userId",
        createdAt: "createdAt",
        updatedAt: "updatedAt",
        ipAddress: "ipAddress",
        userAgent: "userAgent",
      },
      cookieCache: {
        enabled: true,
        maxAge: 60 * 5,
      },
    },
    account: {
      modelName: "accounts",
      updateAccountOnSignIn: true,
      additionalFields: {
        type: {
          type: "string",
          required: true,
          defaultValue: "oauth",
          fieldName: "type",
          input: false,
          returned: false,
        },
      },
      accountLinking: {
        enabled: true,
        trustedProviders: ["google"],
        // Safe while Google is the only provider and email_verified is enforced in mapProfileToUser/database hooks.
        // Revisit before adding any non-Google provider.
        requireLocalEmailVerified: false,
        updateUserInfoOnLink: true,
      },
      fields: {
        accountId: "providerAccountId",
        providerId: "provider",
        userId: "userId",
        accessToken: "access_token",
        refreshToken: "refresh_token",
        idToken: "id_token",
        accessTokenExpiresAt: "accessTokenExpiresAt",
        refreshTokenExpiresAt: "refreshTokenExpiresAt",
        scope: "scope",
        password: "password",
        createdAt: "createdAt",
        updatedAt: "updatedAt",
      },
    },
    verification: {
      modelName: "verificationTokens",
      fields: {
        identifier: "identifier",
        value: "token",
        expiresAt: "expires",
        createdAt: "createdAt",
        updatedAt: "updatedAt",
      },
    },
    rateLimit: {
      enabled: false,
    },
    advanced: {
      database: {
        generateId: "uuid",
      },
    },
    databaseHooks: {
      user: {
        create: {
          before(user) {
            if (user.emailVerified === false) return Promise.resolve(false);
            return Promise.resolve();
          },
          after(user) {
            queueProfilePhotoRefresh(user);
            return Promise.resolve();
          },
        },
        update: {
          before(user) {
            if (user.emailVerified === false) return Promise.resolve(false);
            return Promise.resolve();
          },
          after(user) {
            queueProfilePhotoRefresh(user);
            return Promise.resolve();
          },
        },
      },
    },
    plugins: [nextCookies()],
  });
}

function authSecret() {
  const secret = readRuntimeEnv("BETTER_AUTH_SECRET") ?? readRuntimeEnv("AUTH_SECRET");
  if (secret) return secret;
  if (process.env.NODE_ENV !== "production") return "inspir-local-dev-auth-secret";
  return "";
}

function authBaseURL() {
  return (
    readRuntimeEnv("BETTER_AUTH_URL") ??
    readRuntimeEnv("AUTH_URL") ??
    readRuntimeEnv("APP_URL") ??
    "http://localhost:3000"
  );
}

function trustedOrigins(baseURL: string) {
  return [...new Set([baseURL, "https://inspirlearning.com", "https://www.inspirlearning.com", ...localOrigins])];
}

function queueProfilePhotoRefresh(user: { id?: unknown; image?: unknown }) {
  const userId = typeof user.id === "string" ? user.id : null;
  const imageUrl = typeof user.image === "string" && user.image.trim() ? user.image.trim() : null;
  if (!userId || !imageUrl) return;

  after(async () => {
    try {
      await refreshProfilePhoto(userId, imageUrl);
    } catch (error) {
      console.warn("auth_profile_photo_refresh_failed", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
