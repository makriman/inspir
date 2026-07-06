import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireSession } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { aiRuns } from "@/lib/db/schema";
import {
  getContextMessages,
  getDefaultTopic,
  getOwnedChat,
  getUserLearningProfileById,
  insertMessage,
} from "@/lib/db/queries";
import { buildModelMessages } from "@/lib/ai/prompts";
import { createLearningAgent } from "@/lib/ai/learning-agent";
import { createLearningTextStreamResponse, type LearningStreamFinishEvent } from "@/lib/ai/streaming";
import { resolveModelForTopic } from "@/lib/ai/model-router";
import {
  createMemoryPostTurnQueueMessage,
  dispatchMemoryPostTurn,
  type MemoryPostTurnQueueMessage,
} from "@/lib/ai/memory-queue";
import {
  memoryRunMetadata,
  recordMemoryRetrievalUsage,
  retrieveRelevantMemoryForTurn,
  type MemoryRetrievalResult,
} from "@/lib/ai/memory";
import { normalizeLanguage } from "@/lib/content/languages";
import { consumeAiQuota, numberFromEnv, quotaDefaults, safeQuotaKeyPart } from "@/lib/utils/rate-limit";
import { calculateAge } from "@/lib/profile/age";
import { writeFreezeResponse } from "@/lib/migration/write-freeze";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const chatRequestSchema = z.object({
  chatId: z.uuid(),
  content: z.string().trim().min(1).max(6000),
});
const defaultPreStreamMemoryTimeoutMs = 1200;
const defaultPreStreamEmbeddingTimeoutMs = 700;

type MemoryJob = MemoryPostTurnQueueMessage | null;

function createMemoryJobLatch() {
  let memoryJobSettled = false;
  let settleMemoryJob: (job: MemoryJob) => void = () => {};
  const memoryJob = new Promise<MemoryJob>((resolve) => {
    settleMemoryJob = (job) => {
      if (memoryJobSettled) return;
      memoryJobSettled = true;
      resolve(job);
    };
  });

  return { memoryJob, settleMemoryJob };
}

export async function POST(request: NextRequest) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const freeze = writeFreezeResponse("chat");
  if (freeze) return freeze;

  const parsed = chatRequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid chat request" }, { status: 400 });
  }
  const requestData = parsed.data;
  const userId = session.user.id;

  const owned = await getOwnedChat(requestData.chatId, userId);
  if (!owned) return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  const topic = owned.topic ?? (await getDefaultTopic());
  if (!topic) return NextResponse.json({ error: "Chat topic not available" }, { status: 404 });

  const limit = await consumeAiQuota({
    key: `chat:user:${safeQuotaKeyPart(userId)}`,
    limit: numberFromEnv("RATE_LIMIT_USER_CHAT_DAILY", quotaDefaults.userChatDaily),
  });
  if (!limit.quota.ok) {
    return quotaResponse("Daily message limit reached", limit.quota.retryAfterSeconds);
  }
  if (limit.budget && !limit.budget.ok) {
    return quotaResponse("Daily AI usage limit reached", limit.budget.retryAfterSeconds);
  }

  const [userMessage, user] = await Promise.all([
    insertMessage({
      chatId: requestData.chatId,
      role: "user",
      content: requestData.content,
    }),
    getUserLearningProfileById(userId),
  ]);

  const context = await getContextMessages(userMessage.chatId);
  const preferredLanguage = normalizeLanguage(user?.preferredLanguage);
  const learnerAge = calculateAge(user?.dateOfBirth);
  const memoryRetrieval = await safeRetrieveMemory({
    userId,
    chatId: userMessage.chatId,
    userMessageId: userMessage.id,
    message: requestData.content,
    topic,
    contextMessages: context,
  });
  const memoryContext = {
    used: memoryRetrieval.used,
    gateReason: memoryRetrieval.gateReason,
    status: memoryRetrieval.status,
    memories: memoryRetrieval.memories,
    summarySections: memoryRetrieval.summarySections,
    profiles: memoryRetrieval.profiles,
    chatSummaries: memoryRetrieval.chatSummaries,
    priorChatTurns: memoryRetrieval.priorChatTurns,
    sources: memoryRetrieval.sources,
  };
  after(async () => {
    if (!memoryRetrieval.memoryIds.length && !memoryRetrieval.chatTurnIds.length) return;
    try {
      await recordMemoryRetrievalUsage({
        userId,
        chatId: userMessage.chatId,
        userMessageId: userMessage.id,
        memoryIds: memoryRetrieval.memoryIds,
        chatTurnIds: memoryRetrieval.chatTurnIds,
        reason: memoryRetrieval.gateReason,
      });
    } catch (memoryUsageError) {
      console.warn("Memory retrieval usage recording failed", memoryUsageError);
    }
  });
  const assembled = buildModelMessages(topic, context, preferredLanguage, { learnerAge, memoryContext });
  const model = resolveModelForTopic(topic);

  const [run] = await db
    .insert(aiRuns)
    .values({
      chatId: requestData.chatId,
      userMessageId: userMessage.id,
      model,
      memoryContext: memoryRunMetadata(memoryRetrieval),
      status: "started",
    })
    .returning();
  const { memoryJob, settleMemoryJob } = createMemoryJobLatch();

  async function markRunFailed(error: unknown) {
    settleMemoryJob(null);
    await db
      .update(aiRuns)
      .set({
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown AI error",
        completedAt: new Date(),
      })
      .where(eq(aiRuns.id, run.id));
  }

  async function completeRun(event: LearningStreamFinishEvent) {
    const assistant = await insertMessage({
      chatId: requestData.chatId,
      role: "assistant",
      content: event.text,
    });
    await db
      .update(aiRuns)
      .set({
        assistantMessageId: assistant.id,
        promptTokens: event.totalUsage?.inputTokens ?? null,
        completionTokens: event.totalUsage?.outputTokens ?? null,
        totalTokens: event.totalUsage?.totalTokens ?? null,
        cachedPromptTokens: event.totalUsage?.cachedInputTokens ?? null,
        status: "completed",
        completedAt: new Date(),
      })
      .where(eq(aiRuns.id, run.id));
    const memoryMessage = createMemoryPostTurnQueueMessage({
      aiRunId: run.id,
      userId,
      chatId: requestData.chatId,
      topic: {
        id: topic.id,
        name: topic.name,
        slug: topic.slug,
      },
      userMessageId: userMessage.id,
      assistantMessageId: assistant.id,
      contextMessageIds: context.map((message) => message.id),
    });
    settleMemoryJob(memoryMessage);
  }

  after(async () => {
    const message = await memoryJobWithTimeout(memoryJob);
    if (!message) return;
    try {
      await dispatchMemoryPostTurn(message);
    } catch (memoryError) {
      console.warn("Memory processing dispatch failed", memoryError);
    }
  });

  try {
    const agent = createLearningAgent({
      topic,
      model,
      preferredLanguage,
      learnerAge,
      memoryContext,
    });
    const result = await agent.stream({ messages: assembled.messages });

    return await createLearningTextStreamResponse(
      { fullStream: result.fullStream as ReadableStream<unknown> },
      {
        headers: chatStreamHeaders({
          aiRunId: run.id,
          chatId: requestData.chatId,
          memorySources: memoryContext.sources,
          userMessageId: userMessage.id,
        }),
        onError: markRunFailed,
        onFinish: completeRun,
      },
    );
  } catch (error) {
    await markRunFailed(error);
    return NextResponse.json({ error: "The assistant could not answer right now." }, { status: 500 });
  }
}

function chatStreamHeaders(input: {
  aiRunId: string;
  chatId: string;
  memorySources: MemoryRetrievalResult["sources"];
  userMessageId: string;
}) {
  const headers: Record<string, string> = {
    "x-inspir-ai-run-id": input.aiRunId,
    "x-inspir-chat-id": input.chatId,
    "x-inspir-user-message-id": input.userMessageId,
  };
  if (input.memorySources.length > 0) {
    const encodedSources = encodeURIComponent(JSON.stringify(input.memorySources));
    if (encodedSources.length <= 6000) headers["x-inspir-memory-sources"] = encodedSources;
  }
  return headers;
}

function quotaResponse(error: string, retryAfterSeconds: number) {
  return NextResponse.json(
    { error },
    {
      status: 429,
      headers: { "Retry-After": String(retryAfterSeconds) },
    },
  );
}

async function memoryJobWithTimeout(memoryJob: Promise<MemoryJob>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      memoryJob,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), 90_000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function safeRetrieveMemory(input: Parameters<typeof retrieveRelevantMemoryForTurn>[0]): Promise<MemoryRetrievalResult> {
  const timeoutMs = numberFromEnv("MEMORY_PRESTREAM_RETRIEVAL_TIMEOUT_MS", defaultPreStreamMemoryTimeoutMs);
  const embeddingTimeoutMs = numberFromEnv("MEMORY_PRESTREAM_EMBEDDING_TIMEOUT_MS", defaultPreStreamEmbeddingTimeoutMs);
  const retrieval = retrieveRelevantMemoryForTurn({
    ...input,
    embeddingTimeoutMs,
    recordUsage: false,
    skipLlmGate: true,
  });
  try {
    const result = await promiseWithTimeout(retrieval, Math.max(200, timeoutMs));
    if (result) return result;
    console.warn("Memory retrieval timed out before stream start", { timeoutMs });
    return emptyMemoryRetrieval("Memory retrieval timed out; answered without long-term memory.");
  } catch (error) {
    console.warn("Memory retrieval failed", error);
    return emptyMemoryRetrieval("Memory retrieval failed; answered without long-term memory.");
  }
}

async function promiseWithTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function emptyMemoryRetrieval(gateReason: string): MemoryRetrievalResult {
  return {
    settingsEnabled: false,
    used: false,
    gateReason,
    memories: [],
    summarySections: [],
    profiles: [],
    chatSummaries: [],
    priorChatTurns: [],
    sources: [],
    memoryIds: [],
    profileCategories: [],
    chatSummaryIds: [],
    chatTurnIds: [],
    summarySectionIds: [],
  };
}
