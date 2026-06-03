import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireSession } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { aiRuns } from "@/lib/db/schema";
import { getContextMessages, getOwnedChat, getUserById, insertMessage } from "@/lib/db/queries";
import { buildModelMessages } from "@/lib/ai/prompts";
import { createLearningAgent } from "@/lib/ai/learning-agent";
import { resolveModelForTopic } from "@/lib/ai/model-router";
import {
  memoryRunMetadata,
  processMemoryAfterTurn,
  retrieveRelevantMemoryForTurn,
  type MemoryRetrievalResult,
} from "@/lib/ai/memory";
import { normalizeLanguage } from "@/lib/content/languages";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { calculateAge } from "@/lib/profile/age";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const chatRequestSchema = z.object({
  chatId: z.uuid(),
  content: z.string().trim().min(1).max(6000),
});

export async function POST(request: NextRequest) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rate = checkRateLimit(`chat:${session.user.id}`, 60, 24 * 60 * 60 * 1000);
  if (!rate.ok) {
    return NextResponse.json({ error: "Daily message limit reached" }, { status: 429 });
  }

  const parsed = chatRequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid chat request" }, { status: 400 });
  }

  const owned = await getOwnedChat(parsed.data.chatId, session.user.id);
  if (!owned?.topic) return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  const topic = owned.topic;

  const [userMessage, user] = await Promise.all([
    insertMessage({
      chatId: parsed.data.chatId,
      role: "user",
      content: parsed.data.content,
    }),
    getUserById(session.user.id),
  ]);

  const context = await getContextMessages(userMessage.chatId);
  const preferredLanguage = normalizeLanguage(user?.preferredLanguage);
  const learnerAge = calculateAge(user?.dateOfBirth);
  const memoryRetrieval = await safeRetrieveMemory({
    userId: session.user.id,
    chatId: userMessage.chatId,
    userMessageId: userMessage.id,
    message: parsed.data.content,
    topic,
    contextMessages: context,
  });
  const memoryContext = {
    used: memoryRetrieval.used,
    gateReason: memoryRetrieval.gateReason,
    status: memoryRetrieval.status,
    memories: memoryRetrieval.memories,
    profiles: memoryRetrieval.profiles,
    chatSummaries: memoryRetrieval.chatSummaries,
    priorChatTurns: memoryRetrieval.priorChatTurns,
  };
  const assembled = buildModelMessages(topic, context, preferredLanguage, { learnerAge, memoryContext });
  const model = resolveModelForTopic(topic);

  const [run] = await db
    .insert(aiRuns)
    .values({
      chatId: parsed.data.chatId,
      userMessageId: userMessage.id,
      model,
      memoryContext: memoryRunMetadata(memoryRetrieval),
      status: "started",
    })
    .returning();
  try {
    const agent = createLearningAgent({
      topic,
      model,
      preferredLanguage,
      learnerAge,
      memoryContext,
      onFinish: async (event) => {
        const assistant = await insertMessage({
          chatId: parsed.data.chatId,
          role: "assistant",
          content: event.text,
        });
        await db
          .update(aiRuns)
          .set({
            assistantMessageId: assistant.id,
            promptTokens: event.totalUsage.inputTokens ?? null,
            completionTokens: event.totalUsage.outputTokens ?? null,
            totalTokens: event.totalUsage.totalTokens ?? null,
            status: "completed",
            completedAt: new Date(),
          })
          .where(eq(aiRuns.id, run.id));
        after(async () => {
          try {
            await processMemoryAfterTurn({
              userId: session.user.id,
              chatId: parsed.data.chatId,
              topic,
              userMessage: {
                id: userMessage.id,
                role: "user",
                content: userMessage.content,
              },
              assistantMessage: {
                id: assistant.id,
                role: "assistant",
                content: event.text,
              },
              contextMessages: context.map((message) => ({
                id: message.id,
                role: message.role,
                content: message.content,
              })),
            });
          } catch (memoryError) {
            console.warn("Memory processing failed", memoryError);
          }
        });
      },
    });
    const result = await agent.stream({ messages: assembled.messages });

    return result.toTextStreamResponse();
  } catch (error) {
    await db
      .update(aiRuns)
      .set({
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown AI error",
        completedAt: new Date(),
      })
      .where(eq(aiRuns.id, run.id));
    return NextResponse.json({ error: "The assistant could not answer right now." }, { status: 500 });
  }
}

async function safeRetrieveMemory(input: Parameters<typeof retrieveRelevantMemoryForTurn>[0]): Promise<MemoryRetrievalResult> {
  try {
    return await retrieveRelevantMemoryForTurn(input);
  } catch (error) {
    console.warn("Memory retrieval failed", error);
    return {
      settingsEnabled: false,
      used: false,
      gateReason: "Memory retrieval failed; answered without long-term memory.",
      memories: [],
      profiles: [],
      chatSummaries: [],
      priorChatTurns: [],
      memoryIds: [],
      profileCategories: [],
      chatSummaryIds: [],
      chatTurnIds: [],
    };
  }
}
