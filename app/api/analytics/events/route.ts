import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { recordProductEvent } from "@/lib/observability/events";
import { writeFreezeResponse } from "@/lib/migration/write-freeze";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allowedEventNames = new Set([
  "page_view",
  "auth_error_seen",
  "chat_message_sent",
  "profile_opened",
  "admin_opened",
]);

const eventSchema = z.object({
  name: z.string().trim().min(1).max(80),
  route: z.string().trim().max(180).optional(),
  sessionId: z.string().trim().max(120).optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: Request) {
  const freeze = writeFreezeResponse("analytics");
  if (freeze) return freeze;

  const parsed = eventSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !allowedEventNames.has(parsed.data.name)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const session = await requireSession({ refresh: false });
  await recordProductEvent({
    name: parsed.data.name,
    userId: session?.user.id ?? null,
    userEmailSnapshot: session?.user.email ?? null,
    route: sanitizeRoute(parsed.data.route),
    sessionId: parsed.data.sessionId,
    userAgentHash: await hashUserAgent(request.headers.get("user-agent")),
    properties: sanitizeProperties(parsed.data.properties),
  });

  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

function sanitizeRoute(route: string | undefined) {
  if (!route) return null;
  const path = route.split(/[?#]/)[0] || "/";
  return path.startsWith("/") ? path.slice(0, 180) : `/${path}`.slice(0, 180);
}

function sanitizeProperties(properties: Record<string, unknown> | undefined) {
  const safe: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(properties ?? {}).slice(0, 20)) {
    if (!/^[a-zA-Z0-9_.:-]{1,60}$/.test(key)) continue;
    if (typeof value === "string") safe[key] = value.slice(0, 240);
    else if (typeof value === "number" && Number.isFinite(value)) safe[key] = value;
    else if (typeof value === "boolean" || value === null) safe[key] = value;
  }
  return safe;
}

async function hashUserAgent(userAgent: string | null) {
  if (!userAgent) return null;
  const bytes = new TextEncoder().encode(userAgent.slice(0, 500));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 24);
}
