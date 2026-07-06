import { makeSignature } from "better-auth/crypto";

import { isAdminEmail } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import { sessions, users } from "@/lib/db/schema";
import { writeFreezeResponse } from "@/lib/migration/write-freeze";
import { readRuntimeEnv } from "@/lib/runtime/cloudflare";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const sessionMaxAgeSeconds = 60 * 60;

type E2EAuthPayload = {
  email?: unknown;
  name?: unknown;
  image?: unknown;
};

export async function POST(request: Request) {
  const configuredSecret = readRuntimeEnv("E2E_TEST_AUTH_SECRET") ?? readRuntimeEnv("MIGRATION_E2E_AUTH_SECRET");
  const configuredEmail = normalizeEmail(
    readRuntimeEnv("E2E_TEST_AUTH_EMAIL") ?? readRuntimeEnv("MIGRATION_E2E_AUTH_EMAIL"),
  );
  if (!configuredSecret || !configuredEmail) return hiddenResponse();

  const providedSecret = request.headers.get("x-migration-e2e-auth-secret") ?? "";
  if (!constantTimeEquals(providedSecret, configuredSecret)) return hiddenResponse();

  const freeze = writeFreezeResponse("migration-e2e-auth");
  if (freeze) return freeze;

  const payload = await readPayload(request);
  const requestedEmail = normalizeEmail(payload.email) ?? configuredEmail;
  if (requestedEmail !== configuredEmail) {
    return Response.json(
      { ok: false, error: "The migration E2E auth route is limited to its configured test account." },
      { status: 403, headers: noStoreHeaders() },
    );
  }

  const secret = readRuntimeEnv("BETTER_AUTH_SECRET") ?? readRuntimeEnv("AUTH_SECRET");
  if (!secret) {
    return Response.json(
      { ok: false, error: "Better Auth secret is not configured." },
      { status: 500, headers: noStoreHeaders() },
    );
  }

  const name = typeof payload.name === "string" && payload.name.trim() ? payload.name.trim() : "Inspir E2E";
  const image = normalizeImage(payload.image) ?? "/icon.png";
  const user = await upsertTestUser(requestedEmail, name, image);
  const expires = new Date(Date.now() + sessionMaxAgeSeconds * 1000);
  const sessionToken = await createMigrationSession({
    request,
    userId: user.id,
    expires,
  });
  const signedSessionToken = await signCookieValue(sessionToken, secret);

  return Response.json(
    {
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        image: user.image,
        isAdmin: isAdminEmail(user.email),
      },
    },
    {
      status: 200,
      headers: {
        ...noStoreHeaders(),
        "Set-Cookie": buildSessionCookie(request, signedSessionToken, expires),
      },
    },
  );
}

async function upsertTestUser(email: string, name: string, image: string) {
  const now = new Date();
  const [created] = await db
    .insert(users)
    .values({
      id: crypto.randomUUID(),
      name,
      email,
      emailVerified: true,
      emailVerifiedAt: now,
      image,
      preferredLanguage: "English",
    })
    .onConflictDoUpdate({
      target: users.email,
      set: {
        name,
        emailVerified: true,
        emailVerifiedAt: now,
        image,
        updatedAt: now,
      },
    })
    .returning();
  if (!created) throw new Error("Failed to create migration E2E test user.");
  return created;
}

async function createMigrationSession(input: { request: Request; userId: string; expires: Date }) {
  const now = new Date();
  const sessionToken = crypto.randomUUID();
  await db.insert(sessions).values({
    id: crypto.randomUUID(),
    sessionToken,
    userId: input.userId,
    expires: input.expires,
    createdAt: now,
    updatedAt: now,
    ipAddress: input.request.headers.get("cf-connecting-ip"),
    userAgent: input.request.headers.get("user-agent"),
  });
  return sessionToken;
}

async function readPayload(request: Request): Promise<E2EAuthPayload> {
  try {
    const value = await request.json();
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

function buildSessionCookie(request: Request, sessionToken: string, expires: Date) {
  const secure = shouldUseSecureCookie(request);
  const cookieName = `${secure ? "__Secure-" : ""}better-auth.session_token`;
  return [
    `${cookieName}=${sessionToken}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${sessionMaxAgeSeconds}`,
    `Expires=${expires.toUTCString()}`,
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

function shouldUseSecureCookie(request: Request) {
  const requestUrl = new URL(request.url);
  const authUrl = readRuntimeEnv("BETTER_AUTH_URL") ?? readRuntimeEnv("AUTH_URL") ?? readRuntimeEnv("APP_URL") ?? "";
  return requestUrl.protocol === "https:" || authUrl.startsWith("https://");
}

function normalizeEmail(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized.includes("@") ? normalized : null;
}

function normalizeImage(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return trimmed.startsWith("/") ? trimmed : null;
  }
}

async function signCookieValue(value: string, secret: string) {
  const signature = await makeSignature(value, secret);
  return encodeURIComponent(`${value}.${signature}`);
}

function hiddenResponse() {
  return new Response(null, { status: 404, headers: noStoreHeaders() });
}

function noStoreHeaders() {
  return { "Cache-Control": "no-store" };
}

function constantTimeEquals(left: string, right: string) {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
