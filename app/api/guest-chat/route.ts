import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createLearningAgent } from "@/lib/ai/learning-agent";
import { resolveModelForTopic } from "@/lib/ai/model-router";
import { getTopicMetadata } from "@/lib/ai/prompts";
import { findSeededTopic } from "@/lib/content/seeded-topics";
import { getActiveTopics } from "@/lib/db/queries";
import { checkRateLimit } from "@/lib/utils/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const guestMessageLimit = 5;
const guestSessionCookie = "inspir_guest_session";
const guestUsageCookie = "inspir_guest_messages_used";
const guestCookieMaxAge = 60 * 60 * 24 * 30;

const guestChatSchema = z.object({
  topicId: z.string().trim().min(1).max(120),
  content: z.string().trim().min(1).max(6000),
  preferredLanguage: z.string().trim().min(1).max(80).optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1).max(6000),
      }),
    )
    .max(12)
    .optional()
    .default([]),
});

function parseUsage(value: string | undefined) {
  const parsed = Number(value ?? "0");
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(Math.floor(parsed), guestMessageLimit);
}

function requestIp(request: NextRequest) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

async function getGuestTopic(topicId: string) {
  const seededTopic = findSeededTopic(topicId);
  if (seededTopic) return seededTopic;

  const normalized = topicId.toLowerCase();
  try {
    const topics = await getActiveTopics();
    return (
      topics.find(
        (candidate) => candidate.id === topicId || candidate.slug.toLowerCase() === normalized,
      ) ?? findSeededTopic(topicId)
    );
  } catch {
    return findSeededTopic(topicId);
  }
}

export async function POST(request: NextRequest) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid chat request" }, { status: 400 });
  }

  const parsed = guestChatSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: "Invalid chat request" }, { status: 400 });

  const cookieStore = await cookies();
  const sessionId = cookieStore.get(guestSessionCookie)?.value || crypto.randomUUID();
  const used = parseUsage(cookieStore.get(guestUsageCookie)?.value);
  if (used >= guestMessageLimit) {
    return NextResponse.json(
      { error: "Guest message limit reached", used, limit: guestMessageLimit },
      { status: 429 },
    );
  }

  const sessionRate = checkRateLimit(
    `guest-chat-session:${sessionId}`,
    guestMessageLimit,
    guestCookieMaxAge * 1000,
  );
  const ipRate = checkRateLimit(`guest-chat-ip:${requestIp(request)}`, 50, 24 * 60 * 60 * 1000);
  if (!sessionRate.ok || !ipRate.ok) {
    return NextResponse.json(
      { error: "Guest message limit reached", used, limit: guestMessageLimit },
      { status: 429 },
    );
  }

  const topic = await getGuestTopic(parsed.data.topicId);
  const uiMode = topic ? getTopicMetadata(topic)?.uiMode : undefined;
  if (!topic || uiMode === "quiz" || uiMode === "flashcards") {
    return NextResponse.json({ error: "Topic not available for guest chat" }, { status: 404 });
  }

  const nextUsed = used + 1;
  cookieStore.set(guestSessionCookie, sessionId, {
    httpOnly: true,
    maxAge: guestCookieMaxAge,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  cookieStore.set(guestUsageCookie, String(nextUsed), {
    httpOnly: true,
    maxAge: guestCookieMaxAge,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  try {
    const model = resolveModelForTopic(topic);
    const agent = createLearningAgent({
      topic,
      model,
      preferredLanguage: parsed.data.preferredLanguage,
    });
    const result = await agent.stream({
      messages: [
        ...parsed.data.messages.slice(-12),
        { role: "user" as const, content: parsed.data.content },
      ],
    });
    const response = result.toTextStreamResponse();
    response.headers.set("x-guest-messages-used", String(nextUsed));
    response.headers.set("x-guest-messages-limit", String(guestMessageLimit));
    return response;
  } catch {
    return NextResponse.json({ error: "The assistant could not answer right now." }, { status: 500 });
  }
}
