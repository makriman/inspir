import { eq } from "drizzle-orm";
import { sessions } from "@/lib/db/schema";
import { db } from "@/lib/db/client";
import { readRuntimeEnv } from "@/lib/runtime/cloudflare";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sessionCookieNames = [
  "better-auth.session_token",
  "__Secure-better-auth.session_token",
  "better-auth.session_data",
  "__Secure-better-auth.session_data",
] as const;

export async function POST(request: Request) {
  if (!isAllowedLogoutOrigin(request)) {
    return Response.json({ error: "Forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }

  const token = readBetterAuthSessionToken(request.headers.get("cookie") ?? "");
  if (token) {
    await db.delete(sessions).where(eq(sessions.sessionToken, token));
  }

  return new Response(null, { status: 204, headers: logoutHeaders() });
}

function readBetterAuthSessionToken(cookieHeader: string) {
  const cookies = parseCookies(cookieHeader);
  const signedValue = cookies.get("better-auth.session_token") ?? cookies.get("__Secure-better-auth.session_token");
  if (!signedValue) return null;
  const separatorIndex = signedValue.lastIndexOf(".");
  return separatorIndex > 0 ? signedValue.slice(0, separatorIndex) : null;
}

function parseCookies(cookieHeader: string) {
  const cookies = new Map<string, string>();
  for (const part of cookieHeader.split(";")) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex === -1) continue;
    const name = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();
    if (!name) continue;
    try {
      cookies.set(name, decodeURIComponent(value));
    } catch {
      cookies.set(name, value);
    }
  }
  return cookies;
}

function isAllowedLogoutOrigin(request: Request) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return false;

  const origin = request.headers.get("origin");
  if (!origin) return true;

  const allowedOrigins = new Set<string>();
  for (const value of [request.url, readRuntimeEnv("APP_URL"), readRuntimeEnv("AUTH_URL"), readRuntimeEnv("BETTER_AUTH_URL")]) {
    if (!value) continue;
    try {
      allowedOrigins.add(new URL(value).origin);
    } catch {
      // Ignore malformed optional environment URLs.
    }
  }
  return allowedOrigins.has(origin);
}

function logoutHeaders() {
  const headers = new Headers({ "Cache-Control": "no-store" });
  for (const name of sessionCookieNames) {
    headers.append(
      "Set-Cookie",
      [
        `${name}=`,
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        "Max-Age=0",
        "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
        name.startsWith("__Secure-") ? "Secure" : "",
      ]
        .filter(Boolean)
        .join("; "),
    );
  }
  return headers;
}
