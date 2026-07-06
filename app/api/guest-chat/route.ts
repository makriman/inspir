import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { createLearningAgent } from "@/lib/ai/learning-agent";
import { createLearningTextStreamResponse } from "@/lib/ai/streaming";
import { resolveModelForTopic } from "@/lib/ai/model-router";
import { getTopicMetadata } from "@/lib/ai/prompts";
import { findSeededTopic } from "@/lib/content/seeded-topics";
import { getActiveTopics } from "@/lib/db/queries";
import {
  consumeDailyLlmBudget,
  consumeFixedWindowQuota,
  numberFromEnv,
  quotaDefaults,
  safeQuotaKeyPart,
} from "@/lib/utils/rate-limit";
import { writeFreezeResponse } from "@/lib/migration/write-freeze";
import {
  guestChatSchema,
  guestCookieMaxAge,
  guestFingerprintKey,
  guestSessionCookie,
  guestUsageCookie,
  guestUsageCookieMaxAge,
  parseUsage,
  requestIp,
  sanitizeGuestHistory,
} from "@/lib/guest-chat/safety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const freeze = writeFreezeResponse("guest-chat");
  if (freeze) return freeze;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid chat request" }, { status: 400 });
  }

  const parsed = guestChatSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: "Invalid chat request" }, { status: 400 });

  const guestMessageLimit = numberFromEnv("RATE_LIMIT_GUEST_SESSION_DAILY", quotaDefaults.guestSessionDaily);
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(guestSessionCookie)?.value || crypto.randomUUID();
  const used = parseUsage(cookieStore.get(guestUsageCookie)?.value, guestMessageLimit);

  const topic = await getGuestTopic(parsed.data.topicId);
  const uiMode = topic ? getTopicMetadata(topic)?.uiMode : undefined;
  if (!topic || uiMode === "quiz" || uiMode === "flashcards") {
    return NextResponse.json({ error: "Topic not available for guest chat" }, { status: 404 });
  }

  const ip = requestIp(request);
  if (ip) {
    const ipRate = await consumeFixedWindowQuota(
      `guest-chat:ip:${safeQuotaKeyPart(ip)}`,
      numberFromEnv("RATE_LIMIT_GUEST_IP_DAILY", quotaDefaults.guestIpDaily),
      guestUsageCookieMaxAge * 1000,
    );
    if (!ipRate.ok) {
      return guestLimitResponse(used, guestMessageLimit, ipRate.retryAfterSeconds);
    }
  }

  const fingerprintRate = await consumeFixedWindowQuota(
    await guestFingerprintKey(request),
    numberFromEnv("RATE_LIMIT_GUEST_FINGERPRINT_DAILY", quotaDefaults.guestFingerprintDaily),
    guestUsageCookieMaxAge * 1000,
  );
  if (!fingerprintRate.ok) {
    return guestLimitResponse(used, guestMessageLimit, fingerprintRate.retryAfterSeconds);
  }

  const sessionRate = await consumeFixedWindowQuota(
    `guest-chat:session:${safeQuotaKeyPart(sessionId)}`,
    guestMessageLimit,
    guestUsageCookieMaxAge * 1000,
  );
  if (!sessionRate.ok) {
    return guestLimitResponse(used, guestMessageLimit, sessionRate.retryAfterSeconds);
  }

  const budget = await consumeDailyLlmBudget();
  if (!budget.ok) {
    return guestLimitResponse(used, guestMessageLimit, budget.retryAfterSeconds, "Daily AI usage limit reached");
  }

  const nextUsed = Math.min(guestMessageLimit, sessionRate.limit - sessionRate.remaining);
  cookieStore.set(guestSessionCookie, sessionId, {
    httpOnly: true,
    maxAge: guestCookieMaxAge,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  cookieStore.set(guestUsageCookie, String(nextUsed), {
    httpOnly: true,
    maxAge: guestUsageCookieMaxAge,
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
        ...sanitizeGuestHistory(parsed.data.messages),
        { role: "user" as const, content: parsed.data.content },
      ],
    });
    return await createLearningTextStreamResponse({ fullStream: result.fullStream as ReadableStream<unknown> }, {
      headers: {
        "x-guest-messages-used": String(nextUsed),
        "x-guest-messages-limit": String(guestMessageLimit),
      },
      onError(error) {
        console.warn("Guest chat stream failed", error);
      },
    });
  } catch (error) {
    console.warn("Guest chat failed", error);
    return NextResponse.json({ error: "The assistant could not answer right now." }, { status: 500 });
  }
}

function guestLimitResponse(
  used: number,
  limit: number,
  retryAfterSeconds: number,
  error = "Guest message limit reached",
) {
  return NextResponse.json(
    { error, used, limit },
    {
      status: 429,
      headers: { "Retry-After": String(retryAfterSeconds) },
    },
  );
}
