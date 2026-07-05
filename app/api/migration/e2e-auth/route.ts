import { encode } from "next-auth/jwt";

import { isAdminEmail } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { writeFreezeResponse } from "@/lib/migration/write-freeze";
import { readRuntimeEnv } from "@/lib/runtime/cloudflare";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const sessionMaxAgeSeconds = 60 * 60;

type E2EAuthPayload = {
  email?: unknown;
  name?: unknown;
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

  const secret = readRuntimeEnv("NEXTAUTH_SECRET") || readRuntimeEnv("AUTH_SECRET");
  if (!secret) {
    return Response.json(
      { ok: false, error: "NextAuth secret is not configured." },
      { status: 500, headers: noStoreHeaders() },
    );
  }

  const name = typeof payload.name === "string" && payload.name.trim() ? payload.name.trim() : "Inspir E2E";
  const user = await upsertTestUser(requestedEmail, name);
  const sessionToken = await encode({
    secret,
    maxAge: sessionMaxAgeSeconds,
    token: {
      id: user.id,
      name: user.name,
      email: user.email,
      picture: user.image,
      sub: user.id,
    },
  });

  const expires = new Date(Date.now() + sessionMaxAgeSeconds * 1000);
  return Response.json(
    {
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        isAdmin: isAdminEmail(user.email),
      },
    },
    {
      status: 200,
      headers: {
        ...noStoreHeaders(),
        "Set-Cookie": buildSessionCookie(request, sessionToken, expires),
      },
    },
  );
}

async function upsertTestUser(email: string, name: string) {
  const now = new Date();
  const [created] = await db
    .insert(users)
    .values({
      id: crypto.randomUUID(),
      name,
      email,
      emailVerified: now,
      preferredLanguage: "English",
    })
    .onConflictDoUpdate({
      target: users.email,
      set: {
        emailVerified: now,
        updatedAt: now,
      },
    })
    .returning();
  if (!created) throw new Error("Failed to create migration E2E test user.");
  return created;
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
  const cookieName = `${secure ? "__Secure-" : ""}next-auth.session-token`;
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
  const authUrl = readRuntimeEnv("NEXTAUTH_URL") ?? readRuntimeEnv("AUTH_URL") ?? "";
  return requestUrl.protocol === "https:" || authUrl.startsWith("https://");
}

function normalizeEmail(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized.includes("@") ? normalized : null;
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
