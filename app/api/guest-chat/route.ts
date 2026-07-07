import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { createLearningAgent, learningModelSettings } from "@/lib/ai/learning-agent";
import { createLearningTextStreamResponse } from "@/lib/ai/streaming";
import { resolveModelForTopic } from "@/lib/ai/model-router";
import { getTopicMetadata } from "@/lib/ai/prompts";
import {
  buildGuestStarterResponseCacheRequest,
  cachedLearningResponseStream,
  cacheDiagnosticHeaders,
  getCachedLearningResponse,
  isGuestStarterCacheCandidate,
  recordAiCacheProductEvent,
  recordCachedLearningResponseHit,
  storeCachedLearningResponse,
} from "@/lib/ai/response-cache";
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
      return guestLimitResponse(used, guestMessageLimit, ipRate.retryAfterSeconds, "Guest message limit reached", "ip");
    }
  }

  const fingerprintRate = await consumeFixedWindowQuota(
    await guestFingerprintKey(request),
    numberFromEnv("RATE_LIMIT_GUEST_FINGERPRINT_DAILY", quotaDefaults.guestFingerprintDaily),
    guestUsageCookieMaxAge * 1000,
  );
  if (!fingerprintRate.ok) {
    return guestLimitResponse(
      used,
      guestMessageLimit,
      fingerprintRate.retryAfterSeconds,
      "Guest message limit reached",
      "fingerprint",
    );
  }

  const sessionRate = await consumeFixedWindowQuota(
    `guest-chat:session:${safeQuotaKeyPart(sessionId)}`,
    guestMessageLimit,
    guestUsageCookieMaxAge * 1000,
  );
  if (!sessionRate.ok) {
    return guestLimitResponse(used, guestMessageLimit, sessionRate.retryAfterSeconds, "Guest message limit reached", "session");
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
    const modelParams = learningModelSettings(topic, model);
    const cacheRequest = isGuestStarterCacheCandidate(parsed.data.messages)
      ? await buildGuestStarterResponseCacheRequest({
          content: parsed.data.content,
          model,
          modelParams,
          preferredLanguage: parsed.data.preferredLanguage,
          topic,
        })
      : null;
    const guestHeaders = {
      "x-guest-messages-used": String(nextUsed),
      "x-guest-messages-limit": String(guestMessageLimit),
    };

    if (cacheRequest) {
      const cached = await getCachedLearningResponse(cacheRequest);
      if (cached) {
        await Promise.all([
          recordCachedLearningResponseHit(cached.cacheKey),
          recordAiCacheProductEvent({
            name: "ai_cache_hit",
            sessionId,
            properties: {
              scope: cacheRequest.scope,
              surface: cacheRequest.surface,
              topicSlug: cacheRequest.topicSlug,
              language: cacheRequest.language,
              model,
              savedPromptTokens: cached.promptTokens ?? 0,
              savedCompletionTokens: cached.completionTokens ?? 0,
              savedTotalTokens: cached.totalTokens ?? 0,
            },
          }),
        ]);
        return await createLearningTextStreamResponse(
          { fullStream: cachedLearningResponseStream(cached.responseText) },
          {
            headers: {
              ...guestHeaders,
              ...cacheDiagnosticHeaders("hit", "public-starter"),
            },
          },
        );
      }
      await recordAiCacheProductEvent({
        name: "ai_cache_miss",
        sessionId,
        properties: {
          scope: cacheRequest.scope,
          surface: cacheRequest.surface,
          topicSlug: cacheRequest.topicSlug,
          language: cacheRequest.language,
          model,
        },
      });
    } else {
      await recordAiCacheProductEvent({
        name: "ai_cache_bypass",
        sessionId,
        properties: {
          reason: "guest-history",
          surface: "guest-chat",
          topicSlug: topic.slug,
          model,
        },
      });
    }

    const budget = await consumeDailyLlmBudget();
    if (!budget.ok) {
      return guestLimitResponse(
        used,
        guestMessageLimit,
        budget.retryAfterSeconds,
        "Daily AI usage limit reached",
        "global-ai-budget",
      );
    }

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
        ...guestHeaders,
        ...cacheDiagnosticHeaders(cacheRequest ? "miss" : "bypass", cacheRequest ? "public-starter" : "guest-history"),
      },
      onError(error) {
        console.warn("Guest chat stream failed", error);
      },
      async onFinish(event) {
        if (!cacheRequest) return;
        const result = await storeCachedLearningResponse({
          request: cacheRequest,
          responseText: event.text,
          finishReason: event.finishReason,
          totalUsage: event.totalUsage,
        });
        await recordAiCacheProductEvent({
          name: result.stored ? "ai_cache_store" : "ai_cache_reject",
          sessionId,
          properties: {
            reason: result.reason,
            scope: cacheRequest.scope,
            surface: cacheRequest.surface,
            topicSlug: cacheRequest.topicSlug,
            language: cacheRequest.language,
            model,
          },
        });
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
  bucket: "ip" | "fingerprint" | "session" | "global-ai-budget" = "session",
) {
  return NextResponse.json(
    { error, used, limit, bucket },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfterSeconds),
        "x-guest-rate-limit-bucket": bucket,
      },
    },
  );
}
